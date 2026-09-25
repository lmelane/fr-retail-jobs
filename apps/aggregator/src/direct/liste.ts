import { assertBusinessUrl } from '@catwalks/runtime';
import { assertPipelineRunning } from '../lib/pipelinePause.js';
import { ContratInvalideError, lireOffre, type OffreCatalogueV1 } from './contrat.js';

/**
 * LA LISTE PUBLIQUE DES OFFRES CATWALKS, TELLE QUE L'AGRÉGATEUR LA LIT (D-444).
 *
 * `GET https://catwalks.api.catwalks.io/api/jobs` est la liste que le site sert déjà à `/offres` : un tableau JSON des
 * offres en ligne, 29 champs chacune (`catwalks-backend/src/app/api/jobs/route.ts`), sans pagination, plafonnée à 500
 * (`take: 500`), la Maison déjà masquée pour un mandat interne (`maisonPublique` : `maison: null`). Aucun champ pays :
 * des coordonnées. D-444 en fait la PHOTO COMPLÈTE des offres publiables : présente, l'offre est publiable ; absente
 * d'une photo complète, elle est retirée.
 *
 * Ce module ne fait confiance à rien. Chaque offre est relue champ par champ ; une offre qui ne se lit pas est REFUSÉE,
 * nommée par son chemin, et la photo n'est plus complète (aucun retrait). Une réponse qui n'est pas un tableau, ou qui
 * porte deux fois le même identifiant, est INVALIDE tout entière. Les champs `reference` et `createdAt` ne sont pas lus.
 *
 * Une offre lue devient un contrat catalogue version 1 (`contrat.ts`), le vocabulaire que la projection sait déjà lire,
 * au miroir de `projeterOffreCatalogue` du backend (branche `development`) pour les champs que la liste porte ; ceux
 * qu'elle ne porte pas restent vides, jamais devinés : ville, arrondissement, code postal, expérience, télétravail,
 * anciens slugs. Le pays vient des coordonnées, par le tracé des frontières (`geo/frontieres.ts`).
 */
export const LISTE_PLAFOND = 500;
/** La version de ce contrat de lecture, consignée avec l'état du lecteur (`DirectFeedCursor.contractVersion`). */
export const LISTE_CONTRAT_VERSION = 1;
/** Au miroir de `urlOffre` du backend (`src/lib/notification-google-emplois.ts:56`) : l'adresse publique d'une offre. */
export const URL_OFFRE_CATWALKS = 'https://catwalks.io/offres/';
/** Au-delà, la réponse n'est pas lue : 500 offres pèsent environ 1,2 Mo (133 Ko pour 59 le 25/09/2026). */
const OCTETS_MAX = 20_000_000;

export type ItemListe = {
  id: string;
  slug: string;
  titre: string;
  lieu: string;
  latitude: number | null;
  longitude: number | null;
  salaire: string;
  salaireMin: number | null;
  salaireMax: number | null;
  devise: string | null;
  marque: string | null;
  poste: string;
  missions: string;
  profil: string;
  avantages: string | null;
  visuel: string | null;
  publieeLe: string;
  finLe: string | null;
  modifieeLe: string;
  univers: string[];
  specialisations: string[];
  contrat: string;
  tempsDeTravail: string;
  metier: { slug: string; libelle: string } | null;
  maison: { nom: string; slug: string } | null;
};

export type RefusListe = { index: number; id: string | null; chemin: string; detail: string };
export type OffreLue = { index: number; id: string; brut: Record<string, unknown>; item: ItemListe };
/** `taille` : le nombre d'éléments du tableau reçu, offres lues et refusées comprises (c'est lui qui atteint le plafond). */
export type LectureListe = { taille: number; offres: OffreLue[]; refus: RefusListe[] };

export class ListeIndisponibleError extends Error {
  constructor(readonly statut: number | null, detail: string) {
    super(`Liste publique indisponible : ${detail}`);
    this.name = 'ListeIndisponibleError';
  }
}

export class ListeInvalideError extends Error {
  constructor(readonly chemin: string, detail: string) {
    super(`Liste publique invalide à ${chemin} : ${detail}`);
    this.name = 'ListeInvalideError';
  }
}

