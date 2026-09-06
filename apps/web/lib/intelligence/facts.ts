import { cache } from 'react';
import { prisma, Prisma } from '@catwalks/db';
import { DatabaseUnavailableError } from '@/lib/jobs';
import { countryCode } from '@/lib/countries';
import { familyOf, type JobFamily } from './taxonomy';

/**
 * FAITS (niveau 1) : des comptes observés dans `Job`, agrégés en SQL
 * (`$queryRaw` paramétré — jamais d'interpolation de chaîne), jamais un
 * `findMany` sur le catalogue. Chaque fonction accepte un `Scope` (pays, ville,
 * Maison, groupe, secteur, métier) et rend des nombres ou des lignes triées.
 *
 * Le pays est lu à la source : `isFrance` (fiable) pour la France, sinon les
 * graphies brutes de `Job.country` repliées sur un code ISO-2 via
 * `lib/countries` — la prod est normalisée ISO, une copie locale plus ancienne
 * mélange « Italie » / « Italy » / « IT » ; la couche tient les deux.
 */

export type Scope = {
  /** Code ISO-2 canonique (FR, IT…). */
  country?: string;
  /** Ville, comparée sans casse ; exige `country`. */
  city?: string;
  companyId?: string;
  group?: string;
  /** Valeur CompanySector. */
  sector?: string;
  /** Clé de Job.jobFunction. */
  fn?: string;
};

export type Count = { key: string; count: number };
export type CountryCount = { code: string; active: number; new30: number; companies: number };
export type CityCount = { code: string; city: string; active: number; new30: number; companies: number };
export type CompanyCount = {
  id: string;
  name: string;
  group: string | null;
  sector: string | null;
  domain: string | null;
  active: number;
  new30: number;
};

export type Headline = {
  active: number;
  new24h: number;
  new7d: number;
  new30d: number;
  new90d: number;
  reopened: number;
  ai: number;
  retail: number;
  unclassifiedFunction: number;
  unclassifiedSeniority: number;
  companies: number;
  cities: number;
  /** ISO de la dernière observation (max lastSeenAt), null si aucune offre. */
  lastSeenAt: string | null;
};

export type ClosedFacts = {
  closed7d: number;
  closed30d: number;
  /** Médiane de (closedAt − firstSeenAt) en jours sur les fermées des 30 derniers jours. */
  medianLifespanDays30: number | null;
  /** Taille de cet échantillon. */
  closedSample30: number;
};

const FROM = Prisma.sql`FROM "Job" j JOIN "Company" c ON c.id = j."companyId"`;

async function run<T>(query: Prisma.Sql): Promise<T[]> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    return await prisma.$queryRaw<T[]>(query);
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

/**
 * Graphies brutes de `Job.country` (en minuscules) qui se replient sur un code.
 * Lues en base, pas devinées : la liste des valeurs distinctes est courte.
 */
const distinctCountries = cache(() => run<{ country: string }>(Prisma.sql`SELECT DISTINCT country FROM "Job" WHERE country IS NOT NULL`));

export async function countrySpellings(code: string): Promise<string[]> {
  // Mémorisé par requête (React cache) : la même liste servait 20 fois par page (audit I-5).
  const rows = await distinctCountries();
  return rows.map((r) => r.country.toLowerCase()).filter((raw) => countryCode(raw) === code);
}

/** Fragment WHERE du périmètre (sans `isActive` : le caller choisit vivantes ou fermées). */
export async function scopeSql(scope: Scope): Promise<Prisma.Sql> {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (scope.country) {
    if (scope.country === 'FR') {
      parts.push(Prisma.sql`j."isFrance"`);
    } else {
      const spellings = await countrySpellings(scope.country);
      if (spellings.length === 0) parts.push(Prisma.sql`FALSE`);
      else parts.push(Prisma.sql`NOT j."isFrance" AND lower(j.country) IN (${Prisma.join(spellings)})`);
    }
  }
  if (scope.city) parts.push(Prisma.sql`lower(j.city) = ${scope.city.toLowerCase()}`);
  if (scope.companyId) parts.push(Prisma.sql`j."companyId" = ${scope.companyId}`);
  if (scope.group) parts.push(Prisma.sql`c."parentGroup" = ${scope.group}`);
  if (scope.sector) parts.push(Prisma.sql`c.sector::text = ${scope.sector}`);
  if (scope.fn) parts.push(Prisma.sql`j."jobFunction" = ${scope.fn}`);
  return Prisma.join(parts, ' AND ');
}

