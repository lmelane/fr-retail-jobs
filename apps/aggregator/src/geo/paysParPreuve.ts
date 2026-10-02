import type { Prisma } from '@prisma/client';
import { paysDesCoordonnees, type Frontieres } from './frontieres.js';

/**
 * LE PAYS D'UNE OFFRE QUE LA CHAÎNE LAISSE SANS PAYS, SUR PREUVE SEULEMENT (D-520, offres sans pays, 02/10/2026).
 *
 * Une offre sans pays n'est trouvée par aucune recherche : 3 217 offres servies le 02/10/2026, dont 1 973 Boots. La chaîne
 * (`resolveGeography`, `declaredPlaceCountry.ts`) refuse à raison de déduire un pays d'une ville seule : « Paris » existe dans
 * plusieurs pays. Ce module ne s'applique qu'APRÈS elle, quand elle ne retient AUCUN pays et ne s'abstient pas sur une
 * contradiction (D-435, D-440 : une abstention reste une abstention). Il ne retient un pays que sur l'une de ces preuves :
 *
 *   1. COORDONNEES_ET_VILLE — le point natif de l'offre tombe dans un pays (tracé des frontières, `frontieres.ts`, D-444) ET le
 *      référentiel GeoNames (`GeoCityName`) connaît la ville de l'offre dans ce pays. Deux champs natifs indépendants qui
 *      concordent : « Aberdeen » existe dans six pays, le point de l'offre Boots en désigne un. Un point sans ville connue ne
 *      suffit pas (`POINT_NON_CORROBORE`) ; un point dont le pays ne connaît pas la ville est une contradiction
 *      (`COORDONNEES_DISCORDANTES` : Intersport publie des magasins de Morteau avec un point en Californie).
 *   2. VILLE_ET_SUBDIVISION — la ville et la subdivision écrite à sa suite (« Boston, MA ») ne désignent qu'un pays du
 *      référentiel (`subdivisionKeys`, la même clé que la recherche de proximité de D-496).
 *   3. VILLE_UNIQUE — le référentiel ne connaît le nom de la ville que dans un seul pays (« Vanves », « Shanghai »).
 *   4. SUBDIVISION_UNIQUE — sans ville, le lieu n'est qu'une subdivision qu'un seul pays connaît (« California »).
 *
 * LE MARCHÉ DE LA SOURCE EN CONTRAINTE (2 à 4). Le référentiel propose, la source dispose : le pays n'est retenu que s'il
 * figure parmi les pays des autres offres actives de la même source (`marcheDeLaSource`). C'est une contrainte qui ne peut
 * que REFUSER, jamais choisir entre deux pays : mesuré le 02/10/2026, elle écarte « Le-Mans » lu « Mans » (Turquie) et
 * « St-Cloud » lu « Cloud » (États-Unis) chez Nocibé, « Nord (59) » (Suisse) chez Printemps, « North East » (États-Unis)
 * chez Go Outdoors. Le prix assumé : une source dont aucune offre n'a encore de pays, ou dont le marché observé est faux,
 * garde ses offres sans pays (`MARCHE_DE_LA_SOURCE_INCONNU`, `HORS_MARCHE_DE_LA_SOURCE`). La preuve 1 n'y est pas soumise :
 * deux champs natifs concordants valent mieux que le marché observé (Boots n'a que GG, IM, JE et NF hors de ses 1 973 offres).
 *
 * Un pays de la source qui n'est déclaré nulle part dans ses offres (« tenant mono-pays ») n'est jamais une preuve : aucun
 * registre ne le porte, et un marché observé d'un seul pays ment (Caudalie : 15 offres en France, 33 « Europe (sauf
 * France) »). Ce qui reste sans pays garde sa cause (`CauseSansPays`) : l'état d'exposition le classe hors marché.
 */

