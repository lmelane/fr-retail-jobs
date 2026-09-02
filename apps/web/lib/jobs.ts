import { prisma } from '@catwalks/db';
import { matchesQuery, searchIndex } from './search';

/**
 * Job queries for the list and the map.
 *
 * Falls back to a small demo set when DATABASE_URL is absent or unreachable, so
 * the UI can be developed and reviewed before the Railway database is wired up.
 * The fallback is loud in the return value (`isDemo`) — a page must never pass
 * sample data off as real listings.
 */

/**
 * Filters mirror the aggregator's own model, so the UI exposes the whole
 * pipeline rather than a subset of it:
 *  - sector / maison / group  -> the 713-house reference list
 *  - contract                 -> the normalized contract vocabulary
 *  - city                     -> the collapsed location (Paris 8 -> PARIS)
 *  - source                   -> which connector saw the offer
 *  - multiSource              -> jobs confirmed by several sources
 *  - recency                  -> lifecycle freshness
 */
export type JobFilters = {
  q?: string;
  sector?: string;
  contract?: string;
  city?: string;
  group?: string;
  maison?: string;
  source?: string;
  multiSource?: boolean;
  /** Days since posting; undefined means no limit. */
  maxAgeDays?: number;
  /** 1-based, like the URL the user can share. */
  page?: number;
};

/** Offers per page. Indeed shows 15; the extra rows cost nothing here. */
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
  // so the detail view renders only what is present. These were stored from the
  // start and never shown, which wasted the richest part of the schema.
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
  isDemo: boolean;
  facets: {
    sectors: { value: string; count: number }[];
    contracts: { value: string; count: number }[];
    cities: { value: string; count: number }[];
    groups: { value: string; count: number }[];
    maisons: { value: string; count: number }[];
    sources: { value: string; count: number }[];
  };
};

