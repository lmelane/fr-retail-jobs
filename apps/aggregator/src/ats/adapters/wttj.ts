import { fetchJson, fetchText } from '../../lib/http.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

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
/**
 * Public, client-side search key — the one the website itself ships.
 *
 * WTTJ rotates it on deploy, so this is a starting point, not a constant. When
 * it is refused, refreshSearchKey() reads the current one out of any company
 * page, where it appears as ALGOLIA_API_KEY_CLIENT in the embedded config.
 *
 * This matters more than it looks: a rotated key makes Algolia answer 403, and
 * a caller that reads that as `nbHits: null` sees "this Maison has no
 * openings". That silent failure produced false NONE verdicts across three
 * discovery batches before anyone noticed the key had changed.
 */
let searchKey = '4bd8f6215d0cc52b26430765769e65a0';
const INDEX = 'wttj_jobs_production_fr';

/** Any company page carries the current credentials in its inlined config. */
const KEY_SOURCE = 'https://www.welcometothejungle.com/fr/companies/lacoste/jobs';

/** Algolia caps a single page; 100 is its maximum hitsPerPage. */
const PAGE_SIZE = 100;

function headers() {
  return {
    'x-algolia-application-id': APP_ID,
    'x-algolia-api-key': searchKey,
    'content-type': 'application/json',
    // The key is referer-restricted; this is not spoofing a browser, it is the
    // scope the key was issued for.
    referer: 'https://www.welcometothejungle.com/',
    origin: 'https://www.welcometothejungle.com',
  };
}

/**
 * Re-reads the current search key from a WTTJ page.
 *
 * Called only after a refusal, so the normal path costs no extra request.
 * Returns false when no key can be found, which the caller must treat as a
 * failure rather than as an empty result.
 */
async function refreshSearchKey(): Promise<boolean> {
  try {
    const html = await fetchText(KEY_SOURCE, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    const found = html.match(/"ALGOLIA_API_KEY_CLIENT"\s*:\s*"([0-9a-f]{32})"/)?.[1];
    if (!found || found === searchKey) return false;
    searchKey = found;
    return true;
  } catch {
    return false;
  }
}

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

type WttjResponse = { nbHits?: number; hits?: WttjHit[]; message?: string; status?: number };

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
    // The employer as WTTJ names it — without it, a group slug's offers all
    // inherit the catalogue label (audit A-01).
    company: hit.organization?.name,
    url: `https://www.welcometothejungle.com/fr/companies/${organizationSlug}/jobs/${hit.slug ?? ''}`,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: hit,
  };
}

/**
 * Every WTTJ posting for one employer. `config.slug` is the organization slug as
 * it appears in the URL (/fr/companies/{slug}/jobs).
 */
export async function fetchWttjJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const slug = String(config.slug ?? config.organization ?? '');
  if (!slug) throw new Error('WTTJ organization slug missing');

  const jobs: NormalizedJob[] = [];
  let declaredTotal: number | undefined;

  const ask = (page: number) =>
    fetchJson<WttjResponse>(`https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        // The slug must be QUOTED: unquoted, Algolia silently returns nbHits 0
        // for every organization, which reads as "no jobs" rather than as a
        // malformed filter.
        query: '',
        filters: `organization.slug:"${slug}"`,
        hitsPerPage: PAGE_SIZE,
        page,
      }),
    });

  for (let page = 0; ; page++) {
    let response = await ask(page);

    // A rotated key. Refresh once, then retry — and if that fails, throw. An
    // empty array here is indistinguishable from "this employer is not hiring".
    if (response.status === 403 || response.message) {
      if (page === 0 && (await refreshSearchKey())) {
        response = await ask(page);
      }
      if (response.status === 403 || response.message) {
        throw new Error(
          `WTTJ refused the query (${response.message ?? 'status 403'}). The public search ` +
            'key has rotated and could not be refreshed from the site — re-extract ' +
            'ALGOLIA_API_KEY_CLIENT rather than recording this employer as having no jobs.',
        );
      }
    }

    const hits = response.hits ?? [];
    for (const hit of hits) {
      const job = toNormalized(hit, slug);
      if (job) jobs.push(job);
    }

    if (response.nbHits !== undefined) declaredTotal = response.nbHits;
    // A short page is the last one; nbHits also bounds the loop.
    if (hits.length < PAGE_SIZE) break;
    if (response.nbHits !== undefined && jobs.length >= response.nbHits) break;
  }

  return { jobs, declaredTotal };
}
