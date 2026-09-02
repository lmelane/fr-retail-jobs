import { prisma, CompanySector } from '@catwalks/db';
import { expandCompanyTerm } from './groups';

/**
 * A sector filter value that is a real CompanySector, or undefined.
 *
 * The value comes from the URL. Passing an unknown string straight to the enum
 * column made Prisma throw, which the catch turned into a false "database
 * unavailable" page. An invalid filter should simply match nothing, so validate
 * it here and drop it when it is not a real sector.
 */
export function validSector(value: string | undefined): CompanySector | undefined {
  if (!value) return undefined;
  return (Object.values(CompanySector) as string[]).includes(value)
    ? (value as CompanySector)
    : undefined;
}

/**
 * Job queries for the list and the map.
 *
 * There is NO demo fallback (decision D1): a jobboard must never show invented
 * offers. When the database is unavailable, these throw DatabaseUnavailableError
 * and the page renders a clean error state — never six fictional rows passed off
 * as real listings.
 */

/** Thrown when the database cannot answer, so the UI shows an error, not fake data. */
export class DatabaseUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('The offers database is unavailable.');
    this.name = 'DatabaseUnavailableError';
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Filters mirror the aggregator's own model, so the UI exposes the whole
 * pipeline rather than a subset of it:
 *  - sector / maison / group  -> the reference list
 *  - contract                 -> the normalized contract vocabulary
 *  - city                     -> the collapsed location (Paris 8 -> PARIS)
 *  - source                   -> which connector saw the offer
 */
export type JobFilters = {
  q?: string;
  sector?: string;
  contract?: string;
  city?: string;
  group?: string;
  maison?: string;
  source?: string;
  /** 1-based, like the URL the user can share. */
  page?: number;
};

/** Offers per page. */
export const PAGE_SIZE = 25;

export type JobRow = {
  id: string;
  title: string;
  company: string;
  group: string | null;
  city: string | null;
  location: string | null;
  contract: string | null;
  sector: string | null;
  url: string;
  postedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  sourceCount: number;
  /** Registry keys of every source that reported this job. */
  sources: string[];
  /** Full posting text: ATS APIs return it with the listing, no extra fetch. */
  description: string | null;
  /** Employer-side apply URL of the highest-ranked source. */
  applyUrl: string;

  // Everything else the adapters normalize. Coverage varies by source — an
  // absent field means "this source does not publish it", never "not fetched" —
  // so the detail view renders only what is present.
  postalCode: string | null;
  department: string | null;
  workingTime: string | null;
  remote: string | null;
  experienceYears: number | null;
  educationLevel: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  validThrough: Date | null;
};

export type JobsResult = {
  /** One page of results, not the whole match set. */
  jobs: JobRow[];
  /** Every row matching the filters, across all pages. */
  total: number;
  /** Every live French offer stored, ignoring filters. */
  totalInDatabase: number;
  /** 1-based page these jobs come from. */
  page: number;
  pageCount: number;
  facets: {
    sectors: { value: string; count: number }[];
    contracts: { value: string; count: number }[];
    cities: { value: string; count: number }[];
    groups: { value: string; count: number }[];
    maisons: { value: string; count: number }[];
    sources: { value: string; count: number }[];
  };
};

/**
 * Filters as a database query.
 *
 * Everything the user can narrow by has to run in SQL. Loading a capped slice
 * and filtering it in memory meant a search only ever saw the newest 500 of
 * ~32,000 offers: filtering for Marseille returned "no results" while Marseille
 * jobs sat unread at row 900.
 */
export function whereClause(filters: JobFilters) {
  const terms = (filters.q ?? '').trim().split(/\s+/).filter(Boolean);

  // Maison, Secteur and Groupe all constrain the joined Company, so they MUST
  // share ONE `company` object. Three separate `company:` spreads collided —
  // duplicate keys in an object literal keep only the last, so combining them
  // silently dropped all but Groupe. Merge them into a single relation filter.
  const sector = validSector(filters.sector);
  const company = {
    ...(filters.maison ? { name: filters.maison } : {}),
    ...(sector ? { sector } : {}),
    ...(filters.group ? { parentGroup: filters.group } : {}),
  };

  return {
    isActive: true,
    isFrance: true,
    ...(filters.city ? { city: filters.city } : {}),
    ...(filters.contract ? { contract: filters.contract } : {}),
    ...(Object.keys(company).length ? { company } : {}),
    ...(filters.source ? { sources: { some: { sourceKey: filters.source, isActive: true } } } : {}),
    // Each term must appear in SOME field, so "vendeuse paris" needs both words
    // but not in the same column.
    ...(terms.length
      ? {
          AND: terms.map((term) => ({
            OR: [
              { title: { contains: term, mode: 'insensitive' as const } },
              { description: { contains: term, mode: 'insensitive' as const } },
              { city: { contains: term, mode: 'insensitive' as const } },
              { location: { contains: term, mode: 'insensitive' as const } },
              { department: { contains: term, mode: 'insensitive' as const } },
              { contract: { contains: term, mode: 'insensitive' as const } },
              // A brand and its parent are the same search. "sandro" has to
              // reach offers a group portal filed under "SMCP", and "smcp" has
              // to reach every brand beneath it.
              ...expandCompanyTerm(term).flatMap((name) => [
                { company: { name: { contains: name, mode: 'insensitive' as const } } },
                { company: { parentGroup: { contains: name, mode: 'insensitive' as const } } },
              ]),
            ],
          })),
        }
      : {}),
  };
}

