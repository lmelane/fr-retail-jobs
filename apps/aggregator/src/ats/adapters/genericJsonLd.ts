import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { createHash } from 'node:crypto';
import { fetchText } from '../../lib/http.js';
import { fetchSitemapUrls, extractJobPostings, normalizeJobPosting } from '../../connectors/generic/jsonLdSitemap.js';
import { fetchRssJobs } from '../../connectors/generic/rssFeed.js';
import { collapseWhitespace, briefError } from '../../lib/normalize.js';
import type { NormalizedJob } from '../../types.js';

function flattenJsonLd(value: unknown): any[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value && typeof value === 'object' && '@graph' in (value as any)) return flattenJsonLd((value as any)['@graph']);
  return value && typeof value === 'object' ? [value] : [];
}

/**
 * Exported so the identity rule can be tested without fetching a live board.
 *
 * A thin wrapper over the shared JSON-LD reader. This file used to carry its
 * own copy of the parser, and the two drifted: the shared one learned to
 * decode numeric entities and to retry JSON containing raw control characters
 * (Michael Page embeds literal newlines in every description), while this copy
 * silently parsed nothing on those pages. One parser, one set of lessons.
 */
export function parseJobPostings(html: string, pageUrl: string): NormalizedJob[] {
  return extractJobPostings(html)
    .map((node) => normalizeJobPosting(node, pageUrl))
    .filter((job): job is NormalizedJob => job !== null)
    .map((job) => ({
      ...job,
      // Stable, compact identity for the (source, externalId) unique key.
      externalId: createHash('sha1').update(pageUrl).digest('hex'),
    }));
}

