import { prisma, Prisma } from '@catwalks/db';
import { DatabaseUnavailableError } from '@/lib/jobs';
import { countryCode } from '@/lib/countries';
import { cached } from '../cache';
import { byCity, byCountry, byFunction, bySector, headline, type CityCount, type Count, type CountryCount } from '../facts';
import { latestAndBefore } from '../snapshots';
import type { SnapshotPoint } from '../metrics';

/**
 * Pages de classement : géographies (pays), métiers (25 fonctions), secteurs.
 * Les croisements « top pays / top Maison / séniorité par métier (ou secteur) »
 * sont UNE requête groupée chacun, réduite en JS — pas 25 requêtes.
 */

type Cross = { dim: string | null; isFrance: boolean; country: string | null; count: number };
type CrossCompany = { dim: string | null; name: string; count: number };
type CrossSeniority = { dim: string | null; seniority: string | null; count: number };

async function run<T>(query: Prisma.Sql): Promise<T[]> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    return await prisma.$queryRaw<T[]>(query);
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

/** Réduit des lignes (dimension, pays brut) en « top pays par dimension ». */
function topCountryByDim(rows: Cross[]): Map<string, { code: string; count: number }[]> {
  const acc = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const code = r.isFrance ? 'FR' : countryCode(r.country);
    if (!code) continue;
    const dim = r.dim ?? '';
    const m = acc.get(dim) ?? new Map<string, number>();
    m.set(code, (m.get(code) ?? 0) + r.count);
    acc.set(dim, m);
  }
  return new Map([...acc.entries()].map(([dim, m]) => [dim, [...m.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count).slice(0, 3)]));
}

function groupBy<T extends { dim: string | null }>(rows: T[]): Map<string, T[]> {
  const acc = new Map<string, T[]>();
  for (const r of rows) {
    const dim = r.dim ?? '';
    acc.set(dim, [...(acc.get(dim) ?? []), r]);
  }
  return acc;
}

export type DimRow = {
  key: string;
  count: number;
  new30: number;
  topCountries: { code: string; count: number }[];
  topCompanies: { name: string; count: number }[];
  seniority: Count[];
};

async function dimensionRows(column: Prisma.Sql, base: (Count & { new30: number })[]): Promise<DimRow[]> {
  const [countries, companies, seniority] = await Promise.all([
    run<Cross>(Prisma.sql`
      SELECT ${column} AS "dim", j."isFrance" AS "isFrance", j."countryCode" AS country, count(*)::int AS "count"
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" WHERE j."isActive" GROUP BY 1, 2, 3`),
    run<CrossCompany>(Prisma.sql`
      SELECT * FROM (
        SELECT ${column} AS "dim", c.name, count(*)::int AS "count",
               row_number() OVER (PARTITION BY ${column} ORDER BY count(*) DESC, c.name ASC) AS rn
        FROM "Job" j JOIN "Company" c ON c.id = j."companyId" WHERE j."isActive" GROUP BY 1, 2
      ) t WHERE rn <= 3`),
    run<CrossSeniority>(Prisma.sql`
      SELECT ${column} AS "dim", j.seniority, count(*)::int AS "count"
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" WHERE j."isActive" GROUP BY 1, 2`),
  ]);
  const topC = topCountryByDim(countries);
  const comp = groupBy(companies);
  const sen = groupBy(seniority);
  return base.map((b) => ({
    key: b.key,
    count: b.count,
    new30: b.new30,
    topCountries: topC.get(b.key) ?? [],
    topCompanies: (comp.get(b.key) ?? []).map((c) => ({ name: c.name, count: c.count })),
    seniority: (sen.get(b.key) ?? []).map((s) => ({ key: s.seniority ?? '', count: s.count })).sort((a, b) => b.count - a.count),
  }));
}

export type FunctionsList = { total: number; rows: DimRow[] };

export const getFunctionsList = cached('functions-list', async (): Promise<FunctionsList> => {
  const [h, functions] = await Promise.all([headline(), byFunction()]);
  const rows = await dimensionRows(Prisma.sql`j."jobFunction"`, functions);
  return { total: h.active, rows };
});

export const getSectorsList = cached('sectors-list', async (): Promise<{ total: number; rows: DimRow[]; functionsBySector: Record<string, Count[]> }> => {
  const [h, sectors, fnRows] = await Promise.all([
    headline(),
    bySector(),
    run<{ dim: string; fn: string | null; count: number }>(Prisma.sql`
      SELECT c.sector::text AS "dim", j."jobFunction" AS "fn", count(*)::int AS "count"
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" WHERE j."isActive" GROUP BY 1, 2`),
  ]);
  const rows = await dimensionRows(Prisma.sql`c.sector::text`, sectors.map((s) => ({ key: s.key, count: s.count, new30: s.new30 })));
  const functionsBySector: Record<string, Count[]> = {};
  for (const r of fnRows) {
    functionsBySector[r.dim] = [...(functionsBySector[r.dim] ?? []), { key: r.fn ?? '', count: r.count }];
  }
  for (const k of Object.keys(functionsBySector)) functionsBySector[k].sort((a, b) => b.count - a.count);
  return { total: h.active, rows, functionsBySector };
});

export type GeographiesData = {
  total: number;
  countries: CountryCount[];
  unknown: number;
  cities: CityCount[];
  growth: { key: string; now: SnapshotPoint; before: SnapshotPoint | null }[];
};

export const getGeographies = cached('geographies', async (): Promise<GeographiesData> => {
  const [h, countries, cities, growth] = await Promise.all([headline(), byCountry(), byCity({}, 30), latestAndBefore('country', 30)]);
  return { total: h.active, countries: countries.rows, unknown: countries.unknown, cities, growth };
});
