import pLimit from 'p-limit';
import { fetchText } from '../../lib/http.js';
import { fetchSitemapUrls } from '../../connectors/generic/jsonLdSitemap.js';
import { parseMicrodataDescription } from './successfactors.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Avature career sites (L'Oréal, and the group's Maisons).
 *
 * The only vendor in the catalogue with no usable API. Verified 2026-09-01 by
 * capturing every XHR on careers.loreal.com with no keyword filter and a scroll
 * to trigger pagination: the only requests are cookie consent and a Cloudflare
 * challenge. The listing is server-rendered, and /SearchJobs/json returns HTML.
 *
 * Worse, its JSON-LD is near-empty — @context, @type, title, datePosted, and
 * `jobLocation: null`. That is why L'Oréal reported "0 France" through the
 * generic connector: nothing to filter on. So the location is read from the page
 * itself, which does carry it in a meta description of the form
 * "… | {City}, {Region} | …".
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = { 'user-agent': USER_AGENT };

/** Only JobDetail URLs are offers; the sitemap also lists utility routes. */
const JOB_URL = /\/jobs\/JobDetail\//;

function decode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&(?:lt|gt|nbsp);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const found = html.match(pattern)?.[1];
    if (found) {
      const value = decode(found);
      if (value) return value;
    }
  }
  return undefined;
}

export function parseAvatureJob(html: string, url: string): NormalizedJob | null {
  const title = firstMatch(html, [
    /<meta property="og:title" content="([^"]+)"/i,
    /<h1[^>]*>([^<]+)<\/h1>/i,
    /<title>([^<|]+)/i,
  ]);
  if (!title) return null;

  // Avature exposes the city in structured fields on the page rather than in
  // its JSON-LD, which stays empty.
  const location = firstMatch(html, [
    /"jobLocation"\s*:\s*"([^"]+)"/i,
    /data-location="([^"]+)"/i,
    /class="[^"]*job-?location[^"]*"[^>]*>\s*([^<]{2,60})</i,
    /<meta name="description" content="[^"|]*\|\s*([^"|]{2,60})\s*\|/i,
  ]);

  const posted = firstMatch(html, [/"datePosted"\s*:\s*"([^"]+)"/i]);
  const postedAt = posted ? new Date(posted) : undefined;

  const description = firstMatch(html, [
    /<meta property="og:description" content="([^"]+)"/i,
    /<meta name="description" content="([^"]+)"/i,
  ]);

  return {
    externalId: url.match(/\/(\d+)\/?$/)?.[1] ?? url,
    title,
    location,
    // The pages carry no country field; France detection falls back to the city.
    description,
    url,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: { source: 'avature', url },
  };
}

/** One result card on the SearchJobs listing. */
const LISTING_CARD =
  /href="([^"]*\/jobs\/JobDetail\/[^"]+)"[\s\S]{0,120}?>([^<]{3,120})<[\s\S]{0,600}?/g;

/**
 * Parses the SearchJobs listing, which is where Avature actually puts the city.
 *
 * The detail page does NOT carry it — no JSON-LD location, no meta, no data
 * attribute — but each listing card renders "title … city … Publié {date}".
 * Reading the listing is therefore both the only way to get a location and far
 * cheaper than one request per offer.
 */
export function parseAvatureListing(html: string): NormalizedJob[] {
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(LISTING_CARD)) {
    const url = decode(match[1]);
    const title = decode(match[2]);
    if (!title || seen.has(url)) continue;
    seen.add(url);

    // The block after the title holds " | city | Publié dd-Mmm-yyyy".
    const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 900);
    const cells = tail
      .replace(/<[^>]+>/g, '|')
      .split('|')
      .map((cell) => decode(cell))
      .filter(Boolean);

    const publishedAt = cells.findIndex((cell) => /^Publi/i.test(cell));
    // The city is the cell immediately before "Publié …".
    const location = publishedAt > 0 ? cells[publishedAt - 1] : undefined;
    const posted = cells[publishedAt]?.match(/(\d{1,2}-\w{3}-\d{4})/)?.[1];
    const postedAt = posted ? new Date(posted.replace(/-/g, ' ')) : undefined;

    jobs.push({
      externalId: url.match(/\/(\d+)\/?$/)?.[1] ?? url,
      title,
      location,
      description: cells.slice(publishedAt + 1).join(' ').slice(0, 4000) || undefined,
      url,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
      raw: { source: 'avature' },
    });
  }

  return jobs;
}

/**
 * Reads a whole Avature board.
 *
 * Prefers the listing, which carries the location; falls back to per-offer pages
 * from the sitemap only when no listing URL is configured.
 */
export async function fetchAvatureJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const listingUrl = String(config.listingUrl ?? '');

  if (listingUrl) {
    const jobs: NormalizedJob[] = [];
    const seen = new Set<string>();
    const pageSize = Number(config.pageSize ?? 20);
    const maxPages = Number(config.maxPages ?? 120);

    // Avature announces no total; the truncation signal here is exhausting the
    // page cap while every page still yielded fresh offers (F-04).
    let truncated = false;
    for (let page = 0; page < maxPages; page++) {
      const separator = listingUrl.includes('?') ? '&' : '?';
      const html = await fetchText(`${listingUrl}${separator}jobOffset=${page * pageSize}`, {
        headers: HEADERS,
      });

      const batch = parseAvatureListing(html);
      const fresh = batch.filter((job) => !seen.has(job.externalId));
      for (const job of fresh) {
        seen.add(job.externalId);
        jobs.push(job);
      }
      if (fresh.length === 0) break;
      if (page === maxPages - 1) truncated = true;
    }

    if (config.withDescriptions === false) return { jobs, truncated };

    /**
     * The listing snippet is ~290 characters — an excerpt, not the posting. The
     * full text lives on the detail page as MICRODATA (itemprop="description"),
     * the same shape SuccessFactors uses, since its JSON-LD is empty.
     */
    const detailLimit = pLimit(Number(config.detailConcurrency ?? 8));
    const withDescriptions = await Promise.all(
      jobs.map((job) =>
        detailLimit(async () => {
          try {
            const html = await fetchText(job.url, { headers: HEADERS });
            const full = parseMicrodataDescription(html);
            return full && full.length > (job.description?.length ?? 0)
              ? { ...job, description: full }
              : job;
          } catch {
            // A failed detail fetch must not lose the listing entry.
            return job;
          }
        }),
      ),
    );
    return { jobs: withDescriptions, truncated };
  }

  const sitemapUrl = String(config.sitemapUrl ?? '');
  if (!sitemapUrl) throw new Error('Avature listingUrl or sitemapUrl required');

  const urls = (await fetchSitemapUrls(sitemapUrl)).filter((url) => JOB_URL.test(url));
  const limit = pLimit(Number(config.concurrency ?? 10));

  const jobs = await Promise.all(
    urls.map((url) =>
      limit(async () => {
        try {
          return parseAvatureJob(await fetchText(url, { headers: HEADERS }), url);
        } catch {
          // One unreachable page must not lose the rest of the board.
          return null;
        }
      }),
    ),
  );

  // Sitemap path: the sitemap IS the full enumeration — its length is the
  // declared total, and a page that failed to parse is the truncation.
  const parsed = jobs.filter((job): job is NormalizedJob => job !== null);
  return { jobs: parsed, declaredTotal: urls.length };
}