const NEW30 = Prisma.sql`count(*) FILTER (WHERE j."firstSeenAt" >= now() - interval '30 days')::int`;

export async function headline(scope: Scope = {}): Promise<Headline> {
  const where = await scopeSql(scope);
  const [row] = await run<Headline>(Prisma.sql`
    SELECT
      count(*)::int AS "active",
      count(*) FILTER (WHERE j."firstSeenAt" >= now() - interval '1 day')::int AS "new24h",
      count(*) FILTER (WHERE j."firstSeenAt" >= now() - interval '7 days')::int AS "new7d",
      ${NEW30} AS "new30d",
      count(*) FILTER (WHERE j."firstSeenAt" >= now() - interval '90 days')::int AS "new90d",
      count(*) FILTER (WHERE j."reopenedCount" > 0)::int AS "reopened",
      count(*) FILTER (WHERE j."isAiRelated")::int AS "ai",
      count(*) FILTER (WHERE j."isRetail")::int AS "retail",
      count(*) FILTER (WHERE j."jobFunction" IS NULL)::int AS "unclassifiedFunction",
      count(*) FILTER (WHERE j.seniority IS NULL)::int AS "unclassifiedSeniority",
      count(DISTINCT j."companyId")::int AS "companies",
      count(DISTINCT lower(j.city))::int AS "cities",
      to_char(max(j."lastSeenAt") AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastSeenAt"
    ${FROM} WHERE j."isActive" AND ${where}`);
  return row;
}

