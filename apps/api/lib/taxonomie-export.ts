import { prisma } from '@catwalks/db';
import { loadOccupationTaxonomy, type CompiledOccupationTaxonomy, type OccupationDefinition } from '@catwalks/db/occupations';

/**
 * L'EXPORT VERSIONNÉ DE LA TAXONOMIE DES MÉTIERS, TIRÉ PAR LE BACKEND (D-475, plan `classification-metiers.md` §3.7).
 *
 * Le catalogue est propriétaire de la taxonomie ; le backend la lit (R-140 §1). Il la tire par une tâche planifiée, par
 * PAQUETS, puis bascule son pointeur quand tout est chargé : une fonction Vercel ne tient pas le manifeste entier et
 * la table apprise dans une seule réponse (des dizaines de milliers d'intitulés à terme).
 *
 * Chaque page porte l'identifiant et l'empreinte de la version qu'elle sert. Si la version active change pendant un
 * chargement, la page suivante le dit, et le backend recommence au lieu d'assembler deux versions.
 *
 * Ce module ne sert que ce qui existe : les concepts du manifeste actif (métiers, familles, domaines), leurs libellés
 * par langue et leurs variantes de recherche, et les entrées de la table apprise active (vide tant qu'aucune passe
 * ne l'a remplie). Aucune donnée de personne.
 */
export const EXPORT_TAXONOMIE_CONTRAT = 1;
export const LIMITE_CONCEPTS_MAX = 200;
export const LIMITE_APPRISES_MAX = 5_000;

export type TypeConcept = 'domaine' | 'famille' | 'metier';
export type ConceptExporte = {
  type: TypeConcept;
  cle: string;
  /** Domaine d'une famille, famille d'un métier ; aucun pour un domaine. */
  parent: string | null;
  /** Le nom affiché, par langue (forme courte, D-475 §31 c). */
  libelles: Record<string, string>;
  /** Toutes les formes reconnues à la recherche, toutes langues (libellés exclus), sans doublon, dans l'ordre du manifeste. */
  variantes: string[];
  /** Successeur d'un métier remplacé (un métier publié n'est jamais supprimé, R-140 §2) ; aucun aujourd'hui. */
  remplacePar: string | null;
};
export type VersionExportee = { releaseId: string; empreinte: string };
export type VersionApprise = { releaseId: string; empreinte: string; entrees: number } | null;

const RANG: Record<TypeConcept, number> = { domaine: 0, famille: 1, metier: 2 };
/** Le curseur d'une page de concepts : `<type>:<clé>` du dernier concept servi. */
export const curseurConcept = (c: Pick<ConceptExporte, 'type' | 'cle'>): string => `${c.type}:${c.cle}`;

function variantes(def: OccupationDefinition): string[] {
  const vues = new Set<string>();
  const sortie: string[] = [];
  for (const v of [...(def.aliases ?? []), ...(def.titleOnlyAliases ?? [])]) {
    const t = typeof v === 'string' ? v.trim() : '';
    if (!t || vues.has(t)) continue;
    vues.add(t);
    sortie.push(t);
  }
  return sortie;
}

/** `replacedBy` est un champ optionnel prévu par le plan (§3.1) ; le manifeste v3 n'en porte aucun. */
const successeur = (def: OccupationDefinition): string | null => {
  const r = (def as OccupationDefinition & { replacedBy?: unknown }).replacedBy;
  return typeof r === 'string' && r.trim() ? r.trim() : null;
};

