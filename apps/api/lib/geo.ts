import { Prisma, prisma } from '@catwalks/db';
import { localeAffichage } from './presentation-locale';
import type { Perimetre } from '@catwalks/db/marches';
import type { PlanRecherche } from './search-plan';

/**
 * D-496 — LA RECHERCHE DE PROXIMITÉ. Un lieu cherché (le lieu de la barre, ou une ville du filtre `ville` : celles de
 * l'accueil de l'inscrit et des alertes) donne les offres autour de lui, de la plus proche à la plus éloignée, dans des
 * cercles qui s'élargissent tant qu'il y a moins de 20 offres. Le rayon n'est jamais exposé.
 *
 * D-499 — le lieu est un lieu reconnu de la base mondiale (ville, arrondissement, quartier : `GeoCity` ; code postal :
 * `GeoPostalCode` ; GeoNames, chargée par apps/aggregator/scripts/geo/villes.py), jamais une donnée de l'écran, et
 * chaque lieu est un point (« Paris 15e » cherche autour du 15e). Le point d'une offre est `geoLatitude`/`geoLongitude`
 * (coordonnées natives, sinon centre de son lieu, tenus par un déclencheur). Un lieu introuvable (et un code postal que
 * la base ne connaît pas) garde la comparaison texte d'avant ; le télétravail et le pays gardent la leur.
 */
export const ANNEAUX_KM = [15, 30, 50, 100] as const;
export const RAYON_MAX_KM = ANNEAUX_KM[ANNEAUX_KM.length - 1];
/** On élargit tant que le cercle compte MOINS de 20 offres (D-496). */
export const OFFRES_PAR_ANNEAU = 20;
/**
 * Un nom qui désigne à la fois une région du marché et une ville se lit comme la ville quand la ville est dans la région
 * de son nom (« New York », « Madrid », « Neuchâtel », « Zug »), compte au moins 50 000 habitants, ou porte une subdivision
 * (« Washington (DC) ») ; sinon comme la région, qui garde sa recherche par subdivision (« Texas », « Bayern »,
 * « Bretagne », « Delaware » plutôt que Delaware, Ohio). Les noms de région viennent de GeoNames, dans les langues de
 * l'interface (`villes.py`).
 */
export const POPULATION_VILLE_PLUTOT_QUE_REGION = 50_000;
const RAYON_TERRE_KM = 6371.0088;

/**
 * UN LIEU RECONNU (D-496, D-499) : une ville, un arrondissement, une commune (base `GeoCity`) ou un code postal
 * (`GeoPostalCode`). Chacun est un point : la recherche part autour de lui.
 */
export type VilleResolue = {
  /** « g2988507 » (identifiant GeoNames), « p:FR:94430 » ou « p:FR:94430:chennevieres sur marne » (code postal). */
  id: string;
  /** Le nom de la ville (« Paris », « Chennevières-sur-Marne ») : la comparaison texte des offres sans point le cherche. */
  nom: string;
  /** Ce que l'écran affiche et renvoie : « Paris (75) », « Paris 15e (75) », « 94430 Chennevières-sur-Marne (94) ». */
  libelle: string;
  pays: string;
  latitude: number;
  longitude: number;
};

/**
 * « Paris (75) » → Paris, indice 75 ; « Austin, TX » → Austin, indice TX ; « 94430 Chennevières-sur-Marne (94) » → code
 * 94430, Chennevières-sur-Marne, indice 94 ; « 94430 » ou « SW1A 1AA » → un code seul (`codeSeul`, le lieu l'a reconnu).
 */
export function lireSaisieLieu(texte: string, codeSeul = false): { nom: string | null; indice: string | null; code: string | null } {
  const t = texte.trim().replace(/\s+/g, ' ');
  if (codeSeul) return { nom: null, indice: null, code: t };
  let nom = t, indice: string | null = null;
  const parentheses = /^(.*\S)\s*\(([^()]{1,60})\)$/.exec(t);
  const virgule = t.indexOf(',');
  if (parentheses) { nom = parentheses[1].trim(); indice = parentheses[2].trim() || null; }
  else if (virgule > 0) { nom = t.slice(0, virgule).trim(); indice = t.slice(virgule + 1).trim() || null; }
  // Un code postal devant le nom : « 94430 Chennevières-sur-Marne », « 59-700 Rakowice ».
  const code = /^([0-9][0-9A-Z-]{1,9}|[A-Z]{1,2}[0-9][0-9A-Z]?) (.+)$/i.exec(nom);
  if (code && /\d/.test(code[1])) return { nom: code[2].trim(), indice, code: code[1] };
  return { nom, indice, code: null };
}

