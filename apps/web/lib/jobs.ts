import { prisma, CompanySector } from '@catwalks/db';
import { expandCompanyTerm } from './groups';
import { countryCode, rawValuesForCode } from './countries';

/**
 * Prisma condition for a Pays filter code.
 *
 * France is matched on the isFrance flag (reliable, unlike the raw `country`
 * which appears as "France"/"FR"/"fr"). Any other code matches the raw
 * spellings that normalize to it, case-insensitively.
 */
function countryCondition(code: string | undefined) {
  if (!code) return {};
  if (code === 'FR') return { isFrance: true };
  // `in` has no case-insensitive mode in Prisma, and the stored values vary in
  // case ("Italie"/"IT"/"it"), so match each spelling with equals-insensitive.
  const spellings = rawValuesForCode(code);
  return { OR: spellings.map((value) => ({ country: { equals: value, mode: 'insensitive' as const } })) };
}

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
  /** Canonical country code (FR, IT, US…); undefined means every country. */
  country?: string;
  /** 1-based, like the URL the user can share. */
  page?: number;
};

/**
 * URL query params -> JobFilters, the one mapping both the server-rendered
 * page and the infinite-scroll API route parse against.
 *
 * Shared here rather than duplicated: the two callers read the same URL keys
 * (French, because the URL is user-visible — `ville`, `contrat`, `secteur`…),
 * and a mapping that drifts between them would make page 1 (server-rendered)
 * and page 2+ (fetched client-side) silently disagree on what a filter means.
 */
export function parseFilters(params: Record<string, string | string[] | undefined>): JobFilters {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };

  const page = Number(one('page'));

  // France by default (decision D12): with no `pays` in the URL the board shows
  // France. An explicit `pays=monde` opens it to every country; any other value
  // is a specific country code. The world data stays in the database either way.
  const rawCountry = one('pays');
  const country = rawCountry === undefined ? 'FR' : rawCountry === 'monde' ? undefined : rawCountry;

  return {
    q: one('q'),
    city: one('ville'),
    contract: one('contrat'),
    sector: one('secteur'),
    maison: one('maison'),
    group: one('groupe'),
    source: one('source'),
    country,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

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
    /** Country facet values are canonical codes (FR, IT…); the UI labels them. */
    countries: { value: string; count: number }[];
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
    // No forced isFrance (decision D10): the board shows every country, and the
    // Pays filter narrows it. France uses the reliable isFrance flag; other
    // countries match the raw `country` spellings that map to their code.
    ...countryCondition(filters.country),
    // Case-insensitive: the facet value is canonical ("Paris") but the column
    // holds mixed spellings ("PARIS", "Paris"), so an exact match dropped half.
    ...(filters.city ? { city: { equals: filters.city, mode: 'insensitive' as const } } : {}),
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

/**
 * A city name canonicalized for display and matching: trimmed, and Title Cased
 * so "PARIS", "paris" and "Paris" collapse to one "Paris". The raw column still
 * holds the source spelling (some are ALL CAPS, some not); grouping on the raw
 * value split one city into several facet rows and a filter click missed half
 * the offers. This merges them.
 */
export function canonicalCity(raw: string): string {
  return raw
    .trim()
    .toLocaleLowerCase('fr-FR')
    .replace(/(^|[\s'’-])([a-zà-ÿ])/g, (_, sep, ch) => sep + ch.toLocaleUpperCase('fr-FR'));
}

/** One grouped count per facet, over every row the filters match. */
async function countFacets(
  where: WhereClause,
  whereForCountry: WhereClause = where,
): Promise<JobsResult['facets']> {
  const asFacets = (rows: { _count: number }[], key: string) =>
    rows
      .map((row) => ({
        value: String((row as Record<string, unknown>)[key] ?? ''),
        count: row._count,
      }))
      .filter((facet) => facet.value !== '')
      .sort((a, b) => b.count - a.count);

  /** Merge raw city rows case-insensitively into one canonical entry each. */
  const cityFacets = (rows: { city: string | null; _count: number }[]) => {
    const merged = new Map<string, number>();
    for (const row of rows) {
      if (!row.city) continue;
      const key = canonicalCity(row.city);
      if (!key) continue;
      merged.set(key, (merged.get(key) ?? 0) + row._count);
    }
    return [...merged.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  };

  const [contracts, cities, sectors, sources, rawCountries, franceCount] = await Promise.all([
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
    // Country facet: group the raw spellings, normalize them below. Uses the
    // country-free where so every country stays offered, not just the selected one.
    prisma.job.groupBy({ by: ['country'], where: whereForCountry, _count: true }),
    // France is counted on the reliable flag, not its three raw spellings.
    prisma.job.count({ where: { ...whereForCountry, isFrance: true } }),
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

  // Country facet: normalize raw spellings to a code, drop FR (counted on the
  // flag), and prepend France so it leads the list when present.
  const countryCounts = new Map<string, number>();
  for (const row of rawCountries) {
    const code = countryCode(row.country);
    if (!code || code === 'FR') continue;
    countryCounts.set(code, (countryCounts.get(code) ?? 0) + row._count);
  }
  const countries = [
    ...(franceCount > 0 ? [{ value: 'FR', count: franceCount }] : []),
    ...fromMap(countryCounts),
  ];

  return {
    sectors: fromMap(sectorCounts),
    contracts: asFacets(contracts, 'contract'),
    cities: cityFacets(cities),
    groups: fromMap(groupCounts),
    maisons: fromMap(maisonCounts),
    sources: asFacets(sources as { _count: number }[], 'sourceKey'),
    countries,
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
  // The Pays facet must ignore the CURRENT country filter: with France selected
  // by default, counting countries inside the France-filtered set left only
  // "France" in the dropdown, so a candidate could never switch country. Built
  // from every other filter but not the country one, so all reachable countries
  // stay switchable.
  const whereForCountryFacet = whereClause({ ...filters, country: undefined });
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
      prisma.job.count({ where: { isActive: true } }),
    ]);

    return {
      jobs: rows.map(toRow),
      total,
      totalInDatabase,
      page,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      // Facets counted across the WHOLE match set, in the database. The Pays
      // facet uses the country-free where so every country stays switchable.
      facets: await countFacets(where, whereForCountryFacet),
    };
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

/**
 * Autocomplete for the search bar, from OUR data — the suggestions are real
 * cities and real job titles the board actually holds, so a click always leads
 * to results, unlike a generic canned list.
 *
 * France-scoped like the board's default (decision D12): a candidate typing in
 * the FR view is offered FR cities and FR postings.
 */
const SUGGEST_LIMIT = 8;

export async function suggestCities(query: string): Promise<string[]> {
  if (!process.env.DATABASE_URL) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const rows = await prisma.job.groupBy({
      by: ['city'],
      where: {
        isActive: true,
        isFrance: true,
        city: { startsWith: q, mode: 'insensitive' },
      },
      _count: { _all: true },
      orderBy: { _count: { city: 'desc' } },
      take: SUGGEST_LIMIT,
    });
    return rows.map((r) => r.city).filter((c): c is string => Boolean(c));
  } catch {
    return [];
  }
}

export async function suggestTitles(query: string): Promise<string[]> {
  if (!process.env.DATABASE_URL) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const rows = await prisma.job.groupBy({
      by: ['title'],
      where: {
        isActive: true,
        isFrance: true,
        title: { contains: q, mode: 'insensitive' },
      },
      _count: { _all: true },
      orderBy: { _count: { title: 'desc' } },
      take: SUGGEST_LIMIT,
    });
    return rows.map((r) => r.title).filter((t): t is string => Boolean(t));
  } catch {
    return [];
  }
}
