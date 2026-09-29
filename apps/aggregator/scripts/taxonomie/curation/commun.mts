/**
 * ENTRÉES COMMUNES DE LA PASSE DE CURATION v3 (D-475 lot 2, sous-lot 2A ; plan `docs/architecture/classification-metiers.md`
 * §3.1-§3.2) : la référence ESCO (`data/reference/`, lue par le code), les entrées datées de la passe et ses sorties
 * (`audits/2026-09-28/curation-v3/` : des preuves sans secret, jamais dans `data/`, cf. `apps/aggregator/data/README.md`),
 * et les textes qui servent aux vecteurs (une seule définition, pour que toutes les étapes lisent le même cache).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

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

/** Forme courte d'un libellé (« Vendeur / Vendeuse » → « Vendeur »). */
export const courte = (l?: string) => (l ?? '').split('/')[0].trim();
export const texteServi = (m: Metier) => `${m.labels.fr} / ${m.labels.en}${m.aliases?.length ? ` ; ${m.aliases.slice(0, 8).join(', ')}` : ''}`;
export const texteEsco = (m: any) => [courte(m.libelles.fr), courte(m.libelles.en), ...(m.synonymes.fr ?? []).slice(0, 3), ...(m.synonymes.en ?? []).slice(0, 3)].filter(Boolean).join(' ; ');
export const texteBackend = (b: any) => [b.label, b.labelEn, ...(b.aliases ?? []).slice(0, 6)].filter(Boolean).join(' ; ');

/** Un métier de la v3 en construction : servi (clé servie), venu du backend (`backend:<slug>`) ou des offres (`offres:<clé>`). */
export type Concept = { cle: string; fr: string; en: string; famille: string; variantes: string[]; texte: string };

/**
 * Les métiers de la v3 à l'issue des étapes 1, 1b et 2 (et 3-3b si `avecOffres`) : les métiers servis avec leurs variantes
 * venues du backend, les métiers nouveaux du backend avec les doublons qu'ils absorbent, et les métiers nouveaux
 * venus des offres. `texte` est la clé du cache de vecteurs.
 */
export function conceptsV3({ avecOffres }: { avecOffres: boolean }): Concept[] {
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
  return [...concepts, ...etape3b.nouveauxMetiers.map((m: any) => ({ cle: `offres:${m.cle}`, fr: m.fr, en: m.en, famille: m.famille,
    texte: `${m.fr} / ${m.en} ; ${m.titres.slice(0, 8).join(', ')}`, variantes: m.titres }))];
}

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