/** La langue des libellés de villes : celle de l'interface servie (« de-DE » → de ; « nb-NO » → nb). */
export function langueDesVilles(locale: string | undefined, perimetre: Perimetre): string {
  return localeAffichage(locale, perimetre).split('-')[0].toLowerCase();
}

export function libelleVille(v: { name: string; label: string | null; subdivision: string | null }): string {
  return `${v.label ?? v.name}${v.subdivision ? ` (${v.subdivision})` : ''}`;
}

type LigneResolue = {
  i: bigint; id: number | null; name: string | null; label: string | null; subdivision: string | null; pays: string | null;
  latitude: number | null; longitude: number | null; population: bigint | null; region: boolean; eponyme: boolean;
  /** Le code postal trouvé : sa clé, son écriture, le nombre de lieux qu'il dessert (le premier nommé), son point moyen. */
  pk: string | null; pcode: string | null; plieux: bigint | null; plieu: string | null; ppays: string | null; psub: string | null;
  plat: number | null; plon: number | null;
};

/** Mémoire courte par instance : l'accueil, la pagination et les alertes répètent les mêmes villes. */
const MEMOIRE_MS = 10 * 60_000;
const MEMOIRE_MAX = 2_000;
const memoire = new Map<string, { valeur: VilleResolue | null; expire: number }>();

/**
 * Les villes de saisies (lieu de la barre, valeurs du filtre `ville`), dans les pays du périmètre, en une requête : la
 * subdivision indiquée d'abord, puis une ville avant un quartier, puis la plus peuplée (`catwalks_ville_resolue`, la
 * même règle que pour les offres). `null` : introuvable, ou région (« Texas ») — la saisie garde sa comparaison texte.
 */
export async function resoudreVilles(saisies: readonly string[], perimetre: Perimetre, langue: string,
  codesSeuls: ReadonlySet<string> = new Set()): Promise<(VilleResolue | null)[]> {
  const pays = [...perimetre.pays].sort();
  const cle = (s: string) => `${pays.join(',')}|${langue}|${codesSeuls.has(s) ? 'cp:' : ''}${s.trim().toLowerCase()}`;
  const maintenant = Date.now();
  // Vider AVANT de lire : vidée après, la mémoire perdrait des saisies tenues pour connues (lues ensuite comme nulles).
  if (memoire.size > MEMOIRE_MAX) memoire.clear();
  const manquantes = [...new Set(saisies.filter((s) => (memoire.get(cle(s))?.expire ?? 0) <= maintenant))];
  if (manquantes.length) {
    const lues = manquantes.map((m) => lireSaisieLieu(m, codesSeuls.has(m)));
    // Un code postal d'abord (D-499) : le code complet, sinon sa première partie (« SW1A 1AA » : GeoNames ne porte que
    // « SW1A ») ; avec le nom qui le suit s'il y en a un. Sinon la ville du nom (`catwalks_ville_resolue`).
    const lignes = await prisma.$queryRaw<LigneResolue[]>(Prisma.sql`
      SELECT s.i, c."id", c."name", l."label", c."subdivision", c."countryCode" AS pays, c."latitude", c."longitude", c."population",
        s.nom IS NOT NULL AND EXISTS (SELECT 1 FROM "GeoCity" r WHERE r."countryCode" = ANY(${pays}::text[])
          AND r."subdivisionKeys" @> ARRAY[catwalks_lieu_cle(s.nom)]) AS region,
        coalesce(c."subdivisionKeys" @> ARRAY[catwalks_lieu_cle(s.nom)], false) AS eponyme,
        b.k AS pk, post.pcode, post.plieux, post.plieu, post.ppays, post.psub, post.plat, post.plon
      FROM unnest(${lues.map((l) => l.nom)}::text[], ${lues.map((l) => l.indice)}::text[], ${lues.map((l) => l.code)}::text[])
        WITH ORDINALITY AS s(nom, indice, code, i)
      LEFT JOIN LATERAL (
        SELECT pc."postalKey" AS k FROM "GeoPostalCode" pc
         WHERE s.code IS NOT NULL AND pc."countryCode" = ANY(${pays}::text[])
           AND pc."postalKey" IN (catwalks_code_postal_cle(s.code), catwalks_code_postal_cle(split_part(btrim(s.code), ' ', 1)))
           AND (s.nom IS NULL OR pc."placeKey" = catwalks_lieu_cle(s.nom) OR pc."placeKey" LIKE catwalks_lieu_cle(s.nom) || ' %')
         ORDER BY (pc."postalKey" = catwalks_code_postal_cle(s.code)) DESC LIMIT 1) b ON true
      LEFT JOIN LATERAL (
        SELECT min(pc."postalCode") AS pcode, count(*) AS plieux, min(pc."placeName") AS plieu, min(pc."countryCode") AS ppays,
               min(pc."subdivision") AS psub, avg(pc."latitude") AS plat, avg(pc."longitude") AS plon
          FROM "GeoPostalCode" pc
         WHERE b.k IS NOT NULL AND pc."countryCode" = ANY(${pays}::text[]) AND pc."postalKey" = b.k
           AND (s.nom IS NULL OR pc."placeKey" = catwalks_lieu_cle(s.nom) OR pc."placeKey" LIKE catwalks_lieu_cle(s.nom) || ' %')
           -- « 75015 » dessert « Paris » et « Paris 15e » : le lieu le plus précis seulement.
           AND NOT EXISTS (SELECT 1 FROM "GeoPostalCode" fin WHERE fin."countryCode" = pc."countryCode"
             AND fin."postalKey" = pc."postalKey" AND fin."placeKey" LIKE pc."placeKey" || ' %')) post ON true
      LEFT JOIN "GeoCity" c ON b.k IS NULL AND s.nom IS NOT NULL AND c."id" = catwalks_ville_resolue(${pays}::text[], s.nom, s.indice)
      LEFT JOIN "GeoCityLabel" l ON l."cityId" = c."id" AND l."language" = ${langue}`);
    for (const ligne of lignes) {
      const saisie = manquantes[Number(ligne.i) - 1];
      memoire.set(cle(saisie), { valeur: lieuDeLaLigne(ligne, lues[Number(ligne.i) - 1]), expire: maintenant + MEMOIRE_MS });
    }
  }
  return saisies.map((s) => memoire.get(cle(s))?.valeur ?? null);
}

