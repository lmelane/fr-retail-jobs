import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * D-496 — un extrait RÉEL de la base de villes (GeoNames `cities500` du 01/10/2026 : identifiants, coordonnées,
 * populations, subdivisions), pour les témoins de la proximité. Les clés de noms sont calculées par la base
 * (`catwalks_lieu_cle`), comme au chargement (apps/aggregator/scripts/geo/villes.py).
 */
export type VilleTemoin = {
  id: number; name: string; pays: string; a1: string | null; a2: string | null; a1nom: string | null; subdivision: string | null;
  lat: number; lon: number; pop: number; fc: string; suggestible?: boolean; variantes?: string[]; libelles?: Record<string, string>;
  /** Les noms de la région dans les langues de l'interface (alternateNamesV2 au chargement réel). */
  regions?: string[];
};

const IDF = 'Île-de-France';
export const VILLES_TEMOINS: readonly VilleTemoin[] = [
  { id: 2988507, name: 'Paris', pays: 'FR', a1: '11', a2: '75', a1nom: IDF, subdivision: '75', lat: 48.85341, lon: 2.3488, pop: 2138551, fc: 'PPLC', variantes: ['Lutece', 'Parigi'], libelles: { it: 'Parigi' } },
  // D-499 : un arrondissement est un lieu, avec son point ; « Paris 15 Vaugirard » s'affiche « Paris 15e » (villes.py).
  { id: 2970479, name: 'Paris 15e', pays: 'FR', a1: '11', a2: '75', a1nom: IDF, subdivision: '75', lat: 48.8412, lon: 2.3003, pop: 229713, fc: 'PPL', variantes: ['Paris 15 Vaugirard', 'Paris 15'] },
  { id: 2989487, name: 'Paris 9e', pays: 'FR', a1: '11', a2: '75', a1nom: IDF, subdivision: '75', lat: 48.8718, lon: 2.3399, pop: 57271, fc: 'PPL', variantes: ['Paris 09 Opéra', 'Paris 9'] },
  { id: 3025509, name: 'Chennevières-sur-Marne', pays: 'FR', a1: '11', a2: '94', a1nom: IDF, subdivision: '94', lat: 48.79702, lon: 2.54046, pop: 18314, fc: 'PPL', variantes: ['Chennevieres-sur-Marne'] },
  { id: 3027105, name: 'Champigny-sur-Marne', pays: 'FR', a1: '11', a2: '94', a1nom: IDF, subdivision: '94', lat: 48.81642, lon: 2.49366, pop: 76726, fc: 'PPL' },
  { id: 3022530, name: 'Créteil', pays: 'FR', a1: '11', a2: '94', a1nom: IDF, subdivision: '94', lat: 48.79266, lon: 2.46569, pop: 84833, fc: 'PPLA2', variantes: ['Creteil'] },
  { id: 2988867, name: 'Ozoir-la-Ferrière', pays: 'FR', a1: '11', a2: '77', a1nom: IDF, subdivision: '77', lat: 48.76699, lon: 2.66871, pop: 22530, fc: 'PPL' },
  { id: 2994798, name: 'Meaux', pays: 'FR', a1: '11', a2: '77', a1nom: IDF, subdivision: '77', lat: 48.96014, lon: 2.87885, pop: 53811, fc: 'PPLA3' },
  { id: 3018074, name: 'Fontainebleau', pays: 'FR', a1: '11', a2: '77', a1nom: IDF, subdivision: '77', lat: 48.40908, lon: 2.70177, pop: 19717, fc: 'PPLA3' },
  { id: 2985229, name: 'Provins', pays: 'FR', a1: '11', a2: '77', a1nom: IDF, subdivision: '77', lat: 48.55897, lon: 3.29939, pop: 12685, fc: 'PPLA3' },
  { id: 2989317, name: 'Orléans', pays: 'FR', a1: '24', a2: '45', a1nom: 'Centre-Val de Loire', subdivision: '45', lat: 47.90248, lon: 1.90407, pop: 116344, fc: 'PPLA', variantes: ['Orleans'] },
  { id: 2996944, name: 'Lyon', pays: 'FR', a1: '84', a2: '69', a1nom: 'Auvergne-Rhône-Alpes', subdivision: '69', lat: 45.74906, lon: 4.84789, pop: 520774, fc: 'PPLA' },
  { id: 2971053, name: 'Valence', pays: 'FR', a1: '84', a2: '26', a1nom: 'Auvergne-Rhône-Alpes', subdivision: '26', lat: 44.9256, lon: 4.90956, pop: 63864, fc: 'PPLA2' },
  { id: 2971054, name: 'Valence', pays: 'FR', a1: '76', a2: '82', a1nom: 'Occitanie', subdivision: '82', lat: 44.10823, lon: 0.89101, pop: 5039, fc: 'PPL' },
  { id: 8504417, name: 'La Defense', pays: 'FR', a1: '11', a2: '92', a1nom: IDF, subdivision: '92', lat: 48.89198, lon: 2.23881, pop: 20000, fc: 'PPLX', variantes: ['La Défense'], libelles: { fr: 'La Défense' } },
  { id: 2978742, name: 'Saint-Louis', pays: 'FR', a1: '44', a2: '68', a1nom: 'Grand Est', subdivision: '68', lat: 47.59206, lon: 7.55923, pop: 20871, fc: 'PPL' },
  { id: 2978738, name: 'Saint-Louis', pays: 'FR', a1: '93', a2: '13', a1nom: "Provence-Alpes-Côte d'Azur", subdivision: '13', lat: 43.345, lon: 5.359, pop: 9188, fc: 'PPLX' },
  { id: 4671654, name: 'Austin', pays: 'US', a1: 'TX', a2: '453', a1nom: 'Texas', subdivision: 'TX', lat: 30.26715, lon: -97.74306, pop: 974447, fc: 'PPLA' },
  { id: 4717560, name: 'Paris', pays: 'US', a1: 'TX', a2: '277', a1nom: 'Texas', subdivision: 'TX', lat: 33.66094, lon: -95.55551, pop: 24782, fc: 'PPLA2' },
  { id: 4303602, name: 'Paris', pays: 'US', a1: 'KY', a2: '017', a1nom: 'Kentucky', subdivision: 'KY', lat: 38.2098, lon: -84.25299, pop: 9870, fc: 'PPLA2' },
  // « Bourgogne » : une commune de la Marne (1 018 habitants) et l'ancien nom d'une région, qui garde sa recherche par subdivision.
  { id: 3030965, name: 'Bourgogne', pays: 'FR', a1: '44', a2: '51', a1nom: 'Grand Est', subdivision: '51', lat: 49.34962, lon: 4.07111, pop: 1018, fc: 'PPL' },
  { id: 3021372, name: 'Dijon', pays: 'FR', a1: '27', a2: '21', a1nom: 'Bourgogne-Franche-Comte', subdivision: '21', lat: 47.31344, lon: 5.01391, pop: 159941, fc: 'PPLA', regions: ['Bourgogne-Franche-Comté', 'Bourgogne'] },
  { id: 2969284, name: 'Vienne', pays: 'FR', a1: '84', a2: '38', a1nom: 'Auvergne-Rhône-Alpes', subdivision: '38', lat: 45.52569, lon: 4.87484, pop: 32293, fc: 'PPLA3' },
  { id: 4509177, name: 'Columbus', pays: 'US', a1: 'OH', a2: '049', a1nom: 'Ohio', subdivision: 'OH', lat: 39.96118, lon: -82.99879, pop: 913175, fc: 'PPLA' },
  { id: 5128581, name: 'New York City', pays: 'US', a1: 'NY', a2: null, a1nom: 'New York', subdivision: 'NY', lat: 40.71427, lon: -74.00597, pop: 8804190, fc: 'PPL', variantes: ['New York', 'NYC'] },
  { id: 2867714, name: 'Munich', pays: 'DE', a1: '02', a2: '091', a1nom: 'Bavaria', subdivision: null, lat: 48.13743, lon: 11.57549, pop: 1505005, fc: 'PPLA', variantes: ['Muenchen', 'München'], libelles: { de: 'München' }, regions: ['Bayern', 'Bavière'] },
];

