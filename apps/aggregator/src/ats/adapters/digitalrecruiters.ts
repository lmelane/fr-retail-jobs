import pLimit from 'p-limit';
import { createHash } from 'node:crypto';
import { fetchJson, fetchText } from '../../lib/http.js';
import {
  extractJobPostings,
  normalizeJobPosting,
} from '../../connectors/generic/jsonLdSitemap.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * DigitalRecruiters (Cegid) career sites.
 *
 * Covers a large slice of French retail: Decathlon, Monoprix, Lacoste, Aigle,
 * Celio, Jennyfer, Ba&sh, American Vintage — roughly 3,000 offers.
 *
 * Its careers pages render client-side, so a JSON-LD parser finds nothing. The
 * listing comes from one public API keyed by the careers hostname, which means
 * a new employer costs a config line rather than an adapter.
 *
 * NATIVE MODEL (measured on careers.lacoste.com, 2026-09-09, five pages of
 * 100): the endpoint lists DIFFUSIONS, not announcements. `count` = 460
 * diffusions, `id` = `<job_ad_id>-<diffusion>`; 453 distinct `job_ad_id`. The
 * seven extra rows are the SAME announcement broadcast for several locations
 * ("Japan" / "Tokyo" / "Shinjuku City", or twice for Aventura). One
 * announcement is one opening: the job keeps `job_ad_id` as its identity, every
 * diffusion is retained in RAW, the most specific location is displayed, and
 * the enumeration proof counts diffusions and announcements separately — the
 * publisher counter is never "corrected" to match the number of jobs.
 *
 * The listing has no description; the detail page supplies it, so callers that
 * need the full text fetch it per offer.
 */

const ENDPOINT = 'https://api.digitalrecruiters.com/public/v1/careers-site/job-ads';

const PAGE_SIZE = 100;
/** Guard against a changed response shape paginating forever. */
const MAX_PAGES = Number(process.env.DR_MAX_PAGES ?? 60);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
  'user-agent': USER_AGENT,
  'content-type': 'application/json',
  accept: 'application/json',
};

export type DrItem = {
  id?: number | string;
  job_ad_id?: number | string;
  title?: string;
  /** Plain strings, not objects: "CDI", "Panama". */
  contract?: string;
  location?: string;
  job?: string;
  /** Slug only; the absolute URL is built from the careers domain. */
  url?: string;
  careers_site_url?: string;
};

type DrResponse = { count?: number; items?: DrItem[] };

/** A diffusion URL of the form `<job_ad_id>/<diffusion_id>-slug` names a specific
 * location; the bare `<job_ad_id>-slug` form is the announcement-level broadcast. */
function isLocationSpecific(item: DrItem): boolean {
  return typeof item.url === 'string' && /^\d+\/\d+-/.test(item.url);
}

/**
 * L'identifiant CANONIQUE d'une annonce — la seule expression, partagée par l'offre écrite et par la preuve.
 *
 * Dupliquer ce calcul ailleurs suffirait à les faire diverger en silence : la preuve énumérerait un vocabulaire
 * et la base un autre, et une absence deviendrait indémontrable (ou, pire, faussement démontrée).
 */
export function announcementExternalId(diffusions: DrItem[]): string | null {
  const primary = diffusions.find(isLocationSpecific) ?? diffusions[0];
  if (!primary?.title) return null;
  return String(primary.job_ad_id ?? primary.id ?? primary.url ?? primary.title);
}

/** One job per announcement: the most specific diffusion is displayed, all are kept. */
export function normalizeAnnouncement(diffusions: DrItem[], domainName: string, locale: string): NormalizedJob | null {
  const primary = diffusions.find(isLocationSpecific) ?? diffusions[0];
  if (!primary?.title) return null;
  const id = primary.job_ad_id ?? primary.id;
  const path = primary.url ? `/${locale.slice(0, 2)}/annonce/${primary.url}` : '';
  const locations = [...new Set(diffusions.map((d) => d.location).filter((x): x is string => !!x))];
  return {
    externalId: announcementExternalId(diffusions)!,
    title: primary.title,
    location: primary.location,
    // The API returns no country field; France detection falls back to the city,
    // which the location normaliser already handles.
    contract: primary.contract,
    url: primary.careers_site_url ?? `https://${domainName}${path}`,
    raw: { ...primary, diffusions: diffusions.map((d) => ({ id: d.id, location: d.location, url: d.url })), locations },
  };
}

/**
 * Fills in the description, which the listing endpoint omits.
 *
 * The detail page carries JobPosting JSON-LD (verified on a Lacoste posting), so
 * the same parser the sitemap connector uses applies here. Callers pass
 * `withDescriptions: false` when they only need the listing — a board of 1300
 * offers is 1300 extra requests otherwise.
 */
async function attachDescriptions(
  jobs: NormalizedJob[],
  concurrency: number,
): Promise<NormalizedJob[]> {
  const limit = pLimit(concurrency);

  return Promise.all(
    jobs.map((job) =>
      limit(async () => {
        try {
          const html = await fetchText(job.url, { headers: { 'user-agent': USER_AGENT } });
          const [posting] = extractJobPostings(html);
          if (!posting) return job;
          const detail = normalizeJobPosting(posting, job.url);
          if (!detail) return job;

          return {
            ...job,
            description: detail.description ?? job.description,
            // The detail page also carries what the listing lacks entirely.
            country: detail.country ?? job.country,
            location: detail.location ?? job.location,
            postedAt: detail.postedAt ?? job.postedAt,
          };
        } catch {
          // A failed detail fetch must not lose the listing entry.
          return job;
        }
      }),
    ),
  );
}

/**
 * Reads a whole DigitalRecruiters board.
 * `config.domainName` is the careers hostname, e.g. "careers.lacoste.com".
 * `config.withDescriptions` (default true) fetches each offer's detail page.
 */
