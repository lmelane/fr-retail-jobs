/**
 * ENTRÉES COMMUNES DE LA PASSE DE CURATION v3 (D-475 lot 2, sous-lot 2A ; plan `docs/architecture/classification-metiers.md`
 * §3.1-§3.2) : la référence ESCO (`data/reference/`, lue par le code), les entrées datées de la passe et ses sorties
 * (`audits/2026-09-28/curation-v3/` : des preuves sans secret, jamais dans `data/`, cf. `apps/aggregator/data/README.md`),
 * et les textes qui servent aux vecteurs (une seule définition, pour que toutes les étapes lisent le même cache).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { normalizeOccupationTitle } from '../../../../../packages/db/occupation-engine.ts';

const ICI = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const lireJson = (p: string) => JSON.parse(readFileSync(ICI(p), 'utf8'));

/** La passe de curation en cours : ses entrées datées (`entrees/`) et ses sorties, preuves sans secret (`audits/`). */
export const DOSSIER_SORTIE = ICI('../../../../../audits/2026-09-28/curation-v3/');
const ENTREES = `${DOSSIER_SORTIE}entrees/`;
export const servie = JSON.parse(readFileSync(`${ENTREES}catwalks-occupations-20260909-v1.json`, 'utf8'));
export const depot = lireJson('../../../../../packages/db/data/occupations-v1.json');
export const backend = JSON.parse(readFileSync(`${ENTREES}backend-referentiel-2026-09-28.json`, 'utf8'));
export const esco = JSON.parse(gunzipSync(readFileSync(ICI('../../../data/reference/esco-v1.2.1.json.gz'))).toString('utf8'));
export const CACHE_VECTEURS = ICI('../../../../../scratchpad/curation-v3-vecteurs.json');
export const lireEtape = (nom: string) => JSON.parse(readFileSync(`${DOSSIER_SORTIE}${nom}`, 'utf8'));

export type Metier = { key: string; labels: Record<string, string>; family: string; aliases?: string[] };
export type Famille = { key: string; labels: Record<string, string>; group: string };
/** Les 61 métiers servis, et `optical-assistant` (v2 du dépôt, jamais activée). */
export const metiersServis: Metier[] = [...servie.occupations, ...depot.occupations.filter((o: Metier) => o.key === 'optical-assistant')];
export const familles: Famille[] = servie.families;
export const groupes: string[] = servie.groups.map((g: { key: string }) => g.key);
export const escoMetiers = esco.metiers.filter((m: any) => m.statut === 'released' || !m.statut);

/**
 * La forme qu'une expression prend DANS le moteur (`phrase()` de `packages/db/occupation-engine.ts`, non exportée) :
 * orthographe du moteur, idéogrammes séparés, tout le reste réduit aux lettres et chiffres. Toute comparaison
 * d'expressions de la passe passe par elle : une autre normalisation fausse la garde et la préséance (audit technique du
 * 29/09/2026 : « RESPONSABLE E COMMERCE » devenait « RESPONSABLE COMMERCE », « 副店长 » n'était pas découpé).
 * `6-manifeste.mts` vérifie qu'elle est idempotente sur toutes les expressions qu'il écrit.
 */
export const phraseMoteur = (v: string) => normalizeOccupationTitle(v).replace(/\p{Script=Han}/gu, ' $& ').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** §32 c : un mot vague seul ne désigne pas un métier, donc ne classe aucune offre. */
export const VAGUES = new Set(['MANAGER', 'ASSISTANT', 'ASSISTANTE', 'ASSOCIATE', 'TEAM MEMBER', 'STAGIAIRE', 'STAGE', 'INTERN', 'EMPLOYE', 'EMPLOYEE',
  'RESPONSABLE', 'DIRECTEUR', 'DIRECTRICE', 'DIRECTOR', 'CHARGE', 'CHARGEE', 'LEAD', 'SPECIALIST', 'SPECIALISTE', 'COORDINATOR', 'COORDINATEUR',
  'CONSULTANT', 'CONSULTANTE', 'TECHNICIEN', 'TECHNICIENNE', 'OPERATEUR', 'AGENT', 'CONSEILLER', 'CONSEILLERE', 'ADVISOR', 'SUPERVISOR',
  // Mesure de justesse du 29/09/2026 : « Superviseur(e) » seul, et « Retail Manager » (directeur de magasin au Royaume-Uni
  // et en Australie, directeur retail ailleurs) ne désignent pas un métier à eux seuls.
  'SUPERVISEUR', 'SUPERVISEURE', 'SUPERVISEUSE', 'RETAIL MANAGER',
  // Audit du 29/09/2026 : « Sales Manager » désigne aussi bien l'encadrement de la vente en boutique (123 offres d'un
  // magasin américain, service Retail Management) que le wholesale ou la vente B2B : trop vague pour un métier.
  'SALES MANAGER']);