type WhereClause = ReturnType<typeof whereClause>;

/** One grouped count per facet, over every row the filters match. */
async function countFacets(where: WhereClause): Promise<JobsResult['facets']> {
  const asFacets = (rows: { _count: number }[], key: string) =>
    rows
      .map((row) => ({
        value: String((row as Record<string, unknown>)[key] ?? ''),
        count: row._count,
      }))
      .filter((facet) => facet.value !== '')
      .sort((a, b) => b.count - a.count);

  const [contracts, cities, sectors, sources] = await Promise.all([
    prisma.job.groupBy({ by: ['contract'], where, _count: true }),
    prisma.job.groupBy({ by: ['city'], where, _count: true, orderBy: { _count: { city: 'desc' } }, take: 60 }),
    // Sector, Maison and Group live on Company, so they are grouped through the join.
    prisma.job.groupBy({ by: ['companyId'], where, _count: true, orderBy: { _count: { companyId: 'desc' } }, take: 300 }),
    // Source lives on JobSource: count live source rows of jobs matching the filters.
    prisma.jobSource.groupBy({
      by: ['sourceKey'],
      where: { isActive: true, job: where },
      _count: true,
      orderBy: { _count: { sourceKey: 'desc' } },
      take: 40,
    }),
  ]);

  const companies = await prisma.company.findMany({
    where: { id: { in: sectors.map((row) => row.companyId) } },
    select: { id: true, name: true, sector: true, parentGroup: true },
  });
  const byId = new Map(companies.map((company) => [company.id, company]));

  const sectorCounts = new Map<string, number>();
  const maisonCounts = new Map<string, number>();
  const groupCounts = new Map<string, number>();
  for (const row of sectors) {
    const company = byId.get(row.companyId);
    if (!company) continue;
    const sector = String(company.sector ?? '');
    sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + row._count);
    maisonCounts.set(company.name, (maisonCounts.get(company.name) ?? 0) + row._count);
    if (company.parentGroup) {
      groupCounts.set(company.parentGroup, (groupCounts.get(company.parentGroup) ?? 0) + row._count);
    }
  }

  const fromMap = (map: Map<string, number>) =>
    [...map.entries()]
      .map(([value, count]) => ({ value, count }))
      .filter((facet) => facet.value !== '')
      .sort((a, b) => b.count - a.count);

  return {
    sectors: fromMap(sectorCounts),
    contracts: asFacets(contracts, 'contract'),
    cities: asFacets(cities, 'city'),
    groups: fromMap(groupCounts),
    maisons: fromMap(maisonCounts),
    sources: asFacets(sources as { _count: number }[], 'sourceKey'),
  };
}

function toRow(row: {
  id: string; title: string; company: { name: string; sector: string | null; parentGroup: string | null };
  city: string | null; location: string | null; contract: string | null; url: string;
  postedAt: Date | null; latitude: number | null; longitude: number | null;
  sources: { sourceKey: string }[]; description: string | null; postalCode: string | null;
  department: string | null; workingTime: string | null; remote: string | null;
  experienceYears: number | null; educationLevel: string | null; salaryMin: number | null;
  salaryMax: number | null; salaryCurrency: string | null; salaryPeriod: string | null;
  validThrough: Date | null;
}): JobRow {
  return {
    id: row.id,
    title: row.title,
    company: row.company.name,
    group: row.company.parentGroup,
    city: row.city,
    location: row.location,
    contract: row.contract,
    sector: row.company.sector,
    url: row.url,
    postedAt: row.postedAt,
    latitude: row.latitude,
    longitude: row.longitude,
    sourceCount: row.sources.length,
    sources: row.sources.map((source) => source.sourceKey),
    description: row.description,
    applyUrl: row.url,
    postalCode: row.postalCode,
    department: row.department,
    workingTime: row.workingTime,
    remote: row.remote,
    experienceYears: row.experienceYears,
    educationLevel: row.educationLevel,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    salaryCurrency: row.salaryCurrency,
    salaryPeriod: row.salaryPeriod,
    validThrough: row.validThrough,
  };
}

/**
 * One offer by id, for its own URL.
 *
 * Returns null when the offer does not exist or is closed. Throws
 * DatabaseUnavailableError when the database itself cannot answer — the two are
 * different: a missing offer is a 404, an unreachable database is a 503.
 */
export async function getJob(id: string): Promise<JobRow | null> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    const row = await prisma.job.findUnique({
      where: { id },
      include: {
        company: true,
        sources: { select: { sourceKey: true }, where: { isActive: true } },
      },
    });
    if (!row || !row.isActive) return null;
    return toRow(row);
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

export async function getJobs(filters: JobFilters = {}): Promise<JobsResult> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();

  const where = whereClause(filters);
  const page = Math.max(1, filters.page ?? 1);

  try {
    const [rows, total, totalInDatabase] = await Promise.all([
      prisma.job.findMany({
        where,
        include: {
          company: true,
          sources: { select: { sourceKey: true }, where: { isActive: true } },
        },
        orderBy: [{ postedAt: 'desc' }, { firstSeenAt: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.job.count({ where }),
      prisma.job.count({ where: { isActive: true, isFrance: true } }),
    ]);

    return {
      jobs: rows.map(toRow),
      total,
      totalInDatabase,
      page,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      // Facets counted across the WHOLE match set, in the database.
      facets: await countFacets(where),
    };
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}
