import { getSectorPresentation, sectorWhere } from './sectors';
import { companyIdentityWhere } from './company-identity';
import { prisma } from '@catwalks/db';
import { publicJobWhere } from '@catwalks/db/availability';
import { facettesContrat, type Perimetre } from '@catwalks/db/marches';
import { Prisma } from '@prisma/client';
import { DatabaseUnavailableError, MAX_VALUES, perimetreServi, type PerimetreServi } from './jobs';
import { expandCompanyTerm } from './groups';
import { exigerPerimetre } from './perimetre';
import type { FacetteServie } from './facettes';
import type { FiltreRefuse } from './search-plan';
import { companySlug } from './company-slug';

export { companySlug } from './company-slug';

/**
 * Employers, ranked by how many live offers they hold IN THE PERIMETER.
 *
 * The counterpart to the offer list: the same data read by employer rather than
 * by posting — "who is hiring right now" instead of "what can I apply to". Both
 * views are bounded by the same perimeter (lot 6): a Maison without a live
 * offer in the market answers no question a candidate of that market is asking.
 */
export type CompanyRow = {
  id: string;
  name: string;
  /** Sector labels of the reviewed classification, for the "Secteur · Groupe" caption. */
  sectors: { code: string; slug: string; label: string }[];
  /** Parent group (LVMH, Kering…), when the Maison belongs to one. */
  group: string | null;
  /** The Maison's own domain, for its logo; null when no source names it (monogram). */
  domain: string | null;
  jobCount: number;
  /** Cities where this employer currently has openings in the perimeter, busiest first. */
  cities: { city: string; count: number }[];
};

export type CompaniesResult = {
  companies: CompanyRow[];
  total: number;
  page: number;
  pageCount: number;
  perimetre: PerimetreServi;
  /** `secteur`, et `pays` quand le marché l'expose : mêmes clés, mêmes libellés que la recherche. */
  facettes: FacetteServie[];
  filtresRefuses: FiltreRefuse[];
};

export const COMPANY_PAGE_SIZE = 40;

/** D-426 — secteur et pays portent PLUSIEURS valeurs, comme sur la liste d'offres. */
export type CompanyFilters = {
  q?: string;
  secteur?: string[];
  pays?: string[];
  page?: number;
  marche?: string;
};

/**
 * The URL keys are French because the URL is user-visible. Shared by every
 * consumer of `/api/companies`, with the same bounds as `parseFilters`.
 */
export function parseCompanyFilters(
  params: Record<string, string | string[] | undefined>,
): CompanyFilters {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 200) || undefined;
  };
  const many = (key: string): string[] | undefined => {
    const value = params[key];
    if (value === undefined) return undefined;
    const brut = Array.isArray(value) ? value : [value];
    const vues = new Set<string>();
    for (const x of brut) {
      const propre = x?.trim().slice(0, 200);
      if (propre) vues.add(propre);
      if (vues.size >= MAX_VALUES) break;
    }
    return vues.size ? [...vues] : undefined;
  };

  const page = Number(one('page'));
  const pays = many('pays')?.filter((v) => v !== 'monde').map((v) => v.toUpperCase());

  return {
    q: one('q'),
    secteur: many('secteur'),
    pays: pays?.length ? pays : undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    marche: one('marche') ?? one('market'),
  };
}

export async function getCompanies(filters: CompanyFilters = {}): Promise<CompaniesResult> {
  const perimetre = exigerPerimetre(filters.marche);
  // Same contract as getJobs (decision D1): no database, no invented data — the
  // page renders the error state rather than crashing unhandled.
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    return await queryCompanies(filters, perimetre);
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError(error);
  }
}