/**
 * Mots de niveau hiérarchique sans domaine. Une expression faite UNIQUEMENT de ces mots (« Team Manager », « Team
 * Leader », « Supervisor I », « General Manager ») garde le métier d'encadrement de boutique que les deux juges lui ont
 * donné, mais pour l'intitulé EXACT seulement : elle ne se généralise jamais (D-475 §36, arbitrage du CEO du 29/09/2026 ;
 * généralisée, « Team Leader » classait Floor manager un « Team Leader Corporate Tax » et un « DC Team Leader »).
 */
const HIERARCHIE = new Set(['TEAM', 'SHIFT', 'LEAD', 'LEADER', 'MANAGER', 'SUPERVISOR', 'SUPERVISEUR', 'SUPERVISEURE', 'SUPERVISEUSE', 'CHEF', 'CHEFFE',
  'D', 'DE', 'DI', 'EQUIPE', 'GENERAL', 'GENERALE', 'RESPONSABLE', 'ACTING', 'SENIOR', 'SR', 'JUNIOR', 'JR', 'I', 'II', 'III', 'IV', '1', '2', '3',
  'TEAMLEITER', 'TEAMLEITERIN', 'SCHICHTLEITER', 'SCHICHTLEITERIN', 'ENCARGADO', 'ENCARGADA', 'JEFE', 'JEFA', 'EQUIPO', 'CAPO', 'SQUADRA']);
/** Une forme (normalisée par `phraseMoteur`) faite seulement de mots de niveau : règle exacte, jamais généralisée (§36). */
export const niveauSeul = (forme: string) => !!forme && forme.split(' ').every((m) => HIERARCHIE.has(m));
/** §32 c : une forme (normalisée par `phraseMoteur`) trop vague pour désigner un métier (le mot seul, « Manager »). */
export const estVague = (forme: string) => VAGUES.has(forme);

/** Forme courte d'un libellé (« Vendeur / Vendeuse » → « Vendeur »). */
export const courte = (l?: string) => (l ?? '').split('/')[0].trim();
export const texteServi = (m: Metier) => `${m.labels.fr} / ${m.labels.en}${m.aliases?.length ? ` ; ${m.aliases.slice(0, 8).join(', ')}` : ''}`;
export const texteEsco = (m: any) => [courte(m.libelles.fr), courte(m.libelles.en), ...(m.synonymes.fr ?? []).slice(0, 3), ...(m.synonymes.en ?? []).slice(0, 3)].filter(Boolean).join(' ; ');
export const texteBackend = (b: any) => [b.label, b.labelEn, ...(b.aliases ?? []).slice(0, 6)].filter(Boolean).join(' ; ');

/** Un métier de la v3 en construction : servi (clé servie), venu du backend (`backend:<slug>`) ou des offres (`offres:<clé>`). */
export type Concept = { cle: string; fr: string; en: string; famille: string; variantes: string[]; texte: string };

/**
 * Les métiers de la v3 à l'issue des étapes 1, 1b et 2 (et 3-3b si `avecOffres`, 4 si `avecEncadrement`) : les métiers servis avec leurs variantes
 * venues du backend, les métiers nouveaux du backend avec les doublons qu'ils absorbent, et les métiers nouveaux
 * venus des offres. `texte` est la clé du cache de vecteurs.
 */
export function conceptsV3({ avecOffres, avecEncadrement = false }: { avecOffres: boolean; avecEncadrement?: boolean }): Concept[] {
  const etape1 = lireEtape('1-correspondance-backend.json');
  const etape1b = lireEtape('1b-doublons-backend.json');
  const etape2 = lireEtape('2-familles.json');
  const parId = new Map(backend.metiers.map((b: any) => [b.id, b]));
  const absorbesPar = new Map<string, string[]>(etape1b.groupes.map((g: any) => [g.representant.id, g.variantes.map((v: any) => v.label)]));
  const absorbes = new Set(etape1b.groupes.flatMap((g: any) => g.variantes.map((v: any) => v.id)));
  const familleDe = new Map(etape2.attributions.map((a: any) => [a.id, a.famille]));
  const concepts: Concept[] = [
    ...metiersServis.map((m) => ({ cle: m.key, fr: m.labels.fr, en: m.labels.en, famille: m.family, texte: texteServi(m),
      variantes: [...(m.aliases ?? []), ...etape1.decisions.filter((d: any) => d.metierServi === m.key).map((d: any) => d.label)] })),
    ...etape1.decisions.filter((d: any) => d.decision === 'nouveau' && !absorbes.has(d.id)).map((d: any) => {
      const b = parId.get(d.id) as any;
      return { cle: `backend:${d.slug}`, fr: d.label, en: b.labelEn ?? d.label, famille: familleDe.get(d.id) as string, texte: texteBackend(b),
        variantes: [...(b.aliases ?? []), ...(absorbesPar.get(d.id) ?? [])] };
    }),
  ];
  if (!avecOffres) return concepts;
  // Les métiers nouveaux des offres, après la garde d'unicité (étape 3b).
  const etape3b = lireEtape('3b-garde-unicite.json');
  const offres = etape3b.nouveauxMetiers.map((m: any) => ({ cle: `offres:${m.cle}`, fr: m.fr, en: m.en, famille: m.famille,
    texte: `${m.fr} / ${m.en} ; ${m.titres.slice(0, 8).join(', ')}`, variantes: m.titres }));
  if (!avecEncadrement) return [...concepts, ...offres];
  const encadrement = lireEtape('4-encadrement.json').nouveauxMetiers.map((m: any) => ({ cle: `encadrement:${m.cle}`, fr: m.fr, en: m.en,
    famille: m.famille, texte: `${m.fr} / ${m.en} ; ${m.titres.slice(0, 8).join(', ')}`, variantes: m.titres }));
  return [...concepts, ...offres, ...encadrement];
}

