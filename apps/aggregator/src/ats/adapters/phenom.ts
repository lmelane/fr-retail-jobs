import { createHash } from 'node:crypto';
import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import { employmentTermsFrom } from '../../normalize/employment.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Phenom People career sites.
 *
 * The biggest single win in the catalogue: Foot Locker, Primark, Pandora,
 * Rolex, Goyard and New Balance all run Phenom — roughly 5,000 offers behind
 * one adapter.
 *
 * Their pages are JS-rendered, which is why a JSON-LD parser reported zero, but
 * `/api/jobs` is public and returns everything: title, city, country,
 * description AND latitude/longitude, so these rows never need geocoding.
 *
 * Verified 2026-09-01 on careers.footlocker.com: 2814 jobs, 3.1k-character
 * descriptions, coordinates included.
 */

/**
 * The API honours `limit` (not `size`) and paginates with a 1-based `page`.
 * `offset`, `from` and `start` are all silently ignored — they return page one
 * every time, which looks like a board with only ten jobs.
 */
const PAGE_SIZE = 100;
/** Guard against a changed response shape paginating forever. */
const MAX_PAGES = Number(process.env.PHENOM_MAX_PAGES ?? 80);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = { 'user-agent': USER_AGENT, accept: 'application/json' };

type PhenomJobData = {
  slug?: string;
  req_id?: string;
  /** Locale of this entry ("en-us", "fr-fr"): the same requisition may be served once per language. */
  language?: string;
  title?: string;
  description?: string;
  city?: string;
  state?: string;
  country?: string;
  country_code?: string;
  postal_code?: string;
  latitude?: number | string;
  longitude?: number | string;
  create_date?: string;
  posted_date?: string;
  applyUrl?: string;
  apply_url?: string;
  category?: string;
  /** schema.org value: "FULL_TIME" / "PART_TIME" — a working time, not a contract. */
  employment_type?: string;
  /** The employer as published ("Foot Locker") — never the catalogue line's fallback ("Foot Locker France" on 1 769 US posts, audit a4). */
  hiring_organization?: string;
  /** Tenant-configured: Foot Locker files the contract in tags2 ("Regular Part-Time") and the banner in tags4 ("Kids Foot Locker"). */
  tags1?: string[];
  tags2?: string[];
  tags3?: string[];
  tags4?: string[];
  tags5?: string[];
  tags6?: string[];
  tags7?: string[];
  tags8?: string[];
  tags9?: string[];
};

/** Every `tagsN` value, whatever the tenant filed there. */
function tagValues(data: PhenomJobData): unknown[] {
  return Object.entries(data)
    .filter(([key]) => /^tags\d+$/.test(key))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));
}

/**
 * The brand to credit the offer to.
 *
 * `config.brandTag` names the tag that carries the banner on tenants that have
 * one (Foot Locker: `tags4` = "Kids Foot Locker", "Champs Sports"…); it is
 * tenant-specific, so it is opt-in per catalogue line. Otherwise the employer
 * the API publishes — always better than the catalogue label.
 */
function brandOf(data: PhenomJobData, config: Record<string, unknown>): string | undefined {
  const tag = config.brandTag ? (data as Record<string, unknown>)[String(config.brandTag)] : undefined;
  const banner = Array.isArray(tag) ? tag[0] : tag;
  const brand = banner ? String(banner).trim() : '';
  return brand || data.hiring_organization?.trim() || undefined;
}

type PhenomResponse = {
  jobs?: Array<{ data?: PhenomJobData }>;
  totalCount?: number;
  count?: number;
};


/** One `/api/jobs` entry → one posting. Exported for tests (no network). */
export function parsePhenomJob(data: PhenomJobData, origin: string, config: Record<string, unknown> = {}): NormalizedJob | null {
  if (!data.title) return null;

  const id = data.slug ?? data.req_id;
  const posted = data.create_date ?? data.posted_date;
  const postedAt = posted ? new Date(posted) : undefined;
  // employment_type is a working time; the contract, when the tenant publishes
  // it, sits in a tag ("Regular Part-Time"). Only values naming a term are kept.
  const terms = employmentTermsFrom([data.employment_type, ...tagValues(data)]);

  return {
    externalId: String(id ?? data.title),
    title: data.title,
    location: [data.city, data.state, data.postal_code].filter(Boolean).join(', ') || undefined,
    // country_code is ISO-2 ("FR"); country is the display name ("France").
    country: data.country_code ?? data.country,
    contract: terms,
    workingTime: terms,
    company: brandOf(data, config),
    city: data.city,
    region: data.state,
    postalCode: data.postal_code,
    // Phenom ships coordinates, so these rows skip geocoding.
    latitude: Number.isFinite(Number(data.latitude)) ? Number(data.latitude) : undefined,
    longitude: Number.isFinite(Number(data.longitude)) ? Number(data.longitude) : undefined,
    description: htmlToPlainText(data.description),
    // Phenom livre `apply_url` = l'étape de CONNEXION iCIMS (`/jobs/<id>/login`,
    // 2 842/2 842 liens Foot Locker sur une page de login) ; la fiche publique est
    // `/jobs/<id>/job` (audit A5, 2026-09-06).
    url: publicJobUrl(data.applyUrl ?? data.apply_url ?? `${origin}/job/${id ?? ''}`),
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: data,
  };
}

