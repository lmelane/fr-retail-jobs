import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { captureObservedAt } from '../../capture/context.js';
import { fetchJson, fetchText, DEFAULT_DETAIL_CONCURRENCY } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import { assertPipelineRunning } from '../../lib/pipelinePause.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

const ORIGIN = 'https://caudalie.career';
const LISTING = `${ORIGIN}/home/our-job-offers`;
const ENDPOINT = `${ORIGIN}/home/ajax_filter_offers`;
const RAW_SOURCE = 'caudalie-ajax-v1';
type Offer = Record<string, unknown> & { slug: string; title: string };
type RetainedOffer = { source: typeof RAW_SOURCE; listing: Offer; pageUrl: string; detailHtml: string };

function isOffer(value: unknown): value is Offer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.slug === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(row.slug)
    && typeof row.title === 'string' && row.title.trim().length > 0;
}

function detailUrl(offer: Offer) { return `${ORIGIN}/apply/offer/${offer.slug}`; }
const text = (value: string) => (htmlToPlainText(value) ?? '').replace(/\s+/g, ' ').trim();

/** The portal's own AJAX response. A malformed/error response never proves zero. */
export function parseCaudalieListing(value: unknown): Offer[] {
  const body = value as Record<string, unknown> | null;
  if (!body || body.status !== 'success' || body.code !== 200 || !Array.isArray(body.results)
    || body.results.some(row => !isOffer(row))) throw new Error('CAUDALIE_INVALID_LISTING');
  const offers = body.results as Offer[];
  if (new Set(offers.map(row => row.slug)).size !== offers.length) throw new Error('CAUDALIE_DUPLICATE_SLUG');
  return offers;
}

/** Shared by collection and retained-RAW recovery; never manufactures JSON-LD. */
export function readCaudalieRaw(value: unknown): NormalizedJob | null {
  const raw = value as Partial<RetainedOffer> | null;
  if (!raw || raw.source !== RAW_SOURCE || !isOffer(raw.listing)
    || raw.pageUrl !== detailUrl(raw.listing) || typeof raw.detailHtml !== 'string') return null;
  const $ = cheerio.load(raw.detailHtml);
  const section = $('section#page-container');
  const heading = section.children('h1');
  const content = heading.next('div');
  // A login/error page or a different offer cannot become a successful detail.
  if (section.length !== 1 || heading.length !== 1 || content.length !== 1
    || text(heading.text()) !== text(raw.listing.title)) return null;
  const nativeUrl = $('meta[property="og:url"]').attr('content');
  if (nativeUrl && nativeUrl !== raw.pageUrl) return null;
  // Application controls and their consent text are outside the native description.
  if (content.find('form, input, textarea, select').length) return null;
  const description = (htmlToPlainText(content.html() ?? '') ?? '').trim();
  if (!description) return null;
  return {
    externalId: raw.listing.slug,
    title: text(heading.text()),
    url: raw.pageUrl,
    description,
    // This field is the portal's zone filter: France, Europe (sauf France),
    // Amériques, Asie / Pacifique. Only France denotes one country. Feeding
    // an exclusion label to the place resolver would falsely publish it in FR.
    // Keep every original zone in raw.listing, including unknown future zones.
    location: raw.listing.location === 'France' ? 'France' : undefined,
    contract: typeof raw.listing.contract_type === 'string' ? raw.listing.contract_type : undefined,
    // The list's macroregion is not a country. No publication date or structured
    // legal employer is published here; the certified portal policy owns fallback.
    raw,
  };
}

/** Observed on 2026-09-23: offers.min.js posts all three empty filters once;
 * "see more" only reveals five already-loaded rows. The listing is JSON, while
 * details are native HTML without JobPosting JSON-LD. All URLs stay on this portal.
 * This reader is selected explicitly by generic-listing; it creates no ATS enum. */
export async function fetchCaudalieJobs(config: Record<string, unknown> = {}): Promise<AdapterResult> {
  assertPipelineRunning();
  if (config.startUrl !== undefined && config.startUrl !== LISTING) throw new Error('CAUDALIE_INVALID_LISTING_URL');
  const concurrency = Number(config.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > DEFAULT_DETAIL_CONCURRENCY)
    throw new Error('CAUDALIE_INVALID_CONCURRENCY');
  const body = new URLSearchParams({ 'offerFilter[profession]': '', 'offerFilter[contract_type]': '', 'offerFilter[location]': '' });
  const native = await fetchJson<unknown>(ENDPOINT, { method: 'POST', body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest', referer: LISTING } });
  const offers = parseCaudalieListing(native);
  const limit = pLimit(concurrency);
  // Drain scheduled reads before rejecting, so a failed batch leaves no background
  // requests racing its successor. The common transport retains all native bytes.
  const settled = await Promise.allSettled(offers.map(offer => limit(async () => {
    const pageUrl = detailUrl(offer);
    const detailHtml = await fetchText(pageUrl);
    const raw: RetainedOffer = { source: RAW_SOURCE, listing: offer, pageUrl, detailHtml };
    const job = readCaudalieRaw(raw);
    if (!job) throw new Error(`CAUDALIE_INVALID_DETAIL:${offer.slug}`);
    return job;
  })));
  const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
  const jobs = settled.map(result => (result as PromiseFulfilledResult<NormalizedJob>).value);
  const ids = offers.map(offer => offer.slug);
  return { jobs, complete: true, declaredTotal: offers.length, truncated: false,
    enumeration: { method: 'NATIVE_UNFILTERED_AJAX_FEED', endpoint: ENDPOINT, pages: 1, rawCount: offers.length,
      termination: 'FULL_RESPONSE', documentation: `${ORIGIN}/js/career/home/offers.min.js`,
      enumerationTraversalComplete: true, canonicalAbsenceProofUsable: true,
      pageEvidence: [{ url: ENDPOINT, checkedAt: captureObservedAt().toISOString(),
        sha256: createHash('sha256').update(JSON.stringify(native)).digest('hex'), offset: 0, pagination: null,
        ids, canonicalIds: ids, publisherCounter: String(offers.length), componentCounters: ['all three native filters empty'] }] } };
}
