import { cached } from '../cache';
import { byCity, byCompany, byCountry, byFunction, byGroup, bySector, closedFacts, headline, type CityCount, type CompanyCount, type Count, type CountryCount, type Headline, type ClosedFacts } from '../facts';
import { latestAndBefore, series } from '../snapshots';
import type { SnapshotPoint } from '../metrics';

/**
 * Données de la home `/intelligence` : faits globaux, carte (pays : volume et
 * nouvelles 30 j), tops, série globale (CGHI + momentum), et « où le
 * recrutement accélère » — comparaison J-7 par pays LUE dans les snapshots
 * (vide tant qu'il n'y a pas 8 jours d'historique).
 */
export type HomeData = {
  headline: Headline;
  closed: ClosedFacts;
  countries: CountryCount[];
  countriesUnknown: number;
  cities: CityCount[];
  functions: (Count & { new30: number })[];
  sectors: (Count & { new30: number; companies: number })[];
  groups: (Count & { new30: number; companies: number })[];
  companies: CompanyCount[];
  global: SnapshotPoint[];
  accelerating: { key: string; now: SnapshotPoint; before: SnapshotPoint | null }[];
};

export const getHome = cached('home', async (): Promise<HomeData> => {
  const [h, closed, countries, cities, functions, sectors, groups, companies, global, accelerating] = await Promise.all([
    headline(),
    closedFacts(),
    byCountry(),
    byCity({}, 10),
    byFunction(),
    bySector(),
    byGroup({}, 10),
    byCompany({}, 10),
    series('global', '', 400),
    latestAndBefore('country', 7),
  ]);
  return {
    headline: h,
    closed,
    countries: countries.rows,
    countriesUnknown: countries.unknown,
    cities,
    functions,
    sectors,
    groups,
    companies,
    global,
    accelerating,
  };
});
