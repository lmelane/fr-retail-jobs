import * as cheerio from 'cheerio';
import { fetchText } from '../../lib/http.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/** Flatchr's public Next.js board embeds the entire list, including cards hidden
 * behind “Voir plus”. No country, language or browser page-size filter is applied.
 * Contract end_date is NOT an application deadline; language is the board locale,
 * not necessarily the posting language (all 121 Adopt items say fr_FR).
 */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function number(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
function date(value: unknown): Date | undefined {
  const s = text(value);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : undefined;
}
function descriptionText(parts: unknown[]): string {
  const html = parts.filter(value => typeof value === 'string').join('\n');
  const body = cheerio.load(html.replace(/<\/(p|li|div|h[1-6])>/gi, '</$1>\n'));
  body('script,style').remove();
  return body.text().replace(/\n\s*\n/g, '\n').trim();
}
export function parseFlatchrBoard(html: string, listingUrl: string): AdapterResult {
  const url = new URL(listingUrl);
  if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password) {
    throw new Error('Flatchr requires an unfiltered HTTPS company board');
  }
  const $ = cheerio.load(html);
  const script = $('#__NEXT_DATA__').text();
  if (!script) throw new Error('Flatchr: missing Next.js payload (not an empty board)');
  const payload = JSON.parse(script);
  const props = payload.props;
  const items = props?.data?.items;
  const slug = text(payload.query?.companySlug);
  const base = text(props?.baseUrlPath);
  if (payload.page !== '/company/[companySlug]' || !Array.isArray(items) || !slug ||
      !base || !/^\/[a-z]{2}(?:-[A-Za-z]{2})?\/company$/.test(base) ||
      !/^[a-z0-9-]+$/i.test(slug) || Object.keys(payload.query).some(k => k !== 'companySlug') ||
      props.queryEndUrl || props.isIframe === true) {
    throw new Error('Flatchr: unexpected or filtered board shape');
  }
  const boardPath = `${base}/${slug}`;
  if (url.pathname.replace(/\/$/, '') !== boardPath) throw new Error('Flatchr: board identity/path mismatch');
  const countText = $('.jobs-found').first().text().trim();
  const count = countText.match(/^([\d\s\u00a0\u202f]+)\s+\D/);
  const declaredTotal = count ? Number(count[1].replace(/\s/g, '')) : undefined;
  const ids = new Set<string>();
  const publicationIds = new Set<string>();
  const jobs: NormalizedJob[] = items.map((item: any) => {
    const job = parseFlatchrItem(item, listingUrl);
    if (ids.has(job.externalId) || publicationIds.has(item.id)) throw new Error('Flatchr: duplicate vacancy or publication identity');
    ids.add(job.externalId); publicationIds.add(item.id);
    return job;
  });
  // The rendered count corroborates the listing scope. Missing count is unknown,
  // including zero: never turn an unproven empty payload into mass closures.
  return { jobs, declaredTotal, truncated: declaredTotal !== undefined && declaredTotal !== jobs.length,
    complete: declaredTotal !== undefined && declaredTotal === jobs.length };
}

export async function fetchFlatchrJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const listingUrl = text(config.listingUrl);
  if (!listingUrl) throw new Error('Flatchr listingUrl missing');
  return parseFlatchrBoard(await fetchText(listingUrl), listingUrl);
}

/** One retained native publication item, also used by the board collector. */
export function parseFlatchrItem(item: any, listingUrl: string): NormalizedJob {
  const url = new URL(listingUrl);
  const boardPath = url.pathname.replace(/\/$/, '');
  const match = /^\/[a-z]{2}(?:-[A-Za-z]{2})?\/company\/([a-z0-9-]+)$/i.exec(boardPath);
  if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password || !match) throw new Error('Flatchr: invalid company board');
  const slug = match[1];
  const v = item?.vacancy;
  if (!v || item.published !== true || item.status !== 'published' || !text(item.id) ||
      !text(v.id) || !text(v.slug) || !/^[a-z0-9-]+$/i.test(v.slug) ||
      !text(v.title) || !text(v.company?.name) || v.company?.slug !== slug) {
    throw new Error('Flatchr: invalid, unpublished or foreign-tenant item');
  }
  const externalId = `${v.company.id}:${v.id}`;
  if (!text(v.company.id)) throw new Error('Flatchr: missing company identity');
  // These fields feed the public board filters/cards even when the detail
  // template hides its address/contract block via show_* flags.
  const address = v.address;
  // Flatchr names the company portrait "description"; it cannot stand in
  // for the vacancy's mission/profile (official vacancy schema).
  if (!descriptionText([v.mission, v.profile])) throw new Error(`Flatchr: missing job content for ${externalId}`);
  const description = descriptionText([v.description, v.mission, v.profile]);
  const latitude = number(address?.location_lat);
  const longitude = number(address?.location_lng);
  const hasCoordinates = latitude !== undefined && longitude !== undefined &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  return {
    externalId, title: v.title.trim(), company: v.company.name.trim(), description,
    // Preserve the explicit source assertion. Company.parentGroup remains
    // governed by the reviewed central reference, not arbitrary vendor text.
    group: text(v.company.group),
    url: `${url.origin}${boardPath}/vacancy/${v.slug}`,
    location: text(address?.formatted_address), city: text(address?.locality),
    postalCode: text(address?.postal_code), country: text(address?.country),
    // The source's administrative_area levels are inconsistent between countries;
    // preserve them in RAW instead of labelling a département as a region.
    ...(hasCoordinates ? { latitude, longitude } : {}),
    contract: text(v.contract_type),
    workingTime: typeof v.partial === 'boolean' ? (v.partial ? 'part-time' : 'full-time') : undefined,
    ...(v.show_salary === true ? {
      salaryMin: number(v.salary), salaryMax: number(v.salary_max), salaryCurrency: text(v.currency),
      salaryPeriod: ({ y: 'YEAR', m: 'MONTH', h: 'HOUR' } as Record<string, string>)[v.mensuality],
    } : {}),
    // Public card date is publication.created_at, never vacancy.updated_at.
    postedAt: date(item.publish_date) ?? date(item.created_at),
    raw: item,
  };
}