const DEMO_JOBS: JobRow[] = [
  {
    id: 'demo-1',
    title: 'Conseiller de Vente',
    company: 'Christian Dior Couture',
    group: 'LVMH',
    city: 'Paris',
    location: 'Paris, Île-de-France',
    contract: 'CDI',
    sector: 'LUXURY',
    url: 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres',
    postedAt: new Date(Date.now() - 2 * 86_400_000),
    latitude: 48.859,
    longitude: 2.347,
    sourceCount: 3,
    sources: ['dior', 'lvmh', 'fashionjobs'],
    description:
      'Description complète de l’offre. En production ce texte vient de l’API de l’ATS, renvoyé avec la liste — aucune requête supplémentaire par offre.',
    applyUrl: 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres',
    postalCode: null,
    department: null,
    workingTime: null,
    remote: null,
    experienceYears: null,
    educationLevel: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    validThrough: null,
  },
  {
    id: 'demo-2',
    title: 'Vendeuse / Vendeur - F/H',
    company: 'Groupe Courir',
    group: null,
    city: 'Saint-Germain-en-Laye',
    location: 'ST GERMAIN EN LAYE, 78100',
    contract: 'CDI',
    sector: 'RETAIL',
    url: 'https://jobs.courir.com/',
    postedAt: new Date(Date.now() - 86_400_000),
    latitude: 48.9239,
    longitude: 2.1112,
    sourceCount: 1,
    sources: ['courir'],
    description:
      'Description complète de l’offre. En production ce texte vient de l’API de l’ATS, renvoyé avec la liste — aucune requête supplémentaire par offre.',
    applyUrl: 'https://jobs.courir.com/',
    postalCode: null,
    department: null,
    workingTime: null,
    remote: null,
    experienceYears: null,
    educationLevel: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    validThrough: null,
  },
  {
    id: 'demo-3',
    title: 'Contrôleur(se) de Gestion',
    company: 'Repossi',
    group: 'LVMH',
    city: 'Paris',
    location: 'Paris, Ile-de-France',
    contract: 'CDI',
    sector: 'JEWELRY_WATCHES',
    url: 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres/REPO00097',
    postedAt: new Date(Date.now() - 5 * 86_400_000),
    latitude: 48.859,
    longitude: 2.347,
    sourceCount: 2,
    sources: ['lvmh', 'fashionjobs'],
    description:
      'Description complète de l’offre. En production ce texte vient de l’API de l’ATS, renvoyé avec la liste — aucune requête supplémentaire par offre.',
    applyUrl: 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres/REPO00097',
    postalCode: null,
    department: null,
    workingTime: null,
    remote: null,
    experienceYears: null,
    educationLevel: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    validThrough: null,
  },
  {
    id: 'demo-4',
    title: 'Responsable de Boutique',
    company: 'Cartier',
    group: 'Richemont',
    city: 'Cannes',
    location: 'Cannes, PACA',
    contract: 'CDI',
    sector: 'JEWELRY_WATCHES',
    url: 'https://careers.richemont.com/',
    postedAt: new Date(Date.now() - 9 * 86_400_000),
    latitude: 43.5555,
    longitude: 7.0046,
    sourceCount: 1,
    sources: ['richemont'],
    description:
      'Description complète de l’offre. En production ce texte vient de l’API de l’ATS, renvoyé avec la liste — aucune requête supplémentaire par offre.',
    applyUrl: 'https://careers.richemont.com/',
    postalCode: null,
    department: null,
    workingTime: null,
    remote: null,
    experienceYears: null,
    educationLevel: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    validThrough: null,
  },
  {
    id: 'demo-5',
    title: 'Chef de Produit Parfums',
    company: 'Guerlain',
    group: 'LVMH',
    city: 'Paris',
    location: 'Paris 8, Île-de-France',
    contract: 'CDI',
    sector: 'BEAUTY',
    url: 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres',
    postedAt: new Date(Date.now() - 3 * 86_400_000),
    latitude: 48.872,
    longitude: 2.3,
    sourceCount: 2,
    sources: ['lvmh', 'wttj'],
    description:
      'Description complète de l’offre. En production ce texte vient de l’API de l’ATS, renvoyé avec la liste — aucune requête supplémentaire par offre.',
    applyUrl: 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres',
    postalCode: null,
    department: null,
    workingTime: null,
    remote: null,
    experienceYears: null,
    educationLevel: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    validThrough: null,
  },
  {
    id: 'demo-6',
    title: 'Alternance - Assistant(e) de Direction',
    company: 'Richemont',
    group: 'Richemont',
    city: 'Lyon',
    location: 'Lyon, Auvergne-Rhône-Alpes',
    contract: 'ALTERNANCE',
    sector: 'JEWELRY_WATCHES',
    url: 'https://careers.richemont.com/',
    postedAt: new Date(Date.now() - 12 * 86_400_000),
    latitude: 45.758,
    longitude: 4.835,
    sourceCount: 1,
    sources: ['richemont'],
    description:
      'Description complète de l’offre. En production ce texte vient de l’API de l’ATS, renvoyé avec la liste — aucune requête supplémentaire par offre.',
    applyUrl: 'https://careers.richemont.com/',
    postalCode: null,
    department: null,
    workingTime: null,
    remote: null,
    experienceYears: null,
    educationLevel: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    validThrough: null,
  },
];

function countBy(rows: JobRow[], pick: (row: JobRow) => string | null) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = pick(row);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

/** A job carries several sources, so it counts once per source it was seen in. */
function countBySource(rows: JobRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const source of row.sources) counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

function applyFilters(rows: JobRow[], filters: JobFilters): JobRow[] {
  // matchesQuery does its own normalization; keep the raw string.
  const needle = filters.q?.trim();
  const cutoff = filters.maxAgeDays
    ? Date.now() - filters.maxAgeDays * 86_400_000
    : null;

  return rows.filter((row) => {
    if (filters.sector && row.sector !== filters.sector) return false;
    if (filters.contract && row.contract !== filters.contract) return false;
    if (filters.city && row.city !== filters.city) return false;
    if (filters.group && row.group !== filters.group) return false;
    if (filters.maison && row.company !== filters.maison) return false;
    if (filters.source && !row.sources.includes(filters.source)) return false;
    if (filters.multiSource && row.sourceCount < 2) return false;
    if (cutoff && (!row.postedAt || new Date(row.postedAt).getTime() < cutoff)) return false;
    if (needle && !matchesQuery(searchIndex(row), needle)) return false;
    return true;
  });
}

/**
 * Filters as a database query.
 *
 * Everything the user can narrow by has to run in SQL. Loading a capped slice
 * and filtering it in memory meant a search only ever saw the newest 500 of
 * ~32,000 offers: filtering for Marseille returned "no results" while Marseille
 * jobs sat unread at row 900.
 */
