import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { createHash } from 'node:crypto';
import { fetchText } from '../../lib/http.js';
import { collapseWhitespace } from '../../lib/normalize.js';
import type { NormalizedJob } from '../../types.js';

function flattenJsonLd(value: unknown): any[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value && typeof value === 'object' && '@graph' in (value as any)) return flattenJsonLd((value as any)['@graph']);
  return value && typeof value === 'object' ? [value] : [];
}

function parseJobPostings(html: string, pageUrl: string): NormalizedJob[] {
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
        const externalId = String(node.identifier?.value ?? node.identifier ?? createHash('sha1').update(url).digest('hex'));
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
  const startUrl = String(config.startUrl ?? '');
  if (!startUrl) throw new Error('Generic JSON-LD startUrl missing');
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
