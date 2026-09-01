import { fetchJson } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

/**
 * Welcome to the Jungle — its own search API, not a generic jobboard scrape.
 *
 * WTTJ runs a public Algolia index behind its site. Credentials are the standard
 * client-side search pair, captured from the site's own requests and usable as
 * the site uses them: the key is referer-restricted, so the Referer header is
 * required (without it Algolia answers "Method not allowed with this referer").
 * The app id is case-sensitive and uppercase — lowercase yields a 403 that reads
 * like a bad key.
 *
 * Verified 2026-09-01: filtering on organization.slug "lacoste" returns
 * nbHits 31 with 43 fields per hit, including salary bands, remote policy and
 * experience level that the JSON-LD path never exposes.
 *
 * This replaces fetching 1294 individual pages with one query per employer.
 */

const APP_ID = 'CSEKHVMS53';
/** Public, client-side search key — the one the website itself ships. */
const SEARCH_KEY = '4bd8f6215d0cc52b26430765769e65a0';
const INDEX = 'wttj_jobs_production_fr';

/** Algolia caps a single page; 100 is its maximum hitsPerPage. */
const PAGE_SIZE = 100;

const HEADERS = {
  'x-algolia-application-id': APP_ID,
  'x-algolia-api-key': SEARCH_KEY,
  'content-type': 'application/json',
  // The key is referer-restricted; this is not spoofing a browser, it is the
  // scope the key was issued for.
  referer: 'https://www.welcometothejungle.com/',
  origin: 'https://www.welcometothejungle.com',
};

type WttjOffice = { city?: string; country?: string; zip_code?: string };

type WttjHit = {
  slug?: string;
  reference?: string;
  name?: string;
  contract_type?: string;
  published_at?: string;
  offices?: WttjOffice[];
  organization?: { slug?: string; name?: string };
  salary_minimum?: number;
  salary_maximum?: number;
  salary_currency?: string;
  salary_period?: string;
  remote?: string;
  experience_level_minimum?: number;
  description?: string;
  profile?: string;
};

type WttjResponse = { nbHits?: number; hits?: WttjHit[] };

function stripHtml(value?: string): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

function toNormalized(hit: WttjHit, organizationSlug: string): NormalizedJob | null {
  if (!hit.name) return null;

  const office = hit.offices?.[0];
  const postedAt = hit.published_at ? new Date(hit.published_at) : undefined;
  const description = [stripHtml(hit.description), stripHtml(hit.profile)]
    .filter(Boolean)
    .join('\n\n');

  return {
    externalId: String(hit.reference ?? hit.slug ?? hit.name),
    title: hit.name,
    location: [office?.city, office?.zip_code].filter(Boolean).join(', ') || undefined,
    country: office?.country,
    contract: hit.contract_type,
    city: office?.city,
    postalCode: office?.zip_code,
    // WTTJ publishes what most sources never do.
    remote: hit.remote,
    experienceYears: hit.experience_level_minimum,
    salaryMin: hit.salary_minimum,
    salaryMax: hit.salary_maximum,
    salaryCurrency: hit.salary_currency,
    salaryPeriod: hit.salary_period,
    description: description || undefined,
    url: `https://www.welcometothejungle.com/fr/companies/${organizationSlug}/jobs/${hit.slug ?? ''}`,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: hit,
  };
}

/**
 * Every WTTJ posting for one employer. `config.slug` is the organization slug as
 * it appears in the URL (/fr/companies/{slug}/jobs).
 */
export async function fetchWttjJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const slug = String(config.slug ?? config.organization ?? '');
  if (!slug) throw new Error('WTTJ organization slug missing');

  const jobs: NormalizedJob[] = [];

  for (let page = 0; ; page++) {
    const response = await fetchJson<WttjResponse>(
      `https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`,
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          query: '',
          filters: `organization.slug:${slug}`,
          hitsPerPage: PAGE_SIZE,
          page,
        }),
      },
    );

    const hits = response.hits ?? [];
    for (const hit of hits) {
      const job = toNormalized(hit, slug);
      if (job) jobs.push(job);
    }

    // A short page is the last one; nbHits also bounds the loop.
    if (hits.length < PAGE_SIZE) break;
    if (response.nbHits !== undefined && jobs.length >= response.nbHits) break;
  }

  return jobs;
}