type Brut = Record<string, unknown>;
const objet = (v: unknown, chemin: string): Brut => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ContratInvalideError(chemin, 'objet attendu');
  return v as Brut;
};
const texte = (v: unknown, chemin: string, max = 20_000): string => {
  if (typeof v !== 'string' || v.length > max) throw new ContratInvalideError(chemin, `chaîne attendue (≤ ${max})`);
  return v;
};
const texteOuNull = (v: unknown, chemin: string, max = 20_000): string | null => (v === null ? null : texte(v, chemin, max));
const nombreOuNull = (v: unknown, chemin: string): number | null => {
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ContratInvalideError(chemin, 'nombre attendu');
  return v;
};
const liste = (v: unknown, chemin: string): string[] => {
  if (!Array.isArray(v) || v.length > 50) throw new ContratInvalideError(chemin, 'liste de chaînes attendue');
  return v.map((x, i) => texte(x, `${chemin}[${i}]`, 200));
};
const dateIso = (v: unknown, chemin: string): string => {
  const s = texte(v, chemin, 40);
  if (Number.isNaN(Date.parse(s))) throw new ContratInvalideError(chemin, 'date ISO attendue');
  return s;
};
const identifiant = (v: unknown, chemin: string): string => {
  const s = texte(v, chemin, 200);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new ContratInvalideError(chemin, 'identifiant attendu');
  return s;
};

/** Une offre de la liste, relue champ par champ. `status` doit valoir ONLINE : la liste ne sert que des offres en ligne. */
export function lireItemListe(v: unknown, chemin = 'offre'): ItemListe {
  const o = objet(v, chemin);
  if (o.status !== 'ONLINE') throw new ContratInvalideError(`${chemin}.status`, `ONLINE attendu, ${JSON.stringify(o.status)?.slice(0, 40)} reçu`);
  // Le backend ne filtre pas sa liste sur `isActive` (`whereOffreCandidatable`) : présente, l'offre est publiable (D-444) ;
  // le champ doit seulement garder sa forme.
  if (typeof o.isActive !== 'boolean') throw new ContratInvalideError(`${chemin}.isActive`, 'booléen attendu');
  const maison = o.maison === null ? null : objet(o.maison, `${chemin}.maison`);
  const metier = o.jobCategoryRef === null || o.jobCategoryRef === undefined ? null : objet(o.jobCategoryRef, `${chemin}.jobCategoryRef`);
  return {
    id: identifiant(o.id, `${chemin}.id`),
    slug: identifiant(o.slug, `${chemin}.slug`),
    titre: texte(o.title, `${chemin}.title`, 500),
    lieu: texte(o.location, `${chemin}.location`, 500),
    latitude: nombreOuNull(o.latitude ?? null, `${chemin}.latitude`),
    longitude: nombreOuNull(o.longitude ?? null, `${chemin}.longitude`),
    salaire: texte(o.salary, `${chemin}.salary`, 200),
    salaireMin: nombreOuNull(o.salaryMin ?? null, `${chemin}.salaryMin`),
    salaireMax: nombreOuNull(o.salaryMax ?? null, `${chemin}.salaryMax`),
    devise: texteOuNull(o.salaryCurrency ?? null, `${chemin}.salaryCurrency`, 10),
    marque: texteOuNull(o.brandDescription ?? null, `${chemin}.brandDescription`),
    poste: texte(o.jobDescription, `${chemin}.jobDescription`),
    missions: texte(o.missions, `${chemin}.missions`),
    profil: texte(o.profile, `${chemin}.profile`),
    avantages: texteOuNull(o.advantages ?? null, `${chemin}.advantages`),
    visuel: texteOuNull(o.thumbnail ?? null, `${chemin}.thumbnail`, 2_000),
    publieeLe: dateIso(o.publishedAt, `${chemin}.publishedAt`),
    finLe: o.validThrough === null || o.validThrough === undefined ? null : dateIso(o.validThrough, `${chemin}.validThrough`),
    modifieeLe: dateIso(o.updatedAt, `${chemin}.updatedAt`),
    univers: liste(o.sectors, `${chemin}.sectors`),
    specialisations: liste(o.specializations, `${chemin}.specializations`),
    contrat: texte(o.contractType, `${chemin}.contractType`, 50),
    tempsDeTravail: texte(o.workTime, `${chemin}.workTime`, 50),
    metier: metier && { slug: identifiant(metier.slug, `${chemin}.jobCategoryRef.slug`), libelle: texte(metier.label, `${chemin}.jobCategoryRef.label`, 200) },
    maison: maison && { nom: texte(maison.name, `${chemin}.maison.name`, 200), slug: identifiant(maison.slug, `${chemin}.maison.slug`) },
  };
}