export async function fetchDigitalRecruitersJobs(
  config: Record<string, unknown>,
): Promise<AdapterResult> {
  const domainName = String(config.domainName ?? config.origin ?? '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  if (!domainName) throw new Error('DigitalRecruiters domainName missing');

  /**
   * A tenant serves its offers under its own locale; French first (most DR
   * tenants are French), but an empty fr_FR answer must not silence a
   * non-francophone tenant — no offer is dropped for its language (decision,
   * 2026-09-03). An explicit config.locale skips the fallback. The locale
   * selects the display language, not a geographic subset: `fr_FR` on Lacoste
   * lists the worldwide catalogue (Japan, Panama…) and `en_US` answers 400.
   */
  const locales = config.locale ? [String(config.locale)] : ['fr_FR', 'en_US'];
  let result: AdapterResult | undefined;
  for (const locale of locales) {
    result = await fetchAllPages(domainName, locale);
    if (result.jobs.length > 0) break;
  }
  const listing = result!;
  if (config.withDescriptions === false) return listing;
  return { ...listing, jobs: await attachDescriptions(listing.jobs, Number(config.detailConcurrency ?? 4)) };
}

async function fetchAllPages(domainName: string, locale: string): Promise<AdapterResult> {
  const byAnnouncement = new Map<string, DrItem[]>();
  const diffusionIds = new Set<string>();
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  const issues = new Set<string>();
  let declaredTotal: number | undefined, pages = 0, rawCount = 0, termination = 'PAGE_BUDGET_EXHAUSTED';

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${ENDPOINT}?domainName=${encodeURIComponent(domainName)}&limit=${PAGE_SIZE}&page=${page}&locale=${encodeURIComponent(locale)}`;
    const response = await fetchJson<DrResponse>(url, { method: 'POST', headers: HEADERS, body: '{}' });
    const items = response.items ?? [];
    pages++; rawCount += items.length;
    if (typeof response.count === 'number') {
      if (declaredTotal === undefined) declaredTotal = response.count;
      else if (declaredTotal !== response.count) issues.add('SOURCE_TOTAL_CHANGED');
    }
    const ids: string[] = [];
    const pageAnnouncements: string[] = [];
    let fresh = 0;
    for (const item of items) {
      const announcement = item.job_ad_id ?? item.id;
      if (!item.title || announcement === undefined || announcement === null) { rejectedRows.push({ reason: 'MISSING_TITLE_OR_ID', raw: item }); continue; }
      const diffusion = String(item.id ?? `${announcement}:${item.url ?? ''}`);
      ids.push(diffusion);
      // L'annonce est VUE dès qu'elle apparaît, même si cette diffusion-là est un doublon : sinon
      // elle manquerait à la preuve et paraîtrait absente.
      pageAnnouncements.push(String(announcement));
      if (diffusionIds.has(diffusion)) { issues.add('REPEATED_DIFFUSION_ACROSS_PAGES'); continue; }
      diffusionIds.add(diffusion); fresh++;
      const key = String(announcement);
      byAnnouncement.set(key, [...(byAnnouncement.get(key) ?? []), item]);
    }
    /**
     * `ids` porte les DIFFUSIONS, l'unité que le publieur pagine. `canonicalIds` porte les ANNONCES, l'unité
     * que la base stocke — et c'est le seul ensemble auquel une absence puisse être comparée.
     */
    pageEvidence.push({ url, checkedAt: new Date().toISOString(), sha256: createHash('sha256').update(JSON.stringify(response)).digest('hex'), offset: (page - 1) * PAGE_SIZE,
      pagination: declaredTotal === undefined ? null : { start: (page - 1) * PAGE_SIZE, end: (page - 1) * PAGE_SIZE + items.length, total: declaredTotal },
      ids, canonicalIds: [...new Set(pageAnnouncements)],
      publisherCounter: typeof response.count === 'number' ? String(response.count) : '', componentCounters: [`diffusions=${diffusionIds.size}`, `announcements=${byAnnouncement.size}`] });
    if (items.length < PAGE_SIZE) { termination = 'SHORT_PAGE'; break; }
    if (fresh === 0) { termination = 'REPEATED_PAGE'; break; }
    if (declaredTotal !== undefined && diffusionIds.size >= declaredTotal) { termination = 'PUBLISHER_TOTAL_REACHED'; break; }
  }

  const jobs = [...byAnnouncement.entries()].map(([, diffusions]) => normalizeAnnouncement(diffusions, domainName, locale)).filter((j): j is NormalizedJob => j !== null);
  const complete = declaredTotal !== undefined && diffusionIds.size === declaredTotal && issues.size === 0 && rejectedRows.length === 0 && termination !== 'PAGE_BUDGET_EXHAUSTED';
  if (!complete) issues.add('ENUMERATION_NOT_PROVEN');
  return {
    jobs, declaredTotal, rejectedRows, complete, truncated: termination === 'PAGE_BUDGET_EXHAUSTED',
    enumeration: {
      method: 'PUBLISHER_JSON_PAGINATION_WITH_DIFFUSION_COUNT', endpoint: `${ENDPOINT}?domainName=${encodeURIComponent(domainName)}&locale=${encodeURIComponent(locale)}`,
      pages, rawCount, termination, issues: [...issues],
      // The publisher counts diffusions; jobs are announcements. Both are stated, neither is adjusted.
      scopes: [
        { scope: 'diffusions', declaredTotal: declaredTotal ?? -1, uniqueIds: diffusionIds.size, pages, complete },
        { scope: 'announcements', declaredTotal: byAnnouncement.size, uniqueIds: byAnnouncement.size, pages, complete },
      ],
      pageEvidence,
    },
  };
}