export type MotifPays = 'COORDONNEES_ET_VILLE' | 'VILLE_ET_SUBDIVISION' | 'VILLE_UNIQUE' | 'SUBDIVISION_UNIQUE';
export type CauseSansPays =
  /** La chaîne s'abstient sur une contradiction entre champs déclarés (D-435, D-440) : jamais levée ici. */
  | 'CONTRADICTION_DECLAREE'
  /** Ni ville, ni lieu, ni point. */
  | 'LIEU_ABSENT'
  /** Un lieu que le référentiel ne connaît pas (« Brown Thomas », « JOBREQ00054977_JCP », « Remote »). */
  | 'LIEU_INCONNU'
  /** Une ville connue dans plusieurs pays, que rien ne départage (« Boston » sans État, sans point). */
  | 'VILLE_AMBIGUE'
  /** Un point natif dans un pays, sans ville connue pour le confirmer. */
  | 'POINT_NON_CORROBORE'
  /** Un point natif dans un pays qui ne connaît pas la ville de l'offre. */
  | 'COORDONNEES_DISCORDANTES'
  /** Le pays du référentiel n'est pas parmi ceux des autres offres de la source. */
  | 'HORS_MARCHE_DE_LA_SOURCE'
  /** Aucune autre offre active de la source n'a de pays : la contrainte ne peut rien confirmer. */
  | 'MARCHE_DE_LA_SOURCE_INCONNU';

export type PreuvePays =
  | { pays: string; motif: MotifPays; marche: readonly string[] }
  | { pays: null; cause: CauseSansPays };

/** Ce que le référentiel sait d'un nom de ville : les pays qui le portent, et ceux où la subdivision indiquée le confirme. */
export type VilleConnue = { pays: readonly string[]; paysAvecSubdivision: readonly string[] };

export type EntreesPreuve = {
  ville: string | null;
  /** La subdivision écrite à la suite de la ville dans le lieu (« MA » de « Boston, MA »), s'il y en a une. */
  subdivision: string | null;
  /** Le lieu brut, quand l'offre n'a pas de ville. */
  lieu: string | null;
  /** Le pays du point natif par le tracé des frontières, ou `null` (point absent, en mer, territoire sans code). */
  paysDuPoint: string | null;
  villeConnue: VilleConnue;
  /** Les pays que le référentiel connaît pour un lieu sans ville qui serait une subdivision. */
  subdivisionSeule: readonly string[];
  marche: readonly string[];
};

const unique = <T>(values: readonly T[]) => [...new Set(values)];

/** La décision, pure : mêmes entrées, même verdict, à l'ingestion comme au rattrapage du stock. */
export function decidePays(e: EntreesPreuve): PreuvePays {
  const villes = unique(e.villeConnue.pays);
  if (e.paysDuPoint) {
    if (villes.includes(e.paysDuPoint)) return { pays: e.paysDuPoint, motif: 'COORDONNEES_ET_VILLE', marche: e.marche };
    if (villes.length) return { pays: null, cause: 'COORDONNEES_DISCORDANTES' };
  }
  const propose = (pays: string, motif: MotifPays): PreuvePays => e.marche.includes(pays) ? { pays, motif, marche: e.marche }
    : { pays: null, cause: e.marche.length ? 'HORS_MARCHE_DE_LA_SOURCE' : 'MARCHE_DE_LA_SOURCE_INCONNU' };
  const sansPreuve = (cause: CauseSansPays): PreuvePays => ({ pays: null, cause: e.paysDuPoint ? 'POINT_NON_CORROBORE' : cause });
  if (e.ville) {
    const confirmes = unique(e.villeConnue.paysAvecSubdivision);
    if (confirmes.length === 1) return propose(confirmes[0], 'VILLE_ET_SUBDIVISION');
    if (confirmes.length > 1) return sansPreuve('VILLE_AMBIGUE');
    if (villes.length === 1) return propose(villes[0], 'VILLE_UNIQUE');
    return sansPreuve(villes.length ? 'VILLE_AMBIGUE' : 'LIEU_INCONNU');
  }
  const subdivisions = unique(e.subdivisionSeule);
  if (subdivisions.length === 1) return propose(subdivisions[0], 'SUBDIVISION_UNIQUE');
  if (subdivisions.length > 1) return sansPreuve('VILLE_AMBIGUE');
  return sansPreuve(e.lieu?.trim() ? 'LIEU_INCONNU' : 'LIEU_ABSENT');
}

/**
 * La subdivision écrite à la suite de la ville : le dernier segment du lieu qui porte une lettre et n'est pas la ville
 * elle-même (« AMILLY, 45200, Centre-Val de Loire » → « Centre-Val de Loire », « Landquart, Grisons, 7302 » → « Grisons »).
 * Un segment que le référentiel ne connaît pas comme subdivision (« Aberdare, Commercial Street ») ne confirme rien.
 */