function whereClause(filters: JobFilters) {
  const terms = (filters.q ?? '').trim().split(/\s+/).filter(Boolean);

  return {
    isActive: true,
    isFrance: true,
    ...(filters.city ? { city: filters.city } : {}),
    ...(filters.contract ? { contract: filters.contract } : {}),
    ...(filters.maison ? { company: { name: filters.maison } } : {}),
    ...(filters.sector ? { company: { sector: filters.sector as never } } : {}),
    ...(filters.maxAgeDays
      ? { postedAt: { gte: new Date(Date.now() - filters.maxAgeDays * 86_400_000) } }
      : {}),
    ...(filters.source ? { sources: { some: { sourceKey: filters.source, isActive: true } } } : {}),
    // "Confirmées" is applied separately: see multiSourceJobIds. Prisma has no
    // way to say "this relation has at least two rows" in a where clause, and
    // JobSource carries no flag that distinguishes the second source from the
    // first, so it needs its own grouped query.
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
              { company: { name: { contains: term, mode: 'insensitive' as const } } },
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

  const [contracts, cities, sectors] = await Promise.all([
    prisma.job.groupBy({ by: ['contract'], where, _count: true }),
    prisma.job.groupBy({ by: ['city'], where, _count: true, orderBy: { _count: { city: 'desc' } }, take: 60 }),
    // Sector and Maison live on Company, so they are grouped through the join.
    prisma.job.groupBy({ by: ['companyId'], where, _count: true, orderBy: { _count: { companyId: 'desc' } }, take: 200 }),
  ]);

  const companies = await prisma.company.findMany({
    where: { id: { in: sectors.map((row) => row.companyId) } },
    select: { id: true, name: true, sector: true },
  });
  const byId = new Map(companies.map((company) => [company.id, company]));

  const sectorCounts = new Map<string, number>();
  const maisonCounts = new Map<string, number>();
  for (const row of sectors) {
    const company = byId.get(row.companyId);
    if (!company) continue;
    const sector = String(company.sector ?? '');
    sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + row._count);
    maisonCounts.set(company.name, (maisonCounts.get(company.name) ?? 0) + row._count);
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
    groups: [],
    maisons: fromMap(maisonCounts),
    sources: [],
  };
}

/**
 * One offer by id, for its own URL.
 *
 * A jobboard's postings have to be linkable: a candidate sends a colleague an
 * offer, not a search. It also lets each posting carry its own title and
 * JobPosting metadata, which a single client-rendered page never can.
 */
export async function getJob(id: string): Promise<JobRow | null> {
  try {
    if (!process.env.DATABASE_URL) return null;

    const row = await prisma.job.findUnique({
      where: { id },
      include: {
        company: true,
        sources: { select: { sourceKey: true }, where: { isActive: true } },
      },
    });
    if (!row || !row.isActive) return null;

    return {
      id: row.id,
      title: row.title,
      company: row.company.name,
      group: null,
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
  } catch {
    return null;
  }
}

export async function getJobs(filters: JobFilters = {}): Promise<JobsResult> {
  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');

    const where = whereClause(filters);
    const page = Math.max(1, filters.page ?? 1);

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

    const jobs: JobRow[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      company: row.company.name,
      group: null,
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
    }));

    return {
      jobs,
      total,
      totalInDatabase,
      page,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      isDemo: false,
      // Facets are counted across the WHOLE match set, in the database. Built
      // from the current page they would have described 25 rows and told the
      // user a city holds 3 jobs when it holds 300.
      facets: await countFacets(where),
    };
  } catch (error) {
    // Log before falling back: a silent demo fallback hides real failures, and
    // the page then looks "fine" while showing six fictional rows.
    console.error(
      '[jobs] database unavailable, serving demo data:',
      error instanceof Error ? error.message : String(error),
    );
    // The demo set is six rows, so it filters in memory and never paginates.
    const filtered = applyFilters(DEMO_JOBS, filters);
    return {
      jobs: filtered,
      total: filtered.length,
      page: 1,
      pageCount: 1,
      // No database answered, so the demo set is all there is.
      totalInDatabase: DEMO_JOBS.length,
      isDemo: true,
      facets: {
        sectors: countBy(DEMO_JOBS, (job) => job.sector),
        contracts: countBy(DEMO_JOBS, (job) => job.contract),
        cities: countBy(DEMO_JOBS, (job) => job.city),
        groups: countBy(DEMO_JOBS, (job) => job.group),
        maisons: countBy(DEMO_JOBS, (job) => job.company),
        sources: countBySource(DEMO_JOBS),
      },
    };
  }
}
