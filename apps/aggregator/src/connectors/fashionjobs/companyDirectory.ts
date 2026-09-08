import * as cheerio from 'cheerio';
import { fetchRenderedHtml } from '../../lib/browser.js';
import { collapseWhitespace } from '../../lib/normalize.js';
import type { DiscoveredCompany } from '../../types.js';

export const FASHIONJOBS_COMPANIES_URL = 'https://fr.fashionjobs.com/societesrecrutent/';

/**
 * Observed 2026-09-01: the directory renders 668 companies on a single page,
 * with no pagination. Guard well below that so a genuine drop in the directory
 * does not pass silently, while normal churn does not trip the alarm.
 */
const MIN_EXPECTED_COMPANIES = Number(process.env.FASHIONJOBS_MIN_COMPANIES ?? 400);

export function parseFashionJobsCompanies(html: string, options: {
  directoryUrl?: string;
  minExpected?: number;
  allowExplicitEmpty?: boolean;
} = {}): DiscoveredCompany[] {
  const directoryUrl = options.directoryUrl ?? FASHIONJOBS_COMPANIES_URL;
  const origin = new URL(directoryUrl);
  if (origin.protocol !== 'https:' || !/^[a-z]{2}\.fashionjobs\.com$/.test(origin.hostname)) {
    throw new Error('Expected an official FashionJobs country-edition directory');
  }
  const minExpected = options.minExpected ?? MIN_EXPECTED_COMPANIES;
  if (!Number.isSafeInteger(minExpected) || minExpected < 1) throw new Error('Invalid directory minimum');
  const $ = cheerio.load(html);
  const byUrl = new Map<string, DiscoveredCompany>();

  $('a[href]').each((_, element) => {
    const anchor = $(element);
    const rawHref = anchor.attr('href');
    const name = collapseWhitespace(anchor.text());
    if (!rawHref || !name || /image:/i.test(name)) return;

    let url: string;
    try {
      const target = new URL(rawHref, directoryUrl);
      if (target.hostname !== origin.hostname || target.protocol !== 'https:') return;
      target.search = ''; target.hash = '';
      const path = decodeURIComponent(target.pathname);
      // Paths observed across the 87 official editions. The optional locale
      // prefix matters: Poland uses /en-pl/careers/... and otherwise loses 61 rows.
      if (!/^\/(?:[a-z]{2}-[a-z]{2}\/)?(?:recrutement|careers|careers-empleo|karriere-arbeitsplätze|recrutamento-careers|подбор-персонала|招聘|lavora-con-noi|リクルート|vacatures-careers|işe-alım)\/[^/]+\.html$/i.test(path)) return;
      url = target.toString();
    } catch {
      return;
    }

    // Read count metadata without the employer label. Cheerio's text() joins
    // adjacent elements: “MAISON 1-2-3” + “40 offres” otherwise becomes 340.
    const container = anchor.closest('li').length ? anchor.closest('li') : anchor.parent();
    const metadata = container.clone();
    metadata.find('a').remove();
    const surrounding = collapseWhitespace(metadata.text());
    const countMatch = surrounding.match(/(?:\(([\d\s\u00a0\u202f]+)\)|([\d\s\u00a0\u202f]+)\s+offres?\s+d['’]emploi)/i);
    const rawCount = countMatch?.[1] ?? countMatch?.[2];
    const offerCount = rawCount ? Number(rawCount.replace(/\D/g, '')) : undefined;

    const previous = byUrl.get(url);
    if (!previous || (offerCount ?? -1) > (previous.offerCount ?? -1)) {
      byUrl.set(url, {
        name,
        fashionjobsUrl: url,
        fashionjobsSlug: new URL(url).pathname.split('/').at(-1)!.replace(/\.html$/i, ''),
        offerCount,
      });
    }
  });

  const visibleBody = $('body').clone();
  visibleBody.find('script,style').remove();
  const bodyText = collapseWhitespace(visibleBody.text());
  // Never accept a partial alphabetic inventory merely because some older
  // profile paths still matched. Surface a new locale/path instead of losing it.
  $('li.tw-text-12 > a.tw-font-secondary[href]').each((_, element) => {
    const target = new URL($(element).attr('href')!, directoryUrl);
    target.search = ''; target.hash = '';
    if (!byUrl.has(target.toString())) throw new Error(`Unparsed FashionJobs directory row: ${target}`);
  });
  // Six editions explicitly report no directory entries. An empty parse of a
  // changed layout or a challenge is NOT this condition and still fails loudly.
  const explicitEmpty = /There are no items in this category\.|No hay resultados en esta categoría/i.test(bodyText);
  if (byUrl.size === 0 && options.allowExplicitEmpty && explicitEmpty) return [];
  if (byUrl.size < minExpected) {
    throw new Error(
      `FashionJobs company parser returned only ${byUrl.size} companies (expected >= ${minExpected}) for ${directoryUrl}; DOM may have changed or the page was blocked.`,
    );
  }

  return [...byUrl.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function fetchFashionJobsCompanies(): Promise<DiscoveredCompany[]> {
  return parseFashionJobsCompanies(await fetchRenderedHtml(FASHIONJOBS_COMPANIES_URL));
}
