import { prisma } from '@catwalks/db';
import { DatabaseUnavailableError, validSector } from './jobs';
import { expandCompanyTerm } from './groups';
import { countryCode, rawValuesForCode } from './countries';
import { companySlug } from './company-slug';

export { companySlug } from './company-slug';

/**
 * Employers, ranked by how many live offers they hold.
 *
 * The counterpart to the offer list: the same data read by employer rather than
 * by posting, which is the question "who is hiring right now" instead of "what
 * can I apply to". Both views share the map, so a Maison's footprint is visible
 * the same way a search's is.
 */

export type CompanyRow = {
  id: string;
  name: string;
  sector: string | null;
  jobCount: number;
  /** Cities where this employer currently has openings, busiest first. */
  cities: { city: string; count: number; latitude: number | null; longitude: number | null }[];
};

export type CompaniesResult = {
  companies: CompanyRow[];
  total: number;
  page: number;
  pageCount: number;
  sectors: { value: string; count: number }[];
  /** Offers per country code (FR, US, IT…), for the world map. */
  countries: { code: string; count: number }[];
};

export const COMPANY_PAGE_SIZE = 40;

export type CompanyFilters = {
  q?: string;
  sector?: string;
  /** Canonical country code (FR, IT…); undefined means every country. */
  country?: string;
  page?: number;
};

/**
 * The URL keys are French because the URL is user-visible. Shared by the
 * server-rendered page and the /api/companies route so infinite scroll and the
 * first render can never disagree on what a filter means — the same fix the
 * offer list needed.
 */
export function parseCompanyFilters(
  params: Record<string, string | string[] | undefined>,
): CompanyFilters {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };
  const page = Number(one('page'));

  // World by default (revises D12), same as the offer list: no `pays` means every
  // country, `pays=<code>` narrows to one. `pays=monde` is still accepted as an
  // explicit "all countries" for shared/legacy links.
  const rawCountry = one('pays');
  const country = rawCountry === undefined || rawCountry === 'monde' ? undefined : rawCountry;

  return {
    q: one('q'),
    sector: one('secteur'),
    country,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export async function getCompanies(filters: CompanyFilters = {}): Promise<CompaniesResult> {
  // Same contract as getJobs (decision D1): no database, no invented data — the
  // page renders the error state rather than crashing unhandled.
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    return await queryCompanies(filters);
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError(error);
  }
}

/**
 * Autocomplete for the Entreprises search box — real Maison names, most active
 * first (like Indeed's directory, which surfaces the biggest employers). A
 * suggestion always leads to a Maison that exists and is hiring.
 */
export async function suggestCompanies(query: string): Promise<string[]> {
  if (!process.env.DATABASE_URL) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const rows = await prisma.company.findMany({
      where: {
        name: { contains: q, mode: 'insensitive' },
        jobs: { some: { isActive: true } },
      },
      select: { name: true, _count: { select: { jobs: { where: { isActive: true } } } } },
      take: 40,
    });
    return rows
      .sort((a, b) => b._count.jobs - a._count.jobs)
      .slice(0, 8)
      .map((r) => r.name);
  } catch {
    return [];
  }
}

