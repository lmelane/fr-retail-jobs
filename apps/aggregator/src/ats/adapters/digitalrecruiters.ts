import pLimit from 'p-limit';
import { fetchJson, fetchText } from '../../lib/http.js';
import {
  extractJobPostings,
  normalizeJobPosting,
} from '../../connectors/generic/jsonLdSitemap.js';
import type { NormalizedJob } from '../../types.js';

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
 * Verified 2026-09-01 on careers.lacoste.com: count 471, items carrying title,
 * contract, location and a URL slug.
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

type DrItem = {
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

function toNormalized(item: DrItem, domainName: string, locale: string): NormalizedJob | null {
  if (!item.title) return null;

  const id = item.job_ad_id ?? item.id;
  const path = item.url ? `/${locale.slice(0, 2)}/annonce/${item.url}` : '';

  return {
    externalId: String(id ?? item.url ?? item.title),
    title: item.title,
    location: item.location,
    // The API returns no country field; France detection falls back to the city,
    // which the location normaliser already handles.
    contract: item.contract,
    url: item.careers_site_url ?? `https://${domainName}${path}`,
    raw: item,
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
): Promise<NormalizedJob[]> {
  const domainName = String(config.domainName ?? config.origin ?? '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  if (!domainName) throw new Error('DigitalRecruiters domainName missing');

  /**
   * A tenant serves its offers under its own locale; French first (most DR
   * tenants are French), but an empty fr_FR answer must not silence a
   * non-francophone tenant — no offer is dropped for its language (decision,
   * 2026-09-03). An explicit config.locale skips the fallback.
   */
  const locales = config.locale ? [String(config.locale)] : ['fr_FR', 'en_US'];
  let jobs: NormalizedJob[] = [];
  for (const locale of locales) {
    jobs = await fetchAllPages(domainName, locale);
    if (jobs.length > 0) break;
  }

  if (config.withDescriptions === false) return jobs;
  return attachDescriptions(jobs, Number(config.detailConcurrency ?? 4));
}

async function fetchAllPages(domainName: string, locale: string): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${ENDPOINT}?domainName=${encodeURIComponent(domainName)}&limit=${PAGE_SIZE}&page=${page}&locale=${encodeURIComponent(locale)}`;
    const response = await fetchJson<DrResponse>(url, {
      method: 'POST',
      headers: HEADERS,
      body: '{}',
    });

    const items = response.items ?? [];
    let fresh = 0;

    for (const item of items) {
      const job = toNormalized(item, domainName, locale);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
      fresh++;
    }

    if (items.length < PAGE_SIZE || fresh === 0) break;
    if (response.count !== undefined && jobs.length >= response.count) break;
  }

  return jobs;
}
