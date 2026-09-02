import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { createHash } from 'node:crypto';
import { fetchText } from '../../lib/http.js';
import { fetchSitemapUrls } from '../../connectors/generic/jsonLdSitemap.js';
import { collapseWhitespace } from '../../lib/normalize.js';
import type { NormalizedJob } from '../../types.js';

function flattenJsonLd(value: unknown): any[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value && typeof value === 'object' && '@graph' in (value as any)) return flattenJsonLd((value as any)['@graph']);
  return value && typeof value === 'object' ? [value] : [];
}

/** Exported so the identity rule can be tested without fetching a live board. */
export function parseJobPostings(html: string, pageUrl: string): NormalizedJob[] {
  const $ = cheerio.load(html);
  const jobs: NormalizedJob[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      const json = JSON.parse(raw);
      for (const node of flattenJsonLd(json)) {
        const type = node['@type'];
        const isJob = type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
        if (!isJob || !node.title) continue;
        const address = node.jobLocation?.address ?? node.jobLocation?.[0]?.address ?? {};
        const location = [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', ');
        const url = node.url ? new URL(node.url, pageUrl).toString() : pageUrl;
        /**
         * The page URL is the identity, not schema.org `identifier`.
         *
         * That field is supposed to identify the posting, but boards routinely
         * put the EMPLOYER's id there: all 397 Courir offers carry the same
         * `identifier.value`, so keying on it collapsed the whole board to one
         * job. The URL is unique per posting by construction.
         */
        const externalId = createHash('sha1').update(url).digest('hex');
        jobs.push({
          externalId,
          title: collapseWhitespace(String(node.title)),
          location: location || undefined,
          country: typeof address.addressCountry === 'string' ? address.addressCountry : address.addressCountry?.name,
          contract: node.employmentType ? String(Array.isArray(node.employmentType) ? node.employmentType.join(', ') : node.employmentType) : undefined,
          description: node.description ? String(node.description) : undefined,
          url,
          postedAt: node.datePosted ? new Date(node.datePosted) : undefined,
          raw: node,
        });
      }
    } catch { /* malformed JSON-LD */ }
  });
  return jobs;
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
