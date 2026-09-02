import { prisma } from '@catwalks/db';
import { DatabaseUnavailableError, validSector } from './jobs';
import { expandCompanyTerm } from './groups';

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
};

export const COMPANY_PAGE_SIZE = 40;

export type CompanyFilters = {
  q?: string;
  sector?: string;
  page?: number;
};

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
  const jobWhere = {
    isActive: true,
    isFrance: true,
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
    where: { isActive: true, isFrance: true },
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

  return {
    companies: rows,
    total: grouped.length,
    page,
    pageCount: Math.max(1, Math.ceil(grouped.length / COMPANY_PAGE_SIZE)),
    sectors: [...sectorCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
  };
}