function lieuDeLaLigne(ligne: LigneResolue, lue: { indice: string | null }): VilleResolue | null {
  if (ligne.pk && ligne.plat !== null && ligne.plon !== null) {
    const seul = Number(ligne.plieux) === 1;
    return { id: `p:${ligne.ppays}:${ligne.pk}${seul ? `:${ligne.plieu}` : ''}`, nom: ligne.plieu!, pays: ligne.ppays!,
      latitude: ligne.plat, longitude: ligne.plon,
      libelle: `${ligne.pcode}${seul ? ` ${ligne.plieu}` : ''}${ligne.psub ? ` (${ligne.psub})` : ''}` };
  }
  // Une saisie qui porte une subdivision (« Washington (DC) », choisie dans les suggestions) désigne une ville.
  const region = !lue.indice && ligne.region && !ligne.eponyme
    && (ligne.id === null || Number(ligne.population ?? 0) < POPULATION_VILLE_PLUTOT_QUE_REGION);
  if (ligne.id === null || region || ligne.latitude === null || ligne.longitude === null) return null;
  return { id: `g${ligne.id}`, nom: ligne.name!, pays: ligne.pays!, latitude: ligne.latitude, longitude: ligne.longitude,
    libelle: libelleVille({ name: ligne.name!, label: ligne.label, subdivision: ligne.subdivision }) };
}

/** Remise à zéro entre deux témoins (une base rechargée). */
export function oublierVilles() {
  memoire.clear();
}

/** Ce que la proximité ajoute au plan : le lieu de la barre résolu, et les villes du filtre `ville` résolues. */
export type Proximite = {
  lieu: VilleResolue | null;
  /** Les villes du filtre résolues, et les valeurs que la base ne connaît pas (gardées en égalité de texte). */
  villes: { resolues: VilleResolue[]; texte: string[] } | null;
};

/** Le plan, avec ses villes résolues. Sans ville cherchée, le plan est rendu tel quel (aucune requête). */
export async function localiserPlan(plan: PlanRecherche, locale: string | undefined): Promise<PlanRecherche> {
  // D-499 : un code postal tapé seul (« 94430 ») est un lieu reconnu ; inconnu de la base, il garde son préfixe d'avant.
  const lieu = plan.lieu?.type === 'ville' ? plan.lieu.cityLoose : plan.lieu?.type === 'codePostal' ? plan.lieu.postalCode : null;
  const villes = plan.selections.ville ?? [];
  if (!lieu && !villes.length) return plan;
  const saisies = [...(lieu ? [lieu] : []), ...villes];
  const codes = new Set(plan.lieu?.type === 'codePostal' && lieu ? [lieu] : []);
  const resolues = await resoudreVilles(saisies, plan.perimetre, langueDesVilles(locale, plan.perimetre), codes);
  const lieuResolu = lieu ? resolues[0] : null;
  const desVilles = resolues.slice(lieu ? 1 : 0);
  const villesResolues = desVilles.filter((v): v is VilleResolue => v !== null);
  const proximite: Proximite = {
    lieu: lieuResolu,
    villes: villesResolues.length ? {
      resolues: [...new Map(villesResolues.map((v) => [v.id, v])).values()],
      texte: villes.filter((_v, i) => desVilles[i] === null),
    } : null,
  };
  return proximite.lieu || proximite.villes ? { ...plan, proximite } : plan;
}

