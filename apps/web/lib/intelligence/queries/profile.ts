import { cached } from '../cache';
import {
  byCity, byCompany, byContract, byCountry, byFunction, byGroup, bySector, bySeniority, closedFacts, headline,
  newCities30d, topSkills, toFamilies, type CityCount, type CompanyCount, type Count, type CountryCount, type Headline,
  type ClosedFacts, type Scope,
} from '../facts';
import { series, type SnapshotScope } from '../snapshots';
import type { SnapshotPoint } from '../metrics';
import type { JobFamily } from '../taxonomy';

/**
 * Le « profil » standard d'un périmètre — le même jeu de blocs pour un pays,
 * une ville, un métier, une Maison, un groupe ou un secteur : faits de tête,
 * fermetures, répartitions, et la série de snapshots du périmètre quand elle
 * existe. Une requête par bloc, en parallèle, mémorisées 1 h par périmètre.
 */
export type Profile = {
  scope: Scope;
  headline: Headline;
  closed: ClosedFacts;
  /** Les N premiers pays (limite d'affichage). */
  countries: CountryCount[];
  /** Le nombre RÉEL de pays du périmètre — jamais la longueur de la liste tronquée (audit I-1 : Cartier « 15 pays » pour 33). */
  countriesTotal: number;
  countriesUnknown: number;
  cities: CityCount[];
  companies: CompanyCount[];
  groups: (Count & { new30: number; companies: number })[];
  sectors: (Count & { new30: number; companies: number })[];
  functions: (Count & { new30: number })[];
  families: { key: JobFamily | ''; count: number }[];
  seniority: Count[];
  contracts: Count[];
  skills: Count[];
  /** Villes apparues dans les 30 derniers jours (Maison seulement), sinon []. */
  newCities: { city: string; code: string | null; firstSeenAt: string }[];
  /** Série MarketSnapshot du périmètre (vide tant que le pipeline n'a rien écrit). */
  series: SnapshotPoint[];
};

export type ProfileOptions = {
  /** Scope + clé de snapshot du périmètre, pour lire sa série. */
  snapshot?: { scope: SnapshotScope; key: string; afterDate?: string | null };
  identityRevision?: string;
  /** Charger les compétences (`skills[]`) — utile sur métier / Maison. */
  skills?: boolean;
  /** Charger les « nouveaux marchés » — Maison seulement. */
  newCities?: boolean;
  limits?: { countries?: number; cities?: number; companies?: number };
};

export const getProfile = cached('profile', async (scope: Scope, options: ProfileOptions = {}): Promise<Profile> => {
  const lim = { countries: 15, cities: 15, companies: 15, ...options.limits };
  const [h, closed, countries, cities, companies, groups, sectors, functions, seniority, contracts, skills, newCities, snapshots] =
    await Promise.all([
      headline(scope),
      closedFacts(scope),
      byCountry(scope),
      byCity(scope, lim.cities),
      byCompany(scope, lim.companies),
      byGroup(scope, 15),
      bySector(scope),
      byFunction(scope),
      bySeniority(scope),
      byContract(scope),
      options.skills ? topSkills(scope, 20) : Promise.resolve([] as Count[]),
      options.newCities && scope.companyId ? newCities30d(scope.companyId) : Promise.resolve([]),
      options.snapshot ? series(options.snapshot.scope, options.snapshot.key, 400, options.snapshot.afterDate) : Promise.resolve([] as SnapshotPoint[]),
    ]);
  return {
    scope,
    headline: h,
    closed,
    countries: countries.rows.slice(0, lim.countries),
    countriesTotal: countries.rows.length,
    countriesUnknown: countries.unknown,
    cities,
    companies,
    groups,
    sectors,
    functions,
    families: toFamilies(functions),
    seniority,
    contracts,
    skills,
    newCities,
    series: snapshots,
  };
});
