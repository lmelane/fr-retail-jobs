import { feature } from 'topojson-client';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, Geometry } from 'geojson';
import world from 'world-atlas/countries-110m.json';
import { alpha2FromNumeric, ANTARCTICA_NUMERIC } from './country-ids';

/**
 * Géométrie de la carte du monde (world-atlas 110m, ISC) projetée UNE fois au
 * chargement du module, côté serveur : un `<path d>` par pays, indexé alpha-2.
 * Antarctique retirée. Les entités sans id (Chypre Nord, Somaliland, Kosovo)
 * restent tracées, sans code — donc « sans offre ».
 */

export const MAP_WIDTH = 960;
export const MAP_HEIGHT = 470;

export type CountryPath = { id: string; code: string | null; d: string };

type CountryProps = { name?: string };

function build(): CountryPath[] {
  const topo = world as unknown as Topology<{ countries: GeometryCollection<CountryProps> }>;
  const collection = feature(topo, topo.objects.countries);
  const projection = geoNaturalEarth1().fitSize([MAP_WIDTH, MAP_HEIGHT], {
    type: 'FeatureCollection',
    // L'ajustement se fait sans l'Antarctique : elle n'est pas dessinée.
    features: collection.features.filter((f) => String(f.id) !== ANTARCTICA_NUMERIC),
  });
  // Une décimale suffit sur un viewBox de 960 px : le SVG rendu pèse ~40 %
  // de moins, sans différence visible.
  const path = geoPath(projection).digits(1);
  const out: CountryPath[] = [];
  (collection.features as Feature<Geometry, CountryProps>[]).forEach((f, i) => {
    // Trois entités n'ont pas d'id dans l'atlas : un id de repli unique par
    // position, pour que les clés React restent uniques.
    const id = f.id === undefined || f.id === null ? `n${i}` : String(f.id);
    if (id === ANTARCTICA_NUMERIC) return;
    const d = path(f);
    if (!d) return;
    out.push({ id, code: alpha2FromNumeric(f.id as string | number | undefined), d });
  });
  return out;
}

let cache: CountryPath[] | null = null;

export function countryPaths(): CountryPath[] {
  if (!cache) cache = build();
  return cache;
}
