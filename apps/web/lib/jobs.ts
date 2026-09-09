import { companyIdentityWhere } from './company-identity';
import { unstable_cache } from 'next/cache';
import { prisma, CompanySector, canonicalJobId } from '@catwalks/db';
import { expandCompanyTerm } from './groups';
import { countryCode, rawValuesForCode } from './countries';
import { searchSummary } from './job-search-query';
import { offerIdCandidates } from './offer-url';

/**
 * Prisma condition for a Pays filter code.
 *
 * France is matched on the isFrance flag. Any other code matches the spellings
 * that normalize to it, case-insensitively — a safety net for legacy rows: the
 * column is 100% ISO-2 as of 2026-09-08 (measured: 66 882 rows, 0 free-form),
 * but a spelling that has not been re-attested yet must still be reachable.
 */
function countryCondition(code: string | undefined) {
  if (!code) return {};
  if (code === 'FR') return { isFrance: true };
  // `in` has no case-insensitive mode in Prisma, and the stored values vary in
  // case ("Italie"/"IT"/"it"), so match each spelling with equals-insensitive.
  const spellings = rawValuesForCode(code);
  return { OR: spellings.map((value) => ({ countryCode: { equals: value, mode: 'insensitive' as const } })) };
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
 *  - employmentTerm           -> la taxonomie mondiale de la relation d'emploi
 *  - city                     -> the collapsed location (Paris 8 -> PARIS)
 *  - source                   -> which connector saw the offer
 */
export type JobFilters = {
  q?: string;
  sector?: string;
  employmentTerm?: string;
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
    return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 200) || undefined;
  };

  const page = Number(one('page'));

  // World by default (revises D12, decided 2026-09-02): with no `pays` in the URL
  // the board shows every country, so the ~26k world offers a candidate expects
  // are reachable from the search box, not hidden behind a filter they never
  // open. `pays=<code>` (e.g. FR, IT) narrows to that country; `pays=monde` is
  // still accepted as an explicit "all countries" for shared/legacy links.
  const rawCountry = one('pays');
  const country = rawCountry === undefined || rawCountry === 'monde' ? undefined : rawCountry;

  return {
    q: one('q'),
    city: one('ville'),
    /**
     * Le paramètre technique porte le nom de la DIMENSION, pas un mot français :
     * la base est mondiale, et « contrat » y désignait une grille juridique qui
     * n'existe plus. L'ancien `?contrat=` reste accepté en lecture — des liens
     * partagés existent — mais rien ne l'émet plus. Aucune URL indexée n'est en
     * jeu : ni le sitemap ni un canonical ne l'ont jamais référencé (vérifié).
     *
     * L'interface, elle, continue d'écrire « Contrat » et « CDI » : c'est la
     * couche de localisation, pas le modèle.
     */
    employmentTerm: one('employmentTerm') ?? one('contrat'),
    sector: one('secteur'),
    maison: one('maison'),
    group: one('groupe'),
    source: one('source'),
    country,
    page: normalizedPage(page),
  };
}

/** Offers per page. */
export const PAGE_SIZE = 25;
/** A bounded offset until the public API adopts cursor pagination. */
export const MAX_PAGE = 10_000;
function normalizedPage(page: number | undefined): number {
  return Number.isSafeInteger(page) && page! > 0 ? Math.min(page!, MAX_PAGE) : 1;
}

export type JobRow = {
  id: string;
  title: string;
  company: string;
  /** The Maison's own domain (`sephora.com`) for its logo; null when no source names it. */
  companyDomain: string | null;
  group: string | null;
  city: string | null;
  location: string | null;
  /** Les dimensions d'emploi, indépendantes : durée, rythme, dispositif, nature, saisonnier. */
  employmentTerm: string | null;
  programType: string | null;
  engagementType: string | null;
  isSeasonal: boolean | null;
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
  /** Métier et séniorité (taxonomie D38) : ce qui distingue deux offres d'une même Maison dans la liste. */
  jobFunction: string | null;
  seniority: string | null;
  workTime: string | null;
  workplaceType: string | null;
  experienceYears: number | null;
  educationLevel: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  validThrough: Date | null;
  /** Code pays ISO-2 tel que stocke ; libelle via lib/countries. */
  countryCode: string | null;
  /** ISO-639-1 language of the posting text, when detected at ingest. */
  language: string | null;
  /** Our first sighting, separate from the employer's publication date. */
  firstSeenAt: Date;
};