/**
 * La distance en kilomètres (haversine) entre un point et les colonnes d'une ligne ; NULLE pour une ligne sans point.
 * La garde est explicite : `least()` ignore un NULL, et `asin(least(1, NULL))` rendrait la demi-circonférence terrestre
 * (20 015 km) au lieu de « sans point » (défaut attrapé par le témoin des offres sans point, proximite-d496.test.ts).
 */
export function distanceKm(p: { latitude: number; longitude: number }, lat: Prisma.Sql, lon: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(CASE WHEN ${lat} IS NULL OR ${lon} IS NULL THEN NULL::float8 ELSE ${RAYON_TERRE_KM}::float8 * 2 * asin(least(1::float8, sqrt(
    power(sin(radians(${lat} - ${p.latitude}::float8) / 2), 2)
    + cos(radians(${p.latitude}::float8)) * cos(radians(${lat})) * power(sin(radians(${lon} - ${p.longitude}::float8) / 2), 2)))) END)`;
}

/**
 * Le filtre grossier, indexable (`Job_geo_point_actif_idx`) : la boîte qui contient le cercle de `km`. Un degré de
 * latitude mesure au moins 110,574 km ; un degré de longitude 111,320 km × cos(latitude), pris au bord le plus proche
 * du pôle. Une boîte qui franchirait l'antiméridien ou un pôle ne borne que la latitude.
 */
export function boiteSql(p: { latitude: number; longitude: number }, km: number, lat: Prisma.Sql, lon: Prisma.Sql): Prisma.Sql {
  const dLat = km / 110.574;
  const latMin = p.latitude - dLat, latMax = p.latitude + dLat;
  const bord = Math.max(Math.abs(latMin), Math.abs(latMax));
  const parLatitude = Prisma.sql`${lat} BETWEEN ${latMin}::float8 AND ${latMax}::float8`;
  if (bord >= 89) return parLatitude;
  const dLon = km / (111.32 * Math.cos((bord * Math.PI) / 180));
  const lonMin = p.longitude - dLon, lonMax = p.longitude + dLon;
  if (lonMin < -180 || lonMax > 180) return parLatitude;
  return Prisma.sql`${parLatitude} AND ${lon} BETWEEN ${lonMin}::float8 AND ${lonMax}::float8`;
}

/** L'anneau d'une distance : 0 jusqu'à 15 km (et sans distance : une offre trouvée par son texte), 1, 2, puis 3. */
export function anneauSql(distance: Prisma.Sql): Prisma.Sql {
  const branches = ANNEAUX_KM.slice(0, -1).map((km, i) => Prisma.sql`WHEN ${distance} <= ${km}::float8 THEN ${i}`);
  return Prisma.sql`(CASE WHEN ${distance} IS NULL THEN 0 ${Prisma.join(branches, ' ')} ELSE ${ANNEAUX_KM.length - 1} END)`;
}

/**
 * LE COMPTE D'UN GROUPE DANS SON CERCLE : le plus petit anneau qui compte au moins 20 offres, sinon le plus large. C'est
 * exactement ce que montrerait la recherche restreinte à ce groupe : la facette « CDI (25) » annonce la liste qu'un
 * clic sur CDI affichera, même quand ce clic élargit le cercle.
 */
export function compteDansLeCercle(anneau: Prisma.Sql, compter: Prisma.Sql = Prisma.sql`count(*)`): Prisma.Sql {
  const n = (k: number) => Prisma.sql`${compter} FILTER (WHERE ${anneau} <= ${k})`;
  const branches = ANNEAUX_KM.slice(0, -1).map((_km, k) => Prisma.sql`WHEN ${n(k)} >= ${OFFRES_PAR_ANNEAU} THEN ${n(k)}`);
  return Prisma.sql`(CASE ${Prisma.join(branches, ' ')} ELSE ${n(ANNEAUX_KM.length - 1)} END)`;
}
