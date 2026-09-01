import * as cheerio from 'cheerio';
import { fetchRenderedHtml } from '../../lib/browser.js';
import { collapseWhitespace, slugFromFashionJobsUrl } from '../../lib/normalize.js';
import type { DiscoveredCompany } from '../../types.js';

export const FASHIONJOBS_COMPANIES_URL = 'https://fr.fashionjobs.com/societesrecrutent/';

/**
 * Observed 2026-09-01: the directory renders 668 companies on a single page,
 * with no pagination. Guard well below that so a genuine drop in the directory
 * does not pass silently, while normal churn does not trip the alarm.
 */
const MIN_EXPECTED_COMPANIES = Number(process.env.FASHIONJOBS_MIN_COMPANIES ?? 400);

export function parseFashionJobsCompanies(html: string): DiscoveredCompany[] {
  const $ = cheerio.load(html);
  const byUrl = new Map<string, DiscoveredCompany>();

  $('a[href*="/recrutement/"]').each((_, element) => {
    const anchor = $(element);
    const rawHref = anchor.attr('href');
    const name = collapseWhitespace(anchor.text());
    if (!rawHref || !name || /image:/i.test(name)) return;

    let url: string;
    try {
      url = new URL(rawHref, FASHIONJOBS_COMPANIES_URL).toString();
    } catch {
      return;
    }
    if (!/\/recrutement\/.+\.html/i.test(new URL(url).pathname)) return;

    const surrounding = collapseWhitespace(anchor.closest('li').text() || anchor.parent().text());
    const countMatch = surrounding.match(/(?:\(([\d\s\u00a0\u202f]+)\)|([\d\s\u00a0\u202f]+)\s+offres?\s+d['’]emploi)/i);
    const rawCount = countMatch?.[1] ?? countMatch?.[2];
    const offerCount = rawCount ? Number(rawCount.replace(/\D/g, '')) : undefined;

    const previous = byUrl.get(url);
    if (!previous || (offerCount ?? -1) > (previous.offerCount ?? -1)) {
      byUrl.set(url, {
        name,
        fashionjobsUrl: url,
        fashionjobsSlug: slugFromFashionJobsUrl(url),
        offerCount,
      });
    }
  });

  if (byUrl.size < MIN_EXPECTED_COMPANIES) {
    throw new Error(
      `FashionJobs company parser returned only ${byUrl.size} companies (expected >= ${MIN_EXPECTED_COMPANIES}); DOM may have changed or the page was blocked.`,
    );
  }

  return [...byUrl.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function fetchFashionJobsCompanies(): Promise<DiscoveredCompany[]> {
  return parseFashionJobsCompanies(await fetchRenderedHtml(FASHIONJOBS_COMPANIES_URL));
}