export type JobsResult = {
  /** One page of results, not the whole match set. */
  jobs: JobRow[];
  /** Every row matching the filters, across all pages. */
  total: number;
  /** Every live offer stored (world), ignoring filters. */
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
    ...(filters.maison ? companyIdentityWhere(filters.maison) : {}),
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
    ...(filters.employmentTerm ? { employmentTerm: filters.employmentTerm } : {}),
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
              { employmentTerm: { contains: term, mode: 'insensitive' as const } },
              // A brand and its parent are the same search. "sandro" has to
              // reach offers a group portal filed under "SMCP", and "smcp" has
              // to reach every brand beneath it.
              ...expandCompanyTerm(term).flatMap((name) => [
                { company: companyIdentityWhere(name, 'contains') },
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

function toRow(row: {
  id: string; title: string; company: { name: string; sector: string | null; parentGroup: string | null; domain: string | null };
  city: string | null; location: string | null; employmentTerm: string | null; url: string;
  programType: string | null; engagementType: string | null; isSeasonal: boolean | null;
  postedAt: Date | null; latitude: number | null; longitude: number | null;
  sources: { sourceKey: string }[]; description: string | null; postalCode: string | null;
  department: string | null; workTime: string | null; workplaceType: string | null;
  experienceYears: number | null; educationLevel: string | null; salaryMin: number | null;
  salaryMax: number | null; salaryCurrency: string | null; salaryPeriod: string | null;
  validThrough: Date | null; countryCode: string | null; language: string | null; firstSeenAt: Date;
  jobFunction: string | null; seniority: string | null;
}): JobRow {
  return {
    id: row.id,
    title: row.title,
    company: row.company.name,
    companyDomain: row.company.domain,
    group: row.company.parentGroup,
    city: row.city,
    location: row.location,
    employmentTerm: row.employmentTerm,
    programType: row.programType,
    engagementType: row.engagementType,
    isSeasonal: row.isSeasonal,
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
    jobFunction: row.jobFunction,
    seniority: row.seniority,
    workTime: row.workTime,
    workplaceType: row.workplaceType,
    experienceYears: row.experienceYears,
    educationLevel: row.educationLevel,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    salaryCurrency: row.salaryCurrency,
    salaryPeriod: row.salaryPeriod,
    validThrough: row.validThrough,
    countryCode: row.countryCode,
    language: row.language,
    firstSeenAt: row.firstSeenAt,
  };
}

/**
 * One offer by id, for its own URL.
 *
 * Returns null when the offer does not exist or is closed. Throws
 * DatabaseUnavailableError when the database itself cannot answer — the two are
 * different: a missing offer is a 404, an unreachable database is a 503.
 */
/**
 * An offer lookup that distinguishes the three cases the offer page needs:
 *   - 'active'  -> render it,
 *   - 'closed'  -> the offer existed and was closed (expired/filled): the page
 *                  returns 410 Gone so Google de-indexes it fast (D22 — a 404 is
 *                  retried for weeks, a 410 is dropped),
 *   - 'missing' -> the id never existed: a plain 404.
 */
export async function getJobStatus(
  id: string,
): Promise<
  | { status: 'active'; job: JobRow }
  // A closed offer still carries its content: the page shows it with an
  // "expirée" banner (§4.13) while the middleware serves 410 for SEO (D22).
  | { status: 'closed'; job: JobRow }
  | { status: 'missing' }
> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    const canonicalId = await canonicalJobId(prisma, id);
    if (!canonicalId) return { status: 'missing' };
    const row = await prisma.job.findUnique({
      where: { id: canonicalId },
      omit: { raw: true, searchText: true },
      include: {
        company: true,
        sources: { select: { sourceKey: true }, where: { isActive: true } },
      },
    });
    if (!row) return { status: 'missing' };
    if (!row.isActive) return { status: 'closed', job: toRow(row) };
    return { status: 'active', job: toRow(row) };
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

export async function getJob(id: string): Promise<JobRow | null> {
  const result = await getJobStatus(id);
  return result.status === 'active' ? result.job : null;
}

/**
 * The lightweight status the middleware probe needs — existence + isActive only,
 * no joins. The page's own render does the full fetch; this must not repeat the
 * expensive company/sources join just to decide 200 vs 410 vs 404.
 */
export async function getOfferState(param: string): Promise<'active' | 'closed' | 'missing'> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    // The param may be a bare id or slug-id (S-01) — try each candidate, so
    // the middleware's 410 decision works on both URL shapes.
    for (const id of offerIdCandidates(param)) {
      const canonicalId = await canonicalJobId(prisma, id);
      if (!canonicalId) continue;
      const row = await prisma.job.findUnique({ where: { id: canonicalId }, select: { isActive: true } });
      if (row) return row.isActive ? 'active' : 'closed';
    }
    return 'missing';
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

/**
 * Resolves a /offre/[param] value (bare id or slug-id) to the offer.
 * Returns the state plus the id that matched, so the page can 301 a stale or
 * missing slug to the canonical URL.
 */
export async function resolveOfferParam(
  param: string,
): Promise<
  | { status: 'active' | 'closed'; job: JobRow; matchedId: string }
  | { status: 'missing' }
> {
  for (const id of offerIdCandidates(param)) {
    const state = await getJobStatus(id);
    if (state.status !== 'missing') return { ...state, matchedId: id };
  }
  return { status: 'missing' };
}

/**
 * Offers a candidate reading THIS offer would plausibly want next (S-01):
 * the same Maison first, then the same sector — active only, never itself.
 * Server-rendered as links on the offer page, they are also real crawl paths
 * between offers, which the sitemap-less crawl requirement leans on.
 */
/**
 * Le bloc Maison de la colonne latérale d'une offre (DA §5.3) : combien
 * d'offres ouvertes, dans combien de villes et de pays.
 *
 * Une seule requête agrégée — la page offre est la plus vue du site, elle ne
 * peut pas se permettre de charger les offres d'une Maison pour les compter.
 */
export type CompanyAside = { openJobs: number; cities: number; countries: number; domain: string | null; sector: string | null; group: string | null };

export async function getCompanyAside(companyName: string): Promise<CompanyAside | null> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    const company = await prisma.company.findFirst({
      where: { name: companyName },
      select: { id: true, domain: true, sector: true, parentGroup: true },
    });
    if (!company) return null;
    const [agg] = await prisma.$queryRaw<{ jobs: bigint; cities: bigint; countries: bigint }[]>`
      SELECT count(*)::bigint AS jobs,
             count(DISTINCT lower(city))::bigint AS cities,
             count(DISTINCT "countryCode")::bigint AS countries
      FROM "Job" WHERE "companyId" = ${company.id} AND "isActive"`;
    return {
      openJobs: Number(agg?.jobs ?? 0),
      cities: Number(agg?.cities ?? 0),
      countries: Number(agg?.countries ?? 0),
      domain: company.domain,
      sector: company.sector,
      group: company.parentGroup,
    };
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError(error);
  }
}

export async function getSimilarJobs(job: JobRow, limit = 6): Promise<JobRow[]> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    const base = {
      isActive: true,
      id: { not: job.id },
    };
    const include = {
      company: true,
      sources: { select: { sourceKey: true as const }, where: { isActive: true } },
    };
    const sameMaison = await prisma.job.findMany({
      where: { ...base, company: { name: job.company } },
      include,
      omit: { raw: true, searchText: true },
      orderBy: [{ postedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
      take: limit,
    });
    if (sameMaison.length >= limit) return sameMaison.map(toRow);

    const sector = validSector(job.sector ?? undefined);
    const fill = sector
      ? await prisma.job.findMany({
          where: {
            ...base,
            company: { sector, name: { not: job.company } },
            ...(job.city ? { city: { equals: job.city, mode: 'insensitive' as const } } : {}),
          },
          include,
          omit: { raw: true, searchText: true },
          orderBy: [{ postedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
          take: limit - sameMaison.length,
        })
      : [];
    return [...sameMaison, ...fill].map(toRow);
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

export async function getJobs(filters: JobFilters = {}): Promise<JobsResult> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();

  const page = normalizedPage(filters.page);
  try {
    const summary = await searchSummary(filters, page, PAGE_SIZE);
    const rows = await prisma.job.findMany({
      where: { id: { in: summary.ids }, isActive: true },
      omit: { raw: true, searchText: true },
      include: { company: true, sources: { select: { sourceKey: true }, where: { isActive: true } } },
    });
    const byId = new Map(rows.map(row => [row.id, row]));
    const countries = new Map<string, number>();
    for (const facet of summary.rawCountries) {
      const code = countryCode(facet.value);
      if (code && code !== 'FR') countries.set(code, (countries.get(code) ?? 0) + facet.count);
    }
    return {
      jobs: summary.ids.flatMap(id => { const row = byId.get(id); return row ? [toRow(row)] : []; }),
      total: summary.total, totalInDatabase: summary.totalInDatabase, page,
      pageCount: Math.max(1, Math.ceil(summary.total / PAGE_SIZE)),
      facets: {
        sectors: summary.sectors, contracts: summary.contracts,
        cities: summary.cities.map(f => ({ ...f, value: canonicalCity(f.value) })),
        groups: summary.groups, maisons: summary.maisons, sources: summary.sources,
        countries: [
          ...(summary.franceCount ? [{ value: 'FR', count: summary.franceCount }] : []),
          ...[...countries].map(([value, count]) => ({ value, count })).sort((a,b) => b.count-a.count),
        ],
      },
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
 * WORLD-scoped like the board's default (decision D19, which revises D12):
 * typing "Milan" or "London" must suggest those cities — the ~26k world offers
 * are reachable from the bar. No isFrance filter here, on purpose.
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
        // World, not FR-only (revises D12): the board defaults to every country,
        // so typing "Milan" must surface Milan — otherwise the world offers are
        // unreachable from the search box. Ordered by frequency, so the busiest
        // cities (Paris, London…) still lead.
        city: { startsWith: q, mode: 'insensitive' },
      },
      _count: { _all: true },
      orderBy: { _count: { city: 'desc' } },
      // Plus large que la limite : la colonne mélange les casses (« Paris » /
      // « PARIS » sont des groupes distincts) — on déduplique ensuite.
      take: SUGGEST_LIMIT * 3,
    });
    // Dédup insensible à la casse : on garde la graphie du groupe le plus
    // fréquent (les lignes arrivent triées par volume desc). Sans ça le
    // panneau montrait « Paris » ET « PARIS » — vu en prod.
    const seen = new Set<string>();
    const cities: string[] = [];
    for (const row of rows) {
      if (!row.city) continue;
      const key = row.city.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cities.push(row.city);
      if (cities.length >= SUGGEST_LIMIT) break;
    }
    return cities;
  } catch {
    return [];
  }
}

/**
 * Reduces a raw offer title to a searchable role keyword. Raw titles carry the
 * whole posting — "Conseiller de vente 35h - Paris - CDI H/F" — and clicking
 * one dropped that entire string into the search box, so the next search matched
 * almost nothing. This keeps the ROLE and drops the noise a candidate would
 * never type: reference codes, the contract, hours, the city, the H/F marker.
 */
export function roleKeyword(title: string): string {
  let role = title
    // Cut everything after the first " - " / " – " / " | " / " / " separator:
    // the role leads, the qualifiers (city, contract, hours) follow it.
    .split(/\s[-–|/]\s/)[0]
    // Drop a leading contract/reference prefix ("CDI - …", "2026-2825 - …").
    .replace(/^(CDI|CDD|STAGE|ALTERNANCE|INTERIM|VIE|FREELANCE|\d[\d-]*)\s*[-–]\s*/i, '')
    // Strip trailing H/F, F/H, (H/F), hours like "35h", and stray separators.
    .replace(/\(?\b[hf](?:\s*\/\s*[hf])?\b\)?/gi, '')
    .replace(/\b\d{2,}\s*h\b/gi, '')
    .replace(/[\s,–-]+$/g, '')
    .trim();
  return role;
}

export async function suggestTitles(query: string): Promise<string[]> {
  if (!process.env.DATABASE_URL) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    // Pull more raw titles than we need, reduce each to its role keyword, then
    // dedupe — several postings collapse to the same clean role.
    const rows = await prisma.job.groupBy({
      by: ['title'],
      where: {
        isActive: true,
        // World, not FR-only (revises D12): titles are suggested from the whole
        // active catalogue, matching the board's world-by-default scope.
        title: { contains: q, mode: 'insensitive' },
      },
      _count: { _all: true },
      orderBy: { _count: { title: 'desc' } },
      take: 40,
    });
    const seen = new Set<string>();
    const roles: string[] = [];
    for (const row of rows) {
      if (!row.title) continue;
      const role = roleKeyword(row.title);
      const key = role.toLowerCase();
      // Keep only roles that still contain what the candidate typed, so a title
      // matched on a trailing city does not surface an unrelated-looking role.
      if (role.length < 2 || seen.has(key) || !key.includes(q.toLowerCase())) continue;
      seen.add(key);
      roles.push(role);
      if (roles.length >= SUGGEST_LIMIT) break;
    }
    return roles;
  } catch {
    return [];
  }
}

/**
 * Every indexable URL's data for the sitemap — every active offer by id
 * (world, revises D12: the board defaults to all countries, so the sitemap
 * exposes the same set), and the Maisons that have at least one, by slug. Kept
 * lean (id + updatedAt only) so the ~26k-entry sitemap stays a single cheap
 * query per type.
 */
/**
 * Sitemap chunké (S-03, remonté au lot 2) : le monofichier à 34 k lignes en
 * force-dynamic répondait en timeout depuis l'extérieur — Google ne voyait
 * RIEN. L'index liste des chunks de 5 000 URLs, chacun paginé en base par
 * curseur d'id (stable), lastmod = updatedAt.
 */
export const SITEMAP_CHUNK_SIZE = 5000;

export async function sitemapOfferCount(): Promise<number> {
  if (!process.env.DATABASE_URL) return 0;
  return prisma.job.count({ where: { isActive: true } });
}

export async function sitemapOffersChunk(
  chunk: number,
): Promise<{ id: string; title: string; updatedAt: Date }[]> {
  if (!process.env.DATABASE_URL) return [];
  const offers = await prisma.job.findMany({
    where: { isActive: true },
    // title rides along so the sitemap lists the canonical slug URLs (S-01).
    select: { id: true, title: true, updatedAt: true },
    orderBy: { id: 'asc' },
    skip: chunk * SITEMAP_CHUNK_SIZE,
    take: SITEMAP_CHUNK_SIZE,
  });
  return offers;
}

export async function sitemapCompanies(): Promise<{ name: string; updatedAt: Date }[]> {
  if (!process.env.DATABASE_URL) return [];
  const rows = await prisma.company.findMany({
    where: { jobs: { some: { isActive: true } } },
    select: { name: true, lastSeenAt: true },
  });
  return rows.map((c) => ({ name: c.name, updatedAt: c.lastSeenAt ?? new Date() }));
}

/**
 * Headline counts for the landing — the aggregator's proof (real numbers, not
 * invented copy): live offers, Maisons, and distinct countries covered. Returns
 * zeros when the database is unavailable, so the landing renders without them
 * rather than failing (the landing has value without a count).
 */
export async function landingStats(): Promise<{
  offers: number;
  companies: number;
  countries: number;
  /** Maisons whose FIRST live offer appeared within 7 days — the "+X cette semaine" (DEC-1). */
  newCompaniesThisWeek: number;
}> {
  if (!process.env.DATABASE_URL) return { offers: 0, companies: 0, countries: 0, newCompaniesThisWeek: 0 };
  try {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [offers, companies, countryRows, newRows, oldest] = await Promise.all([
      prisma.job.count({ where: { isActive: true } }),
      prisma.company.count({ where: { jobs: { some: { isActive: true } } } }),
      prisma.job.findMany({
        where: { isActive: true, countryCode: { not: null } },
        select: { countryCode: true },
        distinct: ['countryCode'],
      }),
      // A Maison is "new this week" when it has live offers now and had NONE
      // older than a week — its first sighting is recent, not just one more
      // posting from a long-covered house.
      prisma.company.count({
        where: {
          jobs: { some: { isActive: true } },
          NOT: { jobs: { some: { firstSeenAt: { lt: weekAgo } } } },
        },
      }),
      prisma.job.findFirst({ orderBy: { firstSeenAt: 'asc' }, select: { firstSeenAt: true } }),
    ]);
    // Raw country spellings collapse to canonical codes (IT/Italy/it -> IT).
    const codes = new Set(countryRows.map((r) => countryCode(r.countryCode)).filter(Boolean));
    // « +810 cette semaine » sur 810 Maisons après un fresh start se lit comme
    // un bug : tant que la base n'a pas 7 jours d'historique, le delta est un
    // artefact — masqué (0), il réapparaît de lui-même à J+7.
    const hasWeekOfHistory = oldest !== null && oldest.firstSeenAt < weekAgo;
    return {
      offers,
      companies,
      countries: codes.size,
      newCompaniesThisWeek: hasWeekOfHistory ? newRows : 0,
    };
  } catch {
    return { offers: 0, companies: 0, countries: 0, newCompaniesThisWeek: 0 };
  }
}

/**
 * `landingStats` est appelé par le layout ET le footer de CHAQUE page : dix
 * requêtes par vue, cache chaud compris (audit I-5). Mémorisé 10 minutes.
 */
export const landingStatsCached = unstable_cache(landingStats, ['landing-stats'], { revalidate: 600, tags: ['landing'] });
