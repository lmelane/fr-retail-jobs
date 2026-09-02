import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { createHash } from 'node:crypto';
import { fetchText } from '../../lib/http.js';
import { fetchSitemapUrls, extractJobPostings, normalizeJobPosting } from '../../connectors/generic/jsonLdSitemap.js';
import { collapseWhitespace } from '../../lib/normalize.js';
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
  if (listingPagedUrl && linkPattern) {
    const pageParam = String(config.pageParam ?? 'page');
    const linkRe = new RegExp(`href="([^"]*${linkPattern}[^"]*)"`, 'g');
    const seen = new Set<string>();
    const origin = new URL(listingPagedUrl).origin;

    for (let page = 0; page < Number(config.maxPages ?? 400); page++) {
      const sep = listingPagedUrl.includes('?') ? '&' : '?';
      const html = await fetchText(`${listingPagedUrl}${sep}${pageParam}=${page}`, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });
      const links = [...html.matchAll(linkRe)]
        .map((m) => new URL(m[1], origin).toString().split('#')[0])
        .filter((u) => !seen.has(u));
      if (links.length === 0) break;
      for (const u of links) seen.add(u);
    }

    const limit = pLimit(Number(config.concurrency ?? 6));
    const pages = await Promise.all(
      [...seen].map((url) =>
        limit(async () => {
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