/**
 * La réponse entière : un tableau, sans identifiant répété. Une offre illisible est refusée et nommée ; les autres restent
 * lues. Aucun plafond n'est appliqué ici : c'est la photo qui juge une liste vide ou tronquée (`photo.ts`).
 */
export function lireListe(v: unknown): LectureListe {
  if (!Array.isArray(v)) throw new ListeInvalideError('liste', 'tableau attendu');
  if (v.length > 10 * LISTE_PLAFOND) throw new ListeInvalideError('liste', `${v.length} éléments, au-delà de toute liste servie`);
  const offres: OffreLue[] = [], refus: RefusListe[] = [];
  v.forEach((element, index) => {
    const chemin = `liste[${index}]`;
    try {
      const item = lireItemListe(element, chemin);
      offres.push({ index, id: item.id, brut: element as Record<string, unknown>, item });
    } catch (error) {
      if (!(error instanceof ContratInvalideError)) throw error;
      const id = element && typeof element === 'object' && typeof (element as Brut).id === 'string' ? ((element as Brut).id as string).slice(0, 200) : null;
      refus.push({ index, id, chemin: error.chemin, detail: error.message });
    }
  });
  const vus = new Set<string>();
  for (const { id } of offres) {
    if (vus.has(id)) throw new ListeInvalideError('liste', `identifiant ${id} servi deux fois`);
    vus.add(id);
  }
  return { taille: v.length, offres, refus };
}

/**
 * L'offre lue, dans le contrat catalogue version 1, avec le pays établi par ses coordonnées (ou `null`). Le résultat
 * passe par `lireOffre` : les mêmes bornes que pour une offre du flux, et un refus nommé si l'une n'est pas tenue.
 */
export function offreCatalogueDepuisListe(item: ItemListe, pays: string | null): OffreCatalogueV1 {
  const borne = item.salaireMin !== null || item.salaireMax !== null;
  return lireOffre({
    version: 1,
    id: item.id,
    slug: item.slug,
    anciensSlugs: [],
    titre: item.titre,
    maison: item.maison,
    univers: item.univers,
    specialisations: item.specialisations,
    metier: item.metier,
    contrat: item.contrat,
    tempsDeTravail: item.tempsDeTravail,
    experience: null,
    teletravail: null,
    lieu: { libelle: item.lieu, ville: null, arrondissement: null, codePostal: null, pays, latitude: item.latitude, longitude: item.longitude },
    salaire: { min: item.salaireMin, max: item.salaireMax, devise: borne ? item.devise : null, texte: item.salaire.trim() ? item.salaire : null },
    description: {
      marque: item.marque?.trim() ? item.marque : null,
      poste: item.poste,
      missions: item.missions,
      profil: item.profil,
      avantages: item.avantages?.trim() ? item.avantages : null,
    },
    visuel: item.visuel?.trim() ? item.visuel : null,
    publieeLe: item.publieeLe,
    finLe: item.finLe,
    modifieeLe: item.modifieeLe,
    candidature: { type: 'CATWALKS', url: `${URL_OFFRE_CATWALKS}${item.slug}` },
  }, `offre ${item.id}`);
}

/**
 * `lire` rend la liste ; `compter` rend la réponse de `GET {origine}/api/jobs/filters`, la route publique des facettes
 * du backend, qui compte TOUTES les offres candidatables sans plafond (même prédicat `whereOffreCandidatable` que la
 * liste). C'est le témoin indépendant de complétude : une liste plus courte que ce compte est tronquée, quel que soit
 * son plafond (pagination future, `take` abaissé), et ne retire rien (garde de D-444).
 */
export type SourceListe = { lire(): Promise<unknown>; compter(): Promise<unknown> };

/**
 * Le nombre d'offres candidatables annoncé par la route des facettes : la somme des comptes de `contractTypes` (une
 * valeur par offre, colonne obligatoire au backend). Toute autre forme est invalide : la complétude n'est alors pas
 * prouvée, et rien n'est retiré.
 */