/** La fiche publique, jamais l'étape de connexion iCIMS que Phenom met dans apply_url (`/jobs/<id>/login` → `/jobs/<id>/job`). */
export function publicJobUrl(url: string): string {
  return url.replace(/(\/jobs\/[^/?#]+)\/login(?=[/?#]|$)/, '$1/job');
}

/**
 * Reads a whole Phenom board.
 * `config.origin` is the careers host, e.g. "https://careers.footlocker.com".
 */
export async function fetchPhenomJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('Phenom origin missing');

  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  let declaredTotal: number | undefined;
  const issues = new Set<string>();
  let pages = 0, rawCount = 0, withoutData = 0, repeatedIds = 0, languageVariants = 0, termination = 'PAGE_BUDGET_EXHAUSTED';
  const languageOf = new Map<string, string>();
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${origin}/api/jobs?limit=${PAGE_SIZE}&page=${page}`;
    const response = await fetchJson<PhenomResponse>(url, { headers: HEADERS });

    const batch = response.jobs ?? [];
    pages++; rawCount += batch.length;
    let fresh = 0;
    const pageIds: string[] = [];

    for (const entry of batch) {
      if (!entry.data) { withoutData++; continue; }
      const job = parsePhenomJob(entry.data, origin, config);
      if (!job) continue;
      pageIds.push(job.externalId);
      // Foot Locker, 2026-09-09 : 2 850 entrées servies pour 2 850 annoncées,
      // 2 839 identifiants distincts — 11 offres revenaient sur deux pages
      // (pagination instable) et 11 autres n'ont donc jamais été servies. Le
      // doublon est compté et nommé ; il refuse la preuve, il ne la remplace pas.
      if (seen.has(job.externalId)) {
        // Foot Locker, 2026-09-10 (29 real pages): the 11 "repeated" ids were the
        // SAME requisition served in a second LANGUAGE (fr-fr then en-us, en-us then
        // nl-be) — totalCount 2 861 sums the language counts, 2 850 requisitions.
        // A language variant is a row the publisher announced and we accounted
        // for, not a posting lost to an unstable sort; the two stay distinct.
        const language = String(entry.data.language ?? '');
        if (language && languageOf.get(job.externalId) && languageOf.get(job.externalId) !== language) { languageVariants++; continue; }
        repeatedIds++; continue;
      }
      seen.add(job.externalId);
      languageOf.set(job.externalId, String(entry.data.language ?? ''));
      jobs.push(job);
      fresh++;
    }
    const pageTotal = response.totalCount ?? response.count;
    pageEvidence.push({ url, checkedAt: new Date().toISOString(), sha256: createHash('sha256').update(JSON.stringify(response)).digest('hex'), offset: (page - 1) * PAGE_SIZE, pagination: null,
      ids: pageIds, publisherCounter: pageTotal === undefined ? '' : `total=${pageTotal}`, componentCounters: [`entries=${batch.length}`, `languageVariants=${languageVariants}`, `uniqueIds=${seen.size}`, `repeated=${repeatedIds}`, `withoutData=${withoutData}`] });

    const total = response.totalCount ?? response.count;
    if (total !== undefined) {
      if (declaredTotal === undefined) declaredTotal = total;
      else if (declaredTotal !== total) issues.add('SOURCE_TOTAL_CHANGED');
    }

    if (total !== undefined && jobs.length + languageVariants >= total) { termination = 'PUBLISHER_TOTAL_REACHED'; break; }
    // A page that adds nothing new is the end of the board (or a loop).
    if (fresh === 0) { termination = batch.length ? 'REPEATED_PAGE' : 'EMPTY_PAGE'; break; }
    /**
     * Foot Locker, 2026-09-09 : 2 836 lues pour 2 847 déclarées. Une page
     * COURTE n'est pas la fin quand le total n'est pas atteint — l'API peut
     * servir une page allégée (entrées sans `data`, doublons) au milieu du
     * board ; on ne s'arrête sur une page courte qu'en l'absence de total.
     */
    if (total === undefined && batch.length < PAGE_SIZE) { termination = 'SHORT_PAGE'; break; }
  }

  if (repeatedIds) issues.add('REPEATED_IDS_ACROSS_PAGES');
  if (languageVariants) issues.add('LANGUAGE_VARIANTS_DEDUPLICATED');
  // Proven when every announced entry is accounted for: a distinct requisition, or a language variant of one already kept.
  const complete = declaredTotal !== undefined && jobs.length + languageVariants === declaredTotal && repeatedIds === 0 && !issues.has('SOURCE_TOTAL_CHANGED') && termination !== 'PAGE_BUDGET_EXHAUSTED';
  if (!complete) issues.add('ENUMERATION_NOT_PROVEN');
  return { jobs, declaredTotal, complete, truncated: termination === 'PAGE_BUDGET_EXHAUSTED' || (declaredTotal !== undefined && jobs.length + languageVariants < declaredTotal),
    enumeration: { method: 'PUBLISHER_TOTAL_COUNT_JSON_PAGINATION', endpoint: `${origin}/api/jobs`, pages, rawCount, termination, issues: [...issues],
      pageEvidence, scopes: [{ scope: 'jobs', declaredTotal: declaredTotal ?? -1, uniqueIds: jobs.length, pages, complete }, { scope: 'languageVariants', declaredTotal: languageVariants, uniqueIds: languageVariants, pages, complete: true }, { scope: 'entriesWithoutData', declaredTotal: withoutData, uniqueIds: withoutData, pages, complete: true }] } };
}

/**
 * Coordinates Phenom already provides, so these rows skip geocoding entirely.
 * Returns null when the payload has none.
 */
export function phenomCoordinates(raw: unknown): { latitude: number; longitude: number } | null {
  const data = raw as PhenomJobData | undefined;
  const latitude = Number(data?.latitude);
  const longitude = Number(data?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}