export async function fetchGenericJsonLdJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  /**
   * An RSS/Atom careers feed, when the site publishes one — the cheapest generic
   * path (no page crawl at all). Many small brands and TalentSoft/WordPress sites
   * expose a feed of openings; parsing it needs no per-vendor code.
   */
  if (config.feedUrl) {
    return fetchRssJobs(config);
  }

  /**
   * A sitemap of job URLs, when the board publishes one.
   *
   * Preferred over link-crawling a start page: it is the site's own list, so it
   * neither misses offers that no page links to nor wanders into unrelated
   * routes. Courir publishes 397 offers this way, each page carrying a complete
   * JobPosting — which is how it is read without touching
   * api.smartrecruiters.com, whose robots.txt permits only LinkedInBot.
   *
   * Sitemaps do go stale (one vendor's listed 65 job URLs, all dead), so a page
   * that no longer parses is skipped rather than failing the run.
   */
  /**
   * A server-rendered, paginated listing whose cards link to detail pages.
   *
   * Michael Page's shape: /jobs?page=N (0-based) serves 20 links per page and
   * the detail pages carry a complete JobPosting. No sitemap of offers exists
   * there, so the listing IS the enumeration. Pages are read until one repeats
   * or comes back short — a pager that answers every page number with page 1
   * is a documented trap (Radancy), so repetition is the stop signal, not the
   * page count.
   */
  const listingPagedUrl = String(config.listingUrl ?? '');
  const linkPattern = String(config.linkPattern ?? '');
  // A soft wall-clock budget, honoured by both phases below: a big listing
  // (Michael Page ~3800 offers) can overrun the run's timeout, so it stops
  // gracefully with what it has rather than being cut mid-flight.
  const deadlineMs = Number(config.deadlineMs) || 0;
  const pastDeadline = () => deadlineMs > 0 && Date.now() >= deadlineMs;
  if (listingPagedUrl && linkPattern) {
    const pageParam = String(config.pageParam ?? 'page');
    // The pattern comes from a CSV column — data, not code. Escaped so a
    // crafted catalogue value can never become an arbitrary regex (audit R-02);
    // every existing pattern is a literal path fragment anyway.
    const escaped = linkPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const linkRe = new RegExp(`href="([^"]*${escaped}[^"]*)"`, 'g');
    const seen = new Set<string>();
    const origin = new URL(listingPagedUrl).origin;

    for (let page = 0; page < Number(config.maxPages ?? 400); page++) {
      if (pastDeadline()) break;
      const sep = listingPagedUrl.includes('?') ? '&' : '?';
      // The end of a paginated listing is signalled one of two ways, and both
      // mean "stop here with what we have", not "fail the source": Michael Page
      // 404s the page after the last (…/jobs?page=191), others just return a page
      // with no offer links. A 404 thrown here used to propagate and discard
      // every offer already collected — the live "michael-page-france failed".
      // A non-404 error (an exhausted-retry blip) also stops the sweep rather
      // than losing the whole source; the pages already collected still ingest.
      let html: string;
      try {
        html = await fetchText(`${listingPagedUrl}${sep}${pageParam}=${page}`, {
          headers: {
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          },
        });
      } catch (error) {
        const is404 = error instanceof Error && / 404 /.test(` ${error.message} `);
        if (!is404) {
          console.error(`[generic-listing] ${listingPagedUrl} stopped at page ${page}: ${briefError(error)}`);
        }
        break;
      }
      const links = [...html.matchAll(linkRe)]
        .map((m) => new URL(m[1], origin).toString().split('#')[0])
        .filter((u) => !seen.has(u));
      if (links.length === 0) break;
      for (const u of links) seen.add(u);
    }

    // F-06: a paginated listing that yields ZERO offer links is a broken
    // linkPattern or a moved listing — not an employer with no openings. The
    // silent [] passed for health until the refresh emptied the source 48h on.
    if (seen.size === 0 && !pastDeadline()) {
      throw new Error(`generic-listing ${listingPagedUrl}: no offer link matched "${linkPattern}" — pattern or listing broken`);
    }

    const limit = pLimit(Number(config.concurrency ?? 6));
    const pages = await Promise.all(
      [...seen].map((url) =>
        limit(async () => {
          // Stop starting new detail fetches past the budget; what was already
          // fetched stays, the rest is picked up next run.
          if (pastDeadline()) return [];
          try {
            return parseJobPostings(
              await fetchText(url, {
                headers: {
                  'user-agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                },
              }),
              url,
            );
          } catch {
            return [];
          }
        }),
      ),
    );
    return pages.flat();
  }

  const sitemapUrl = String(config.sitemapUrl ?? '');
  if (sitemapUrl) {
    const urls = await fetchSitemapUrls(sitemapUrl);
    // F-06: an empty sitemap on a catalogued source is the sitemap moving or
    // dying, not zero openings — say so instead of a quiet [].
    if (urls.length === 0) {
      throw new Error(`generic sitemap ${sitemapUrl}: 0 URLs — sitemap moved or empty`);
    }
    const limit = pLimit(Number(config.concurrency ?? 8));
    const pages = await Promise.all(
      urls.map((url) =>
        limit(async () => {
          try {
            // A browser UA is required here: several boards serve the sitemap to
            // anything but 403 the job pages without one.
            return parseJobPostings(
              await fetchText(url, {
                headers: {
                  'user-agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                },
              }),
              url,
            );
          } catch {
            return [];
          }
        }),
      ),
    );

    const seen = new Set<string>();
    return pages.flat().filter((job) => {
      if (seen.has(job.externalId)) return false;
      seen.add(job.externalId);
      return true;
    });
  }

  const startUrl = String(config.startUrl ?? '');
  if (!startUrl) throw new Error('Generic JSON-LD startUrl or sitemapUrl required');
  const html = await fetchText(startUrl);
  const direct = parseJobPostings(html, startUrl);
  const $ = cheerio.load(html);
  const origin = new URL(startUrl).origin;
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const url = new URL(href, startUrl);
      if (url.origin !== origin) return;
      if (/job|jobs|career|carriere|carrière|recrutement|vacanc/i.test(url.pathname)) links.add(url.toString());
    } catch { /* ignore */ }
  });
  const limit = pLimit(3);
  const pages = await Promise.all([...links].slice(0, 150).map((url) => limit(async () => {
    try { return parseJobPostings(await fetchText(url), url); } catch { return []; }
  })));
  const byKey = new Map<string, NormalizedJob>();
  for (const job of [...direct, ...pages.flat()]) byKey.set(`${job.externalId}|${job.url}`, job);
  return [...byKey.values()];
}