async function queryCompanies(filters: CompanyFilters): Promise<CompaniesResult> {
  const page = Math.max(1, filters.page ?? 1);

  // Only employers with a live French offer: a company row with nothing open
  // answers no question a candidate is asking.
  //
  // Sector and search both constrain the joined Company, so they share ONE
  // `company` object — two separate spreads collided and dropped the sector.
  // Search matches the employer name OR its parent group (and group synonyms),
  // so "SMCP" on /entreprises reaches Sandro and Maje like it does on /.
  const sector = validSector(filters.sector);
  const query = filters.q?.trim();
  const company = {
    ...(sector ? { sector } : {}),
    ...(query
      ? {
          OR: expandCompanyTerm(query).flatMap((name) => [
            { name: { contains: name, mode: 'insensitive' as const } },
            { parentGroup: { contains: name, mode: 'insensitive' as const } },
          ]),
        }
      : {}),
  };
  // D10: employers from every country, not France-only. A Pays filter narrows
  // it; France uses the reliable flag, other countries their raw spellings.
  const countryWhere = !filters.country
    ? {}
    : filters.country === 'FR'
      ? { isFrance: true }
      : { OR: rawValuesForCode(filters.country).map((v) => ({ country: { equals: v, mode: 'insensitive' as const } })) };
  const jobWhere = {
    isActive: true,
    ...countryWhere,
    ...(Object.keys(company).length ? { company } : {}),
  };

  const grouped = await prisma.job.groupBy({
    by: ['companyId'],
    where: jobWhere,
    _count: true,
    orderBy: { _count: { companyId: 'desc' } },
  });

  const pageIds = grouped
    .slice((page - 1) * COMPANY_PAGE_SIZE, page * COMPANY_PAGE_SIZE)
    .map((row) => row.companyId);

  const [companies, cityRows] = await Promise.all([
    prisma.company.findMany({
      where: { id: { in: pageIds } },
      select: { id: true, name: true, sector: true },
    }),
    // One grouped query for every city of every company on this page, rather
    // than a query per company.
    prisma.job.groupBy({
      by: ['companyId', 'city', 'latitude', 'longitude'],
      where: { ...jobWhere, companyId: { in: pageIds } },
      _count: true,
    }),
  ]);

  const byCompany = new Map(companies.map((company) => [company.id, company]));
  const citiesByCompany = new Map<string, CompanyRow['cities']>();
  for (const row of cityRows) {
    if (!row.city) continue;
    const list = citiesByCompany.get(row.companyId) ?? [];
    list.push({
      city: row.city,
      count: row._count,
      latitude: row.latitude,
      longitude: row.longitude,
    });
    citiesByCompany.set(row.companyId, list);
  }

  const rows: CompanyRow[] = grouped
    .slice((page - 1) * COMPANY_PAGE_SIZE, page * COMPANY_PAGE_SIZE)
    .map((row) => {
      const company = byCompany.get(row.companyId);
      return {
        id: row.companyId,
        name: company?.name ?? '—',
        sector: company?.sector ?? null,
        jobCount: row._count,
        cities: (citiesByCompany.get(row.companyId) ?? []).sort((a, b) => b.count - a.count),
      };
    })
    // groupBy cannot order by the joined name, so ties are settled here.
    .sort((a, b) => b.jobCount - a.jobCount || a.name.localeCompare(b.name, 'fr'));

  const sectorRows = await prisma.job.groupBy({
    by: ['companyId'],
    where: { isActive: true },
    _count: true,
  });
  const sectorCompanies = await prisma.company.findMany({
    where: { id: { in: sectorRows.map((row) => row.companyId) } },
    select: { id: true, sector: true },
  });
  const sectorById = new Map(sectorCompanies.map((company) => [company.id, company.sector]));
  const sectorCounts = new Map<string, number>();
  for (const row of sectorRows) {
    const sector = String(sectorById.get(row.companyId) ?? '');
    if (!sector) continue;
    sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + row._count);
  }

  // Offers per country, WORLD-WIDE (not France-only), for the world map. France
  // is counted on its reliable flag; other countries fold their raw spellings
  // into one code.
  const [rawCountries, franceJobs] = await Promise.all([
    prisma.job.groupBy({ by: ['country'], where: { isActive: true }, _count: true }),
    prisma.job.count({ where: { isActive: true, isFrance: true } }),
  ]);
  const countryCounts = new Map<string, number>();
  for (const row of rawCountries) {
    const code = countryCode(row.country);
    if (!code || code === 'FR') continue;
    countryCounts.set(code, (countryCounts.get(code) ?? 0) + row._count);
  }
  const countries = [
    ...(franceJobs > 0 ? [{ code: 'FR', count: franceJobs }] : []),
    ...[...countryCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count),
  ];

  return {
    companies: rows,
    total: grouped.length,
    page,
    pageCount: Math.max(1, Math.ceil(grouped.length / COMPANY_PAGE_SIZE)),
    sectors: [...sectorCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
    countries,
  };
}

export type CompanyProfile = {
  name: string;
  sector: string | null;
  parentGroup: string | null;
  careersUrl: string | null;
  jobCount: number;
  cities: { city: string; count: number }[];
  contracts: { value: string; count: number }[];
};

/**
 * One Maison's profile for its dedicated page (decision D15) — what we actually
 * hold: sector, parent group, live-offer count, the cities and contract types
 * it hires in. No reviews/salaries/executives (Indeed's proprietary data we do
 * not have). The offer list itself is fetched separately by the page.
 */
export async function getCompanyBySlug(slug: string): Promise<CompanyProfile | null> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    // Match by slug over the display name — several rows can share a name only
    // after a bad ingest, so take the one with the most live offers.
    const candidates = await prisma.company.findMany({
      select: { id: true, name: true, sector: true, parentGroup: true, careersUrl: true },
    });
    const match = candidates
      .filter((c) => companySlug(c.name) === slug)
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!match) return null;

    // World-scoped (revises D12): a Maison recruits across countries, and the
    // board now defaults to every country, so the header count and city/contract
    // facets must match the world set the offer list shows.
    const where = { companyId: match.id, isActive: true } as const;
    const [jobCount, cityGroups, contractGroups] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.groupBy({
        by: ['city'],
        where: { ...where, city: { not: null } },
        _count: true,
        orderBy: { _count: { city: 'desc' } },
        take: 12,
      }),
      prisma.job.groupBy({
        by: ['contract'],
        where: { ...where, contract: { not: null } },
        _count: true,
        orderBy: { _count: { contract: 'desc' } },
      }),
    ]);

    return {
      name: match.name,
      sector: match.sector,
      parentGroup: match.parentGroup,
      careersUrl: match.careersUrl,
      jobCount,
      cities: cityGroups.map((g) => ({ city: g.city as string, count: g._count })),
      contracts: contractGroups.map((g) => ({ value: g.contract as string, count: g._count })),
    };
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError(error);
  }
}