export function lireCompte(v: unknown): number {
  const facettes = v && typeof v === 'object' && !Array.isArray(v) ? (v as Brut).contractTypes : undefined;
  if (!Array.isArray(facettes) || facettes.length > 50) throw new ListeInvalideError('facettes.contractTypes', 'liste attendue');
  return facettes.reduce<number>((total, f, i) => {
    const compte = f && typeof f === 'object' ? (f as Brut).count : undefined;
    if (typeof compte !== 'number' || !Number.isSafeInteger(compte) || compte < 0) throw new ListeInvalideError(`facettes.contractTypes[${i}].count`, 'entier attendu');
    return total + compte;
  }, 0);
}

/**
 * La cause d'une panne de transport, nommée pour l'alerte : « TypeError : fetch failed (ENOTFOUND) », jamais le seul nom
 * de l'erreur, qui ne distingue pas une redirection refusée d'une panne DNS.
 */
function causeTransport(error: unknown, defaut: string): string {
  if (!(error instanceof Error)) return defaut;
  const cause = (error as { cause?: unknown }).cause;
  const precision = cause && typeof cause === 'object'
    ? [(cause as { code?: unknown }).code, (cause as { message?: unknown }).message].find((v): v is string => typeof v === 'string' && v.length > 0)
    : undefined;
  return `${error.name} : ${error.message}${precision ? ` (${precision})` : ''}`.slice(0, 200);
}

/** Le corps lu morceau par morceau et coupé au-delà de la borne : un en-tête de longueur absent ou faux n'y change rien. */
async function lireBorne(reponse: Response, chemin: string): Promise<string> {
  if (!reponse.body) return '';
  const lecteur = reponse.body.getReader();
  const morceaux: Uint8Array[] = [];
  let octets = 0;
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      octets += value.byteLength;
      if (octets > OCTETS_MAX) {
        await lecteur.cancel().catch(() => undefined);
        throw new ListeInvalideError(chemin, `réponse au-delà de ${OCTETS_MAX} octets`);
      }
      morceaux.push(value);
    }
  } catch (error) {
    if (error instanceof ListeInvalideError) throw error;
    throw new ListeIndisponibleError(reponse.status, `${chemin} : ${causeTransport(error, 'lecture du corps interrompue')}`);
  }
  return Buffer.concat(morceaux).toString('utf8');
}

/**
 * La liste servie par le backend : `GET {origine}/api/jobs`, et son compte, `GET {origine}/api/jobs/filters` ; sans clé
 * (routes publiques), sans redirection suivie, bornées en temps et en taille. L'origine vient de la configuration (`CATALOGUE_LISTE_URL`), jamais d'une donnée reçue : https,
 * sans identifiants, sans chemin ni paramètre ; http n'est admis que vers la machine locale (stack et témoins).
 */
export function listeHttp(origine: string, fetchImpl: typeof fetch = fetch, delaiMs = 15_000): SourceListe {
  let base: URL;
  try { base = new URL(origine); } catch { throw new Error('CATALOGUE_LISTE_URL : URL attendue'); }
  const locale = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (!(base.protocol === 'https:' || (base.protocol === 'http:' && locale)) || base.username || base.password
    || base.search || base.hash || !['', '/'].includes(base.pathname))
    throw new Error('CATALOGUE_LISTE_URL : origine https nue attendue (http seulement vers la machine locale)');
  const lireJson = async (chemin: string): Promise<unknown> => {
    const cible = new URL(chemin, base).toString();
    assertPipelineRunning();
    assertBusinessUrl(cible);
    let reponse: Response;
    try {
      reponse = await fetchImpl(cible, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(delaiMs) });
    } catch (error) {
      throw new ListeIndisponibleError(null, `${chemin} : ${causeTransport(error, 'transport')}`);
    }
    if (!reponse.ok) throw new ListeIndisponibleError(reponse.status, `HTTP ${reponse.status} sur ${chemin}`);
    const annonce = Number(reponse.headers.get('content-length') ?? 0);
    if (annonce > OCTETS_MAX) throw new ListeInvalideError(chemin, `réponse de ${annonce} octets`);
    const corps = await lireBorne(reponse, chemin);
    try { return JSON.parse(corps) as unknown; } catch { throw new ListeInvalideError(chemin, 'JSON attendu'); }
  };
  return { lire: () => lireJson('/api/jobs'), compter: () => lireJson('/api/jobs/filters') };
}