export function subdivisionDuLieu(lieu: string | null | undefined, ville: string | null | undefined): string | null {
  const segments = (lieu ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return null;
  const cle = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  for (const segment of segments.slice(1).reverse()) {
    if (/\p{L}/u.test(segment) && cle(segment) !== cle(ville ?? '') && cle(segment) !== cle(segments[0])) return segment;
  }
  return null;
}

/** Un lieu sans ville ne se lit comme une subdivision que s'il est un seul nom de quatre lettres au moins : jamais un code. */
function subdivisionCandidate(lieu: string | null | undefined): string | null {
  const texte = lieu?.trim() ?? '';
  return texte && !/[,;|/]/.test(texte) && /\p{L}{4,}/u.test(texte) ? texte : null;
}

type Lecteur = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** Les pays où le référentiel connaît ce nom de ville, et ceux où la subdivision indiquée le confirme. */
export async function villeConnue(db: Lecteur, ville: string | null, subdivision: string | null): Promise<VilleConnue> {
  if (!ville?.trim()) return { pays: [], paysAvecSubdivision: [] };
  const rows = await db.$queryRaw<{ pays: string; confirme: boolean }[]>`
    SELECT n."countryCode" AS pays,
           bool_or(${subdivision}::text IS NOT NULL AND c."subdivisionKeys" && catwalks_subdivision_cles(${subdivision}::text)) AS confirme
      FROM "GeoCityName" n JOIN "GeoCity" c ON c."id" = n."cityId"
     WHERE n."nameKey" = catwalks_lieu_cle(${ville}::text)
     GROUP BY n."countryCode" ORDER BY n."countryCode"`;
  return { pays: rows.map((r) => r.pays), paysAvecSubdivision: rows.filter((r) => r.confirme).map((r) => r.pays) };
}

/** Les pays dont une subdivision porte ce nom (« California » → US), pour un lieu sans ville. */
export async function subdivisionConnue(db: Lecteur, lieu: string | null): Promise<string[]> {
  const nom = subdivisionCandidate(lieu);
  if (!nom) return [];
  const rows = await db.$queryRaw<{ pays: string }[]>`
    SELECT DISTINCT c."countryCode" AS pays FROM "GeoCity" c
     WHERE c."subdivisionKeys" && catwalks_subdivision_cles(${nom}::text) ORDER BY 1`;
  return rows.map((r) => r.pays);
}

/** Le marché observé d'une source : les pays des offres actives que portent ses publications actives. */
export async function marcheDeLaSource(db: Lecteur, sourceKey: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ pays: string }[]>`
    SELECT DISTINCT j."countryCode" AS pays FROM "JobSource" s JOIN "Job" j ON j."id" = s."jobId"
     WHERE s."sourceKey" = ${sourceKey} AND s."isActive" AND j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL
     ORDER BY 1`;
  return rows.map((r) => r.pays);
}

/** Ce que la décision lit d'une offre : sa ville (telle que la chaîne l'écrit), son lieu, son point natif, sa source. */
export type LieuDeLOffre = { sourceKey: string; ville: string | null; lieu: string | null; latitude: number | null; longitude: number | null };

/** Le point natif d'une offre, valide et hors (0, 0) — la même règle que `catwalks_coordonnees_valides` (D-496). */
export function paysDuPointNatif(latitude: number | null, longitude: number | null, frontieres?: Frontieres): string | null {
  if (latitude === null || longitude === null || (latitude === 0 && longitude === 0)) return null;
  const verdict = paysDesCoordonnees(latitude, longitude, frontieres);
  return verdict.pays;
}

/** Le marché de chaque source, lu une fois par passage quand l'appelant en garde la mémoire (rattrapage du stock). */
export type MemoireMarches = Map<string, Promise<string[]>>;

/** Lit le référentiel et le marché de la source, puis décide. Lecture seule. */
export async function preuvePays(db: Lecteur, offre: LieuDeLOffre, frontieres?: Frontieres, marches?: MemoireMarches): Promise<PreuvePays> {
  const subdivision = offre.ville ? subdivisionDuLieu(offre.lieu, offre.ville) : null;
  const marcheLu = marches?.get(offre.sourceKey) ?? marcheDeLaSource(db, offre.sourceKey);
  marches?.set(offre.sourceKey, marcheLu);
  const connue = await villeConnue(db, offre.ville, subdivision);
  const seule = offre.ville ? [] : await subdivisionConnue(db, offre.lieu);
  const marche = await marcheLu;
  return decidePays({ ville: offre.ville, subdivision, lieu: offre.lieu, paysDuPoint: paysDuPointNatif(offre.latitude, offre.longitude, frontieres),
    villeConnue: connue, subdivisionSeule: seule, marche });
}