export async function closedFacts(scope: Scope = {}): Promise<ClosedFacts> {
  const where = await scopeSql(scope);
  const [row] = await run<{ closed7d: number; closed30d: number; median: number | null; sample: number }>(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE j."closedAt" >= now() - interval '7 days')::int AS "closed7d",
      count(*) FILTER (WHERE j."closedAt" >= now() - interval '30 days')::int AS "closed30d",
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (j."closedAt" - j."firstSeenAt")) / 86400.0)
        FILTER (WHERE j."closedAt" >= now() - interval '30 days'))::float AS "median",
      count(*) FILTER (WHERE j."closedAt" >= now() - interval '30 days')::int AS "sample"
    ${FROM} WHERE NOT j."isActive" AND j."closedAt" IS NOT NULL AND ${where}`);
  return { closed7d: row.closed7d, closed30d: row.closed30d, medianLifespanDays30: row.median, closedSample30: row.sample };
}

/** Pays : groupé sur (isFrance, graphie brute) puis replié sur un code ISO-2. */
export async function byCountry(scope: Scope = {}): Promise<{ rows: CountryCount[]; unknown: number }> {
  const where = await scopeSql(scope);
  const raw = await run<{ isFrance: boolean; country: string | null; active: number; new30: number; companies: number }>(Prisma.sql`
    SELECT j."isFrance" AS "isFrance", j.country, count(*)::int AS "active", ${NEW30} AS "new30",
           count(DISTINCT j."companyId")::int AS "companies"
    ${FROM} WHERE j."isActive" AND ${where} GROUP BY 1, 2`);
  const merged = new Map<string, CountryCount>();
  let unknown = 0;
  for (const r of raw) {
    const code = r.isFrance ? 'FR' : countryCode(r.country);
    if (!code) {
      unknown += r.active;
      continue;
    }
    const cur = merged.get(code) ?? { code, active: 0, new30: 0, companies: 0 };
    // La prod est ISO (une graphie par pays) ; si une copie en mélange encore,
    // le max des graphies ne sur-compte jamais une Maison (audit I-1 : « 6 »
    // Maisons aux États-Unis sur la home, 5 sur la page pays).
    merged.set(code, { code, active: cur.active + r.active, new30: cur.new30 + r.new30, companies: Math.max(cur.companies, r.companies) });
  }
  return { rows: [...merged.values()].sort((a, b) => b.active - a.active), unknown };
}

/** Villes : (pays, ville) repliées sans casse ; la graphie la plus fréquente est gardée. */
export async function byCity(scope: Scope = {}, limit = 50): Promise<CityCount[]> {
  const where = await scopeSql(scope);
  const raw = await run<{ isFrance: boolean; country: string | null; city: string; active: number; new30: number; companies: number }>(Prisma.sql`
    SELECT j."isFrance" AS "isFrance", j.country, j.city, count(*)::int AS "active", ${NEW30} AS "new30",
           count(DISTINCT j."companyId")::int AS "companies"
    ${FROM} WHERE j."isActive" AND j.city IS NOT NULL AND ${where} GROUP BY 1, 2, 3 ORDER BY 4 DESC`);
  const merged = new Map<string, CityCount>();
  for (const r of raw) {
    const code = r.isFrance ? 'FR' : countryCode(r.country);
    if (!code) continue;
    const key = `${code}|${r.city.trim().toLowerCase()}`;
    const cur = merged.get(key);
    if (cur) merged.set(key, { ...cur, active: cur.active + r.active, new30: cur.new30 + r.new30, companies: Math.max(cur.companies, r.companies) });
    else merged.set(key, { code, city: r.city.trim(), active: r.active, new30: r.new30, companies: r.companies });
  }
  return [...merged.values()].sort((a, b) => b.active - a.active).slice(0, limit);
}

export async function byCompany(scope: Scope = {}, limit = 50): Promise<CompanyCount[]> {
  const where = await scopeSql(scope);
  return run<CompanyCount>(Prisma.sql`
    SELECT j."companyId" AS "id", c.name, c."parentGroup" AS "group", c.sector::text AS "sector", c.domain,
           count(*)::int AS "active", ${NEW30} AS "new30"
    ${FROM} WHERE j."isActive" AND ${where}
    GROUP BY 1, 2, 3, 4, 5 ORDER BY 6 DESC, 2 ASC LIMIT ${limit}`);
}

export async function byGroup(scope: Scope = {}, limit = 50): Promise<(Count & { new30: number; companies: number })[]> {
  const where = await scopeSql(scope);
  return run<Count & { new30: number; companies: number }>(Prisma.sql`
    SELECT c."parentGroup" AS "key", count(*)::int AS "count", ${NEW30} AS "new30", count(DISTINCT j."companyId")::int AS "companies"
    ${FROM} WHERE j."isActive" AND c."parentGroup" IS NOT NULL AND ${where}
    GROUP BY 1 ORDER BY 2 DESC LIMIT ${limit}`);
}

export async function bySector(scope: Scope = {}): Promise<(Count & { new30: number; companies: number })[]> {
  const where = await scopeSql(scope);
  return run<Count & { new30: number; companies: number }>(Prisma.sql`
    SELECT c.sector::text AS "key", count(*)::int AS "count", ${NEW30} AS "new30", count(DISTINCT j."companyId")::int AS "companies"
    ${FROM} WHERE j."isActive" AND ${where} GROUP BY 1 ORDER BY 2 DESC`);
}

/** Métier : clé nulle rendue '' (« Non classé »), toujours présente dans la liste. */
export async function byFunction(scope: Scope = {}): Promise<(Count & { new30: number })[]> {
  const where = await scopeSql(scope);
  const rows = await run<{ key: string | null; count: number; new30: number }>(Prisma.sql`
    SELECT j."jobFunction" AS "key", count(*)::int AS "count", ${NEW30} AS "new30"
    ${FROM} WHERE j."isActive" AND ${where} GROUP BY 1 ORDER BY 2 DESC`);
  return rows.map((r) => ({ key: r.key ?? '', count: r.count, new30: r.new30 }));
}

export async function bySeniority(scope: Scope = {}): Promise<Count[]> {
  const where = await scopeSql(scope);
  const rows = await run<{ key: string | null; count: number }>(Prisma.sql`
    SELECT j.seniority AS "key", count(*)::int AS "count" ${FROM} WHERE j."isActive" AND ${where} GROUP BY 1 ORDER BY 2 DESC`);
  return rows.map((r) => ({ key: r.key ?? '', count: r.count }));
}

export async function byContract(scope: Scope = {}): Promise<Count[]> {
  const where = await scopeSql(scope);
  const rows = await run<{ key: string | null; count: number }>(Prisma.sql`
    SELECT j.contract AS "key", count(*)::int AS "count" ${FROM} WHERE j."isActive" AND ${where} GROUP BY 1 ORDER BY 2 DESC`);
  return rows.map((r) => ({ key: r.key && r.key !== 'UNKNOWN' ? r.key : '', count: r.count }));
}

/** Famille (retail / atelier / corporate / non classé), dérivée du métier. */
export function toFamilies(functions: ReadonlyArray<Count>): { key: JobFamily | ''; count: number }[] {
  const acc = new Map<JobFamily | '', number>([['retail', 0], ['craft', 0], ['corporate', 0], ['', 0]]);
  for (const f of functions) {
    const fam = familyOf(f.key) ?? '';
    acc.set(fam, (acc.get(fam) ?? 0) + f.count);
  }
  return [...acc.entries()].map(([key, count]) => ({ key, count }));
}

export async function topSkills(scope: Scope = {}, limit = 20): Promise<Count[]> {
  const where = await scopeSql(scope);
  return run<Count>(Prisma.sql`
    SELECT s AS "key", count(*)::int AS "count"
    FROM "Job" j JOIN "Company" c ON c.id = j."companyId", unnest(j.skills) AS s
    WHERE j."isActive" AND ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT ${limit}`);
}

/**
 * « Nouveaux marchés » d'une Maison : villes dont la PREMIÈRE offre observée
 * (toutes offres, vivantes ou fermées) date de moins de 30 jours. N'a de sens
 * qu'avec 30 jours d'historique : le caller vérifie `historyStart`.
 */
export async function newCities30d(companyId: string): Promise<{ city: string; code: string | null; firstSeenAt: string }[]> {
  const rows = await run<{ city: string; isFrance: boolean; country: string | null; first: string }>(Prisma.sql`
    SELECT j.city, bool_or(j."isFrance") AS "isFrance", min(j.country) AS country,
           to_char(min(j."firstSeenAt") AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "first"
    FROM "Job" j WHERE j."companyId" = ${companyId} AND j.city IS NOT NULL
    GROUP BY j.city HAVING min(j."firstSeenAt") >= now() - interval '30 days' ORDER BY 4 DESC`);
  return rows.map((r) => ({ city: r.city, code: r.isFrance ? 'FR' : countryCode(r.country), firstSeenAt: r.first }));
}

/** Première observation de tout le catalogue (ISO date) — l'ancienneté réelle des faits Job. */
export async function historyStart(): Promise<string | null> {
  const [row] = await run<{ first: string | null }>(Prisma.sql`
    SELECT to_char(min("firstSeenAt") AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "first" FROM "Job"`);
  return row?.first ?? null;
}

/** Sources ACTIVE par famille d'adaptateur, sans URL (page méthodologie). */
export async function activeSourcesByKind(): Promise<Count[]> {
  return run<Count>(Prisma.sql`SELECT kind AS "key", count(*)::int AS "count" FROM "Source" WHERE status = 'ACTIVE' GROUP BY 1 ORDER BY 2 DESC`);
}

/** Toutes les (pays, ville) vivantes — pour résoudre un slug de ville. */
export async function allCities(): Promise<{ code: string; city: string }[]> {
  const rows = await byCity({}, 100_000);
  return rows.map((r) => ({ code: r.code, city: r.city }));
}

/** Tous les groupes vivants — pour résoudre un slug de groupe. */
export async function allGroups(): Promise<string[]> {
  const rows = await run<{ key: string }>(Prisma.sql`
    SELECT DISTINCT c."parentGroup" AS "key" FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
    WHERE j."isActive" AND c."parentGroup" IS NOT NULL`);
  return rows.map((r) => r.key);
}