async function queryCompanies(filters: CompanyFilters, perimetre: Perimetre): Promise<CompaniesResult> {
  const page = Math.max(1, filters.page ?? 1);
  const presentation = await getSectorPresentation();
  const contrat = facettesContrat(perimetre);
  const refus: FiltreRefuse[] = [];

  /*
   * Le pays est une facette DANS le périmètre : une valeur hors périmètre est
   * refusée explicitement, jamais honorée ni ignorée en silence (lot 6).
   */
  let pays: readonly string[] = perimetre.pays;
  if (filters.pays?.length) {
    const dedans = filters.pays.filter((p) => perimetre.pays.includes(p));
    const dehors = filters.pays.filter((p) => !perimetre.pays.includes(p));
    // Même règle que `planifierRecherche` : hors périmètre → refus ; dans le
    // périmètre → filtre seulement si le marché sert la facette, sinon sans effet.
    if (dehors.length) refus.push({ cle: 'pays', valeurs: dehors, motif: 'PAYS_HORS_MARCHE' });
    if (dedans.length && contrat.some((f) => f.cle === 'pays')) pays = dedans;
  }

  // Sector and search both constrain the joined Company, so they share ONE
  // `company` object — two separate spreads collided and dropped the sector.
  // Search matches the employer name OR its parent group (and group synonyms),
  // so "SMCP" reaches Sandro and Maje like it does on the offer list.
  const secteurs = filters.secteur ?? [];
  const query = filters.q?.trim();
  const companyAnd = [
    ...(secteurs.length ? [{ OR: secteurs.map((s) => sectorWhere(s)) }] : []),
    ...(query
      ? [
          {
            OR: expandCompanyTerm(query).flatMap((name) => [
              companyIdentityWhere(name, 'contains'),
              { parentGroup: { contains: name, mode: 'insensitive' as const } },
            ]),
          },
        ]
      : []),
  ];
  const company = companyAnd.length ? { AND: companyAnd } : {};
  const jobWhere: Prisma.JobWhereInput = {
    ...publicJobWhere(),
    countryCode: { in: [...pays] },
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
      select: { id: true, name: true, sectorCodes: true, parentGroup: true, domain: true },
    }),
    // One grouped query for every city of every company on this page, rather
    // than a query per company.
    prisma.job.groupBy({
      by: ['companyId', 'city'],
      where: { ...jobWhere, companyId: { in: pageIds }, city: { not: null } },
      _count: true,
    }),
  ]);

  const byCompany = new Map(companies.map((company) => [company.id, company]));
  const citiesByCompany = new Map<string, CompanyRow['cities']>();
  for (const row of cityRows) {
    if (!row.city) continue;
    const list = citiesByCompany.get(row.companyId) ?? [];
    list.push({ city: row.city, count: row._count });
    citiesByCompany.set(row.companyId, list);
  }

  const rows: CompanyRow[] = grouped
    .slice((page - 1) * COMPANY_PAGE_SIZE, page * COMPANY_PAGE_SIZE)
    .map((row) => {
      const company = byCompany.get(row.companyId);
      return {
        id: row.companyId,
        name: company?.name ?? '—',
        sectors: presentation.sectors.filter((s) => company?.sectorCodes.includes(s.code)),
        group: company?.parentGroup ?? null,
        domain: company?.domain ?? null,
        jobCount: row._count,
        cities: (citiesByCompany.get(row.companyId) ?? []).sort((a, b) => b.count - a.count),
      };
    })
    // groupBy cannot order by the joined name, so ties are settled here.
    .sort((a, b) => b.jobCount - a.jobCount || a.name.localeCompare(b.name, 'fr'));

  /*
   * Les facettes de l'annuaire suivent le contrat de la recherche : les comptes
   * de `secteur` excluent la sélection de secteur, ceux de `pays` excluent la
   * sélection de pays (D-426, union dans une dimension).
   */
  const sansSecteur: Prisma.JobWhereInput = { ...publicJobWhere(), countryCode: { in: [...pays] },
    ...(query ? { company: { AND: companyAnd.slice(secteurs.length ? 1 : 0) } } : {}) };
  const sansPays: Prisma.JobWhereInput = { ...publicJobWhere(), countryCode: { in: [...perimetre.pays] },
    ...(Object.keys(company).length ? { company } : {}) };
  const [sectorRows, countryRows] = await Promise.all([
    prisma.job.groupBy({ by: ['companyId'], where: sansSecteur, _count: true }),
    prisma.job.groupBy({ by: ['countryCode'], where: { ...sansPays, countryCode: { in: [...perimetre.pays] } }, _count: true }),
  ]);
  const sectorCompanies = await prisma.company.findMany({
    where: { id: { in: sectorRows.map((row) => row.companyId) } },
    select: { id: true, sectorCodes: true },
  });
  const sectorById = new Map(sectorCompanies.map((company) => [company.id, company.sectorCodes]));
  const sectorCounts = new Map<string, number>();
  for (const row of sectorRows) {
    const codes = sectorById.get(row.companyId) ?? [];
    for (const sector of codes.length ? codes : ['unclassified']) sectorCounts.set(sector, (sectorCounts.get(sector) ?? 0) + row._count);
  }
  const nomsPays = (() => {
    try {
      return new Intl.DisplayNames([perimetre.marche?.localeParDefaut ?? 'fr-FR'], { type: 'region', fallback: 'none' });
    } catch {
      return null;
    }
  })();

  const facettes: FacetteServie[] = contrat.flatMap(({ cle, libelle }): FacetteServie[] => {
    if (cle === 'secteur') return [{ cle, libelle, options: [...sectorCounts.entries()]
      .map(([value, count]) => ({ value, count, label: presentation.labels[value] ?? 'Secteur à vérifier' }))
      .filter((o) => o.count > 0).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)) }];
    if (cle === 'pays') return [{ cle, libelle, options: countryRows
      .flatMap((row) => row.countryCode ? [{ value: row.countryCode, count: row._count, label: nomsPays?.of(row.countryCode) ?? row.countryCode }] : [])
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)) }];
    return [];
  });

  return {
    companies: rows,
    total: grouped.length,
    page,
    pageCount: Math.max(1, Math.ceil(grouped.length / COMPANY_PAGE_SIZE)),
    perimetre: perimetreServi(perimetre),
    facettes,
    filtresRefuses: refus,
  };
}

/** Le chemin d'une Maison sur le site : dérivé de son nom, sans vérité propre. */
export function companyPath(name: string): string {
  return `/emplois/maisons/${companySlug(name)}`;
}
