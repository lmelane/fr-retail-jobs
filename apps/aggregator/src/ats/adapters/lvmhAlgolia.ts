import { fetchJson, fetchText } from '../../lib/http.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * LVMH's public job index — Sephora, Louis Vuitton, Dior, Tiffany and 49 other
 * Maisons behind one Algolia query.
 *
 * Three earlier discovery passes concluded LVMH had no enumerable listing: the
 * offers/search routes 404, the page is client-rendered, and www.lvmh.com kills
 * headless Chromium with ERR_HTTP2_PROTOCOL_ERROR. All true, and all beside the
 * point — the index is reachable directly, and the credentials are static in
 * the site's own JS bundle.
 *
 * Verified 2026-09-02: nbHits 5222 with exhaustiveNbHits true, of which 1200 in
 * France. Every hit carries the full posting in four blocks plus a direct apply
 * URL on the employer's ATS.
 *
 * Two traps this file exists to avoid:
 *  - The 32-hex string in the page HTML is a PRISMIC IMAGE HASH, not a key.
 *    Using it returns 403. The real credentials live in the JS chunks.
 *  - The key is a public search key embedded client-side, so LVMH rotates it on
 *    deploy. A 403 must fail loudly: a silent empty result reads as "this Maison
 *    has no openings", which is how a dead WTTJ key produced false negatives
 *    across three discovery batches.
 */

const APP_ID = 'SDMQTD2J9T';
const INDEX = 'PRD-en-us';
const HOST = `https://${APP_ID}-dsn.algolia.net`;

/** Known-good as of 2026-09-02; refreshed from the bundle when it stops working. */
const FALLBACK_KEY = 'a5c6f4c87dea9aac0732631cd87583b2';

/** Algolia's own maximum. The index sets no paginationLimitedTo, verified to page 53. */
const PAGE_SIZE = 100;

/** Guard against a changed response shape paginating forever. */
const MAX_PAGES = Number(process.env.LVMH_MAX_PAGES ?? 120);

const LISTING_URL = 'https://www.lvmh.com/join-us/our-job-offers';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type LvmhHit = {
  objectID?: string | number;
  name?: string;
  maison?: string;
  businessGroup?: string;
  city?: string;
  country?: string;
  countryRegion?: string;
  contract?: string;
  fullTimePartTime?: string;
  function?: string;
  /** Apply URL on the Maison's own ATS. */
  link?: string;
  atsId?: string | number;
  /** The posting, split across four blocks the site renders in order. */
  description?: string;
  jobResponsabilities?: string;
  profile?: string;
  additionalInformation?: string;
  /** Epoch SECONDS of publication (probed live 2026-09-03) — F-05. */
  publicationTimestamp?: number;
};

type AlgoliaResponse = {
  hits?: LvmhHit[];
  nbHits?: number;
  message?: string;
  status?: number;
};

function stripHtml(value?: string): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|li|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(?:lt|gt|quot|#39|rsquo|eacute);/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
}

/**
 * Re-reads the search key from the site's JS bundle.
 *
 * Called only when the pinned key is refused, so the usual path costs no extra
 * requests. The credentials appear as a literal `("SDMQTD2J9T","<key>")` pair.
 */
async function extractKeyFromBundle(): Promise<string | undefined> {
  const html = await fetchText(LISTING_URL, { headers: { 'user-agent': USER_AGENT } });
  const chunks = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map(
    (match) => match[1],
  );

  for (const chunk of chunks) {
    try {
      const source = await fetchText(`https://www.lvmh.com${chunk}`, {
        headers: { 'user-agent': USER_AGENT },
      });
      const key = source.match(new RegExp(`"${APP_ID}"\\s*,\\s*"([0-9a-f]{32})"`))?.[1];
      if (key) return key;
    } catch {
      // One unreachable chunk must not stop the search.
    }
  }
  return undefined;
}

async function query(key: string, filters: string, page: number): Promise<AlgoliaResponse> {
  return fetchJson<AlgoliaResponse>(`${HOST}/1/indexes/${INDEX}/query`, {
    method: 'POST',
    headers: {
      'x-algolia-application-id': APP_ID,
      'x-algolia-api-key': key,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: '', filters, hitsPerPage: PAGE_SIZE, page }),
  });
}

function toNormalized(hit: LvmhHit): NormalizedJob | null {
  if (!hit.name) return null;

  // The site renders these four blocks in this order; a candidate reads them
  // as one posting.
  const description = [hit.description, hit.jobResponsabilities, hit.profile, hit.additionalInformation]
    .map((part) => stripHtml(part))
    .filter(Boolean)
    .join('\n\n');

  return {
    externalId: String(hit.objectID ?? hit.atsId ?? hit.name),
    title: hit.name,
    location: [hit.city, hit.countryRegion].filter(Boolean).join(', ') || undefined,
    city: hit.city,
    region: hit.countryRegion,
    country: hit.country,
    contract: hit.contract,
    workingTime: hit.fullTimePartTime,
    department: hit.function,
    // The Maison, not the group: "Sephora", not "LVMH".
    company: hit.maison,
    group: hit.businessGroup,
    description: description || undefined,
    // Straight to the Maison's own ATS — the canonical apply URL, which is why
    // this source outranks any jobboard reposting it.
    url: hit.link ?? `${LISTING_URL}?ref=${hit.objectID ?? ''}`,
    // F-05: the feed DOES carry a date — epoch seconds, not ms.
    postedAt: hit.publicationTimestamp ? new Date(hit.publicationTimestamp * 1000) : undefined,
    raw: hit,
  };
}

/**
 * Reads LVMH job offers.
 *
 * `config.maison` narrows to one Maison (exact facet value, e.g. "Sephora");
 * `config.country` narrows by country, defaulting to France. Omit both for the
 * whole index.
 */
export async function fetchLvmhJobs(config: Record<string, unknown> = {}): Promise<AdapterResult> {
  const filters = [
    'category:job',
    config.maison ? `maison:"${String(config.maison).replace(/"/g, '')}"` : '',
    config.country === null ? '' : `country:"${String(config.country ?? 'France')}"`,
  ]
    .filter(Boolean)
    .join(' AND ');

  let key = String(config.apiKey ?? FALLBACK_KEY);
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  let declaredTotal: number | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    let response = await query(key, filters, page);

    // The pinned key has been rotated: re-read it from the bundle once, then
    // retry. Failing loudly matters more than failing gracefully here — an
    // empty result is indistinguishable from "this Maison is not hiring".
    if (response.status === 403 && page === 0) {
      const fresh = await extractKeyFromBundle();
      if (!fresh) {
        throw new Error(
          'LVMH Algolia key rejected and no replacement found in the site bundle. ' +
            'Re-extract it from https://www.lvmh.com/join-us/our-job-offers rather than ' +
            'treating this as zero offers.',
        );
      }
      key = fresh;
      response = await query(key, filters, page);
    }

    if (response.status === 403 || response.message) {
      throw new Error(`LVMH Algolia refused the query: ${response.message ?? 'status 403'}`);
    }

    const hits = response.hits ?? [];
    let fresh = 0;
    for (const hit of hits) {
      const job = toNormalized(hit);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
      fresh++;
    }

    if (response.nbHits !== undefined) declaredTotal = response.nbHits;
    if (hits.length < PAGE_SIZE || fresh === 0) break;
    if (response.nbHits !== undefined && jobs.length >= response.nbHits) break;
  }

  return { jobs, declaredTotal };
}