const ID_CHARGEMENT = 4960001;

/** Sème la base de villes témoin (et la remplace si elle existe) ; rend le nombre de villes. */
export async function semerVilles(db: PrismaClient, villes: readonly VilleTemoin[] = VILLES_TEMOINS): Promise<number> {
  await viderVilles(db);
  await db.$executeRaw`INSERT INTO "GeoCityRelease" ("id", "source", "licence", "attribution", "files", "cities", "names", "labels")
    VALUES (${ID_CHARGEMENT}, 'témoin D-496', 'CC BY 4.0', 'Données géographiques : GeoNames (geonames.org), CC BY 4.0', '{}'::jsonb, ${villes.length}, 0, 0)`;
  for (const v of villes) {
    await db.$executeRaw`INSERT INTO "GeoCity" ("id", "name", "countryCode", "admin1Code", "admin2Code", "admin1Name", "subdivision",
      "subdivisionKeys", "latitude", "longitude", "population", "featureCode", "suggestible", "releaseId")
      VALUES (${v.id}, ${v.name}, ${v.pays}, ${v.a1}, ${v.a2}, ${v.a1nom}, ${v.subdivision},
        catwalks_subdivision_cles(VARIADIC ARRAY[${v.a1nom}, ${v.a1}, ${v.a2}, ${v.subdivision}]::text[] || ${v.regions ?? []}::text[]),
        ${v.lat}, ${v.lon}, ${v.pop}, ${v.fc}, ${v.suggestible ?? true}, ${ID_CHARGEMENT})`;
    const noms: [string, boolean][] = [[v.name, true], ...(v.variantes ?? []).map((n): [string, boolean] => [n, false])];
    await db.$executeRaw(Prisma.sql`INSERT INTO "GeoCityName" ("countryCode", "nameKey", "cityId", "primary")
      SELECT ${v.pays}, k, ${v.id}, bool_or(p) FROM (VALUES ${Prisma.join(noms.map(([n, p]) => Prisma.sql`(catwalks_lieu_cle(${n}), ${p})`))}) t(k, p)
      WHERE k IS NOT NULL GROUP BY k`);
    for (const [langue, libelle] of Object.entries(v.libelles ?? {})) {
      await db.$executeRaw`INSERT INTO "GeoCityLabel" ("cityId", "language", "label") VALUES (${v.id}, ${langue}, ${libelle})`;
    }
  }
  return villes.length;
}

