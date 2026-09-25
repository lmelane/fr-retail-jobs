import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { rootDomainOf } from '../../src/normalize/companyDomain.js';

/**
 * Le plan d'écriture de domaines RELUS PAR UN HUMAIN sur des sociétés : ce module décide et écrit, le
 * script `poser-domaines-relus.mts` lui fournit la base, l'essai à blanc d'audit lit la production en
 * lecture seule et rend le même plan, à la même empreinte.
 *
 * Pourquoi un chemin relu à côté de `resolve-domains` (25/09/2026, logos manquants) : la commande ne pose
 * que ce que le catalogue ou Wikidata disent, elle ne se filtre pas et elle n'écrase rien. Son essai à blanc
 * ne résout que 33 des 150 premières sociétés sans domaine, aucune par le catalogue : les sociétés nommées
 * par leur entité juridique (« 1151 Swarovski Retail Ventures ») n'y trouvent rien. Et ce qu'elle a posé
 * par le passé comprend des domaines faux qu'elle ne peut plus corriger (Talbots → talbots.co.jp, le site de
 * Talbots Japon). Un logo d'une autre entreprise est pire qu'un monogramme : ici, seule une ligne relue,
 * prouvée et de confiance haute s'écrit, et jamais par-dessus une valeur que la relecture n'a pas vue.
 */

export type DomaineRelu = {
  /** `Company.id` relu. */
  id: string;
  /** `Company.name` au moment de la relecture : si la société a changé de nom, la ligne ne s'applique plus. */
  nom: string;
  /**
   * Le domaine enregistrable à poser (`swarovski.com`), jamais un sous-domaine ni un hôte d'ATS. `null` retire un
   * domaine faux sans le remplacer : la Maison n'a pas de site à elle et le logo affiché est celui d'une autre
   * entreprise (le monogramme vaut mieux).
   */
  domaine: string | null;
  /** `null` : compléter un domaine vide. Sinon, la valeur fausse relue que ce domaine remplace ou que ce retrait ôte. */
  ancienDomaine: string | null;
  /** L'URL https de la preuve : site officiel ou carrière de la Maison. */
  preuve: string;
  /** Seule la confiance haute s'écrit ; le doute reste un monogramme. */
  confiance: 'HAUTE';
};

export type FichierRelu = {
  /** Écrit dans `Company.domainSource`, sur la convention des lots relus (`registre-relu-2026-09-18`). */
  lot: string;
  relecteur: string;
  reluLe: string;
  domaines: DomaineRelu[];
};

export type EtatSociete = { id: string; name: string; domain: string | null; mergedIntoId: string | null };

export type Action = {
  id: string;
  nom: string;
  domaine: string | null;
  ancienDomaine: string | null;
  preuve: string;
  etat: 'ECRIRE' | 'DEJA_POSE' | 'REFUS';
  motif?: string;
};

const LOT = /^[a-z0-9]+(?:-[a-z0-9]+)*-relu-\d{4}-\d{2}-\d{2}$/;

/** Le fichier relu, ou une erreur qui dit ce qui manque : rien ne s'écrit sur un fichier mal formé. */
export function validerFichier(brut: unknown): FichierRelu {
  const f = brut as Partial<FichierRelu> | null;
  if (!f || typeof f !== 'object') throw new Error('Fichier relu illisible');
  if (typeof f.lot !== 'string' || !LOT.test(f.lot)) throw new Error('`lot` doit suivre la forme <objet>-relu-AAAA-MM-JJ');
  if (typeof f.relecteur !== 'string' || !f.relecteur.trim()) throw new Error('`relecteur` manquant');
  if (typeof f.reluLe !== 'string' || !Number.isFinite(Date.parse(f.reluLe))) throw new Error('`reluLe` doit être une date');
  if (!Array.isArray(f.domaines) || !f.domaines.length) throw new Error('`domaines` vide');
  for (const d of f.domaines) {
    const ok = d && typeof d.id === 'string' && typeof d.nom === 'string' && (d.domaine === null || typeof d.domaine === 'string')
      && (d.ancienDomaine === null || typeof d.ancienDomaine === 'string') && typeof d.preuve === 'string' && typeof d.confiance === 'string';
    if (!ok) throw new Error(`Ligne relue incomplète : ${JSON.stringify(d)}`);
  }
  return f as FichierRelu;
}