/** Tous les concepts d'une taxonomie compilée, dans l'ordre stable de l'export : domaines, familles, métiers, par clé. */
export function conceptsDe(taxonomie: CompiledOccupationTaxonomy): ConceptExporte[] {
  const m = taxonomie.manifest;
  const tous: ConceptExporte[] = [
    ...m.groups.map((d): ConceptExporte => ({ type: 'domaine', cle: d.key, parent: null, libelles: { ...d.labels }, variantes: variantes(d), remplacePar: successeur(d) })),
    ...m.families.map((d): ConceptExporte => ({ type: 'famille', cle: d.key, parent: d.group ?? null, libelles: { ...d.labels }, variantes: variantes(d), remplacePar: successeur(d) })),
    ...m.occupations.map((d): ConceptExporte => ({ type: 'metier', cle: d.key, parent: d.family ?? null, libelles: { ...d.labels }, variantes: variantes(d), remplacePar: successeur(d) })),
  ];
  return tous.sort((a, b) => RANG[a.type] - RANG[b.type] || (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
}

/** Une page de concepts après le curseur (exclu). `suivant` est `null` sur la dernière page. */
export function pageConcepts(concepts: readonly ConceptExporte[], apres: string | null, limite: number): { concepts: ConceptExporte[]; suivant: string | null } {
  let debut = 0;
  if (apres) {
    const i = concepts.findIndex((c) => curseurConcept(c) === apres);
    if (i < 0) throw new CurseurInconnuError(apres);
    debut = i + 1;
  }
  const page = concepts.slice(debut, debut + limite);
  const fin = debut + page.length >= concepts.length;
  return { concepts: page, suivant: fin || !page.length ? null : curseurConcept(page[page.length - 1]) };
}

export class CurseurInconnuError extends Error {
  constructor(readonly curseur: string) {
    super(`Curseur inconnu de cette version : ${curseur.slice(0, 120)}`);
    this.name = 'CurseurInconnuError';
  }
}

export function comptes(concepts: readonly ConceptExporte[]): { domaines: number; familles: number; metiers: number } {
  return {
    domaines: concepts.filter((c) => c.type === 'domaine').length,
    familles: concepts.filter((c) => c.type === 'famille').length,
    metiers: concepts.filter((c) => c.type === 'metier').length,
  };
}

/**
 * La version active, lue d'un seul coup avec son empreinte, puis compilée (compilation mise en cache par version).
 * Le pointeur peut basculer entre les deux lectures : on vérifie que la taxonomie compilée est bien celle que
 * désigne l'empreinte lue, sinon on relit une fois ; au-delà, l'appelant répond 503 et le backend réessaiera.
 */
export async function versionActive(): Promise<{ version: VersionExportee; taxonomie: CompiledOccupationTaxonomy; apprise: VersionApprise }> {
  for (let essai = 0; essai < 2; essai++) {
    const etat = await prisma.occupationState.findUnique({ where: { id: 'active' }, select: { releaseId: true, release: { select: { contentHash: true } } } });
    if (!etat) throw new TaxonomieNonActiveeError();
    const taxonomie = await loadOccupationTaxonomy(prisma);
    if (taxonomie.manifest.id !== etat.releaseId) continue;
    const appris = await prisma.occupationLearnedState.findUnique({
      where: { id: 'active' },
      select: { release: { select: { id: true, contentHash: true, entryCount: true, taxonomyReleaseId: true } } },
    });
    // Une table apprise ne vaut que pour SA taxonomie ; l'activation d'une taxonomie la remet à vide (plan §3.3).
    const r = appris?.release;
    const apprise: VersionApprise = r && r.taxonomyReleaseId === etat.releaseId ? { releaseId: r.id, empreinte: r.contentHash, entrees: r.entryCount } : null;
    return { version: { releaseId: etat.releaseId, empreinte: etat.release.contentHash }, taxonomie, apprise };
  }
  throw new TaxonomieInstableError();
}

export class TaxonomieNonActiveeError extends Error {
  constructor() {
    super('Aucune taxonomie des métiers active.');
    this.name = 'TaxonomieNonActiveeError';
  }
}
export class TaxonomieInstableError extends Error {
  constructor() {
    super('La version active a changé pendant la lecture ; réessayer.');
    this.name = 'TaxonomieInstableError';
  }
}

/** Une page de la table apprise active, par clé d'intitulé croissante, après le curseur (exclu). */
export async function pageApprise(releaseId: string, apres: string | null, limite: number): Promise<{ entrees: { intitule: string; code: string }[]; suivant: string | null }> {
  const lignes = await prisma.occupationLearnedEntry.findMany({
    where: { releaseId, ...(apres ? { titleKey: { gt: apres } } : {}) },
    orderBy: { titleKey: 'asc' },
    take: limite + 1,
    select: { titleKey: true, occupationCode: true },
  });
  const page = lignes.slice(0, limite);
  return {
    entrees: page.map((l) => ({ intitule: l.titleKey, code: l.occupationCode })),
    suivant: lignes.length > limite ? page[page.length - 1].titleKey : null,
  };
}