/** D-499 — un extrait réel des codes postaux GeoNames (`export/zip/allCountries.zip`, 01/10/2026). */
export const CODES_POSTAUX_TEMOINS = [
  { pays: 'FR', code: '94430', lieu: 'Chennevières-sur-Marne', sub: '94', lat: 48.797, lon: 2.5405 },
  { pays: 'FR', code: '75015', lieu: 'Paris', sub: '75', lat: 48.8534, lon: 2.3488 },
  { pays: 'FR', code: '75015', lieu: 'Paris 15e', sub: '75', lat: 48.8412, lon: 2.3003 },
  { pays: 'US', code: '10001', lieu: 'New York', sub: 'NY', lat: 40.7484, lon: -73.9967 },
] as const;

export async function semerCodesPostaux(db: PrismaClient): Promise<void> {
  for (const c of CODES_POSTAUX_TEMOINS) {
    await db.$executeRaw`INSERT INTO "GeoPostalCode" ("countryCode", "postalCode", "postalKey", "placeName", "placeKey", "subdivision", "latitude", "longitude", "releaseId")
      VALUES (${c.pays}, ${c.code}, catwalks_code_postal_cle(${c.code}), ${c.lieu}, catwalks_lieu_cle(${c.lieu}), ${c.sub}, ${c.lat}, ${c.lon}, ${ID_CHARGEMENT})`;
  }
}

export async function viderVilles(db: PrismaClient): Promise<void> {
  await db.$executeRaw`DELETE FROM "GeoPostalCode"`;
  await db.$executeRaw`DELETE FROM "GeoCity"`;
  await db.$executeRaw`DELETE FROM "GeoCityRelease"`;
}