/** Ce que chaque ligne ferait sur l'état lu. Pur : même fichier et même état, même plan. */
export function planifier(fichier: FichierRelu, etats: ReadonlyMap<string, EtatSociete>): Action[] {
  const vus = new Set<string>();
  return fichier.domaines.map((d): Action => {
    const base = { id: d.id, nom: d.nom, domaine: d.domaine, ancienDomaine: d.ancienDomaine, preuve: d.preuve };
    const refus = (motif: string): Action => ({ ...base, etat: 'REFUS', motif });
    if (vus.has(d.id)) return refus('société relue deux fois dans le fichier');
    vus.add(d.id);
    if (d.confiance !== 'HAUTE') return refus('confiance non haute : le doute reste un monogramme');
    if (!/^https:\/\/[^\s]+$/.test(d.preuve)) return refus('preuve absente ou non https');
    // Un retrait désigne toujours la valeur fausse qu'il ôte : jamais un « vider au passage ».
    if (d.domaine === null && d.ancienDomaine === null) return refus('un retrait doit nommer le domaine faux qu’il retire');
    // Le domaine doit être sa propre racine : ni sous-domaine carrière, ni hôte d'éditeur d'ATS (dont le logo
    // s'afficherait sur toutes les Maisons du tenant), ni forme illisible.
    if (d.domaine !== null && rootDomainOf(d.domaine) !== d.domaine) return refus('domaine non enregistrable, hôte d’ATS ou forme invalide');
    const etat = etats.get(d.id);
    if (!etat) return refus('société absente');
    if (etat.mergedIntoId) return refus(`société fusionnée dans ${etat.mergedIntoId} : relire la cible`);
    if (etat.name !== d.nom) return refus(`nom changé depuis la relecture : « ${etat.name} »`);
    if (etat.domain === d.domaine) return { ...base, etat: 'DEJA_POSE' };
    if (etat.domain !== d.ancienDomaine) {
      return refus(d.ancienDomaine === null
        ? `porte déjà ${etat.domain} : jamais écrasé sans relecture de cette valeur`
        : `porte ${etat.domain ?? 'aucun domaine'}, pas ${d.ancienDomaine}`);
    }
    return { ...base, etat: 'ECRIRE' };
  });
}

/** L'empreinte du plan : l'écriture n'a lieu que si le plan recalculé est celui qui a été inspecté. */
export function empreinte(lot: string, actions: readonly Action[]): string {
  const stable = actions.map((a) => [a.id, a.nom, a.domaine, a.ancienDomaine, a.preuve, a.etat, a.motif ?? null]);
  return createHash('sha256').update(JSON.stringify([lot, stable])).digest('hex');
}

export type ClientEcriture = Pick<PrismaClient, 'company' | 'pipelineRun' | '$transaction'>;
export type Ecriture = { refus: string } | { ecrites: number; conformes: number; attendues: number };

/** Une exécution du pipeline ouverte depuis moins de 12 h est un RUN en cours ; au-delà, une trace morte. */
const RUN_OUVERT_MS = 12 * 3_600_000;

/**
 * Écrit le plan INSPECTÉ, et lui seul : l'empreinte demandée doit être celle du plan recalculé sur l'état
 * courant, aucun RUN ne doit être en cours, et chaque ligne réécrit la condition du plan (même société, même
 * nom, même domaine qu'à l'inspection). Une seule ligne qui ne s'applique pas annule toute la transaction.
 */
export async function ecrire(prisma: ClientEcriture, fichier: FichierRelu, actions: readonly Action[], empreinteDemandee: string,
  maintenant = new Date()): Promise<Ecriture> {
  if (empreinteDemandee !== empreinte(fichier.lot, actions)) {
    return { refus: 'l’empreinte ne correspond pas au plan recalculé : la base ou le fichier ont changé depuis l’inspection, réinspecter' };
  }
  const enCours = await prisma.pipelineRun.count({
    where: { status: 'RUNNING', finishedAt: null, startedAt: { gt: new Date(maintenant.getTime() - RUN_OUVERT_MS) } },
  });
  if (enCours) return { refus: `${enCours} exécution(s) du pipeline en cours : réessayer après la fin du RUN` };
  const aEcrire = actions.filter((a) => a.etat === 'ECRIRE');
  const ecrites = await prisma.$transaction(async (tx) => {
    let n = 0;
    for (const a of aEcrire) {
      const r = await tx.company.updateMany({
        where: { id: a.id, name: a.nom, domain: a.ancienDomaine, mergedIntoId: null },
        data: { domain: a.domaine, domainSource: fichier.lot },
      });
      if (r.count !== 1) throw new Error(`« ${a.nom} » (${a.id}) a changé pendant l’écriture : rien n’est écrit`);
      n += r.count;
    }
    return n;
  }, { maxWait: 30_000, timeout: 120_000 });
  const relues = await prisma.company.findMany({ where: { id: { in: aEcrire.map((a) => a.id) } }, select: { id: true, domain: true, domainSource: true } });
  const conformes = relues.filter((c) => c.domainSource === fichier.lot && aEcrire.some((a) => a.id === c.id && a.domaine === c.domain)).length;
  return { ecrites, conformes, attendues: aEcrire.length };
}

/** Le rapport d'inspection, identique pour le script d'écriture et l'essai à blanc d'audit. */
export function rapport(fichier: FichierRelu, actions: readonly Action[]): string {
  const par = (e: Action['etat']) => actions.filter((a) => a.etat === e);
  const lignes = [
    `DOMAINES RELUS · lot ${fichier.lot} · relu par ${fichier.relecteur} le ${fichier.reluLe} · ${actions.length} ligne(s)`,
    `   ${String(par('ECRIRE').length).padStart(4)} à écrire`,
    `   ${String(par('DEJA_POSE').length).padStart(4)} déjà posé(s), laissé(s) tel(s) quel(s)`,
    `   ${String(par('REFUS').length).padStart(4)} refus`,
    ...actions.map((a) => `   ${a.etat === 'REFUS' ? '⚠' : ' '} ${a.etat.padEnd(9)} ${a.id}  « ${a.nom} »  ${a.ancienDomaine ? `${a.ancienDomaine} → ` : ''}${a.domaine ?? 'retrait (monogramme)'}${a.motif ? `  (${a.motif})` : ''}`),
  ];
  return lignes.join('\n');
}