/** Les 25 langues du site (`catwalks-website/src/lib/langue/langue.ts`), et la langue ESCO qui sert de matière. */
export const LANGUES_SITE = ['fr', 'en', 'de', 'it', 'es', 'nl', 'zh-CN', 'ja', 'ko', 'pt', 'pt-BR', 'da', 'zh-Hant', 'pl', 'sv', 'tr', 'th', 'ms', 'ar',
  'nb', 'el', 'vi', 'cs', 'hu', 'ro'] as const;
export const LANGUE_ESCO: Record<string, string | undefined> = { 'pt-BR': 'pt', nb: 'no' };

/**
 * Les libellés finaux d'un métier (5b, sinon 5 pour un métier absorbé) et ses formes grammaticales de l'étape 5, gardées
 * seulement dans les langues où le libellé n'a pas été corrigé : une forme d'un libellé abandonné (« Verkäuferin » quand
 * « Verkäufer » a été renommé) n'en est plus une (29/09/2026).
 */
export function libellesEtFormes(cle: string, e5ParCle: Map<string, any>, e5b: any): { libelles: Record<string, string>; formes: Record<string, string[]> } {
  const avant = e5ParCle.get(cle)?.libelles ?? {};
  const libelles = e5b.libelles[cle] ?? avant;
  const formes = Object.fromEntries(Object.entries<string[]>(e5ParCle.get(cle)?.formes ?? {}).filter(([l]) => libelles[l] === avant[l]));
  // Les formes d'un libellé corrigé par 5b viennent de l'étape 5d (« Employée de rayon » pour « Employé de rayon »).
  const nouvelles = formes5d()?.formes[cle] ?? {};
  for (const [l, f] of Object.entries<string[]>(nouvelles)) if (libelles[l] !== avant[l] && f.length) formes[l] = f;
  return { libelles, formes };
}
let cache5d: any;
const formes5d = () => (cache5d ??= existsSync(`${DOSSIER_SORTIE}5d-formes.json`) ? lireEtape('5d-formes.json') : null);

/** Toutes les familles de la v3 : celles du catalogue et les nouvelles de l'étape 2. */
export const famillesV3 = (): string[] => [...familles.map((f) => f.key), ...lireEtape('2-familles.json').nouvellesFamilles.map((f: any) => f.key)];

/**
 * Seuils de départ d'un métier nouveau venu des offres (plan §3.1, à recalibrer) : au moins 10 offres d'au moins
 * 3 employeurs distincts, comptés par identifiant sur le groupe d'intitulés (jamais la somme des comptes par intitulé).
 */
export const MIN_OFFRES_METIER = 10;
export const MIN_EMPLOYEURS = 3;

/** L'export des intitulés d'offres (et son empreinte, recopiée dans chaque sortie qui le lit). */
/** Le contexte qui lève l'ambiguïté d'un intitulé : ses employeurs et ses services les plus fréquents. */
export const contexte = (x: { employeursNoms?: string[]; services?: string[] }) =>
  [x.employeursNoms?.length ? `employeurs : ${x.employeursNoms.slice(0, 3).join(', ')}` : '', x.services?.length ? `services : ${x.services.slice(0, 2).join(', ')}` : '']
    .filter(Boolean).join(' ; ');
export function lireIntitulesOffres(): { intitules: any[]; sha256: string } {
  const octets = readFileSync(`${ENTREES}intitules-offres-2026-09-29.json.gz`);
  return { intitules: JSON.parse(gunzipSync(octets).toString('utf8')).intitules, sha256: createHash('sha256').update(octets).digest('hex') };
}
