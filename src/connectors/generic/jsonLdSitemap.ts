import { fetchText } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

/**
 * Generic employer connector: sitemap -> job pages -> schema.org JobPosting.
 *
 * This is the workhorse of the pipeline. Most employers run a careers domain of
 * their own that declares a sitemap and emits JobPosting JSON-LD, so one parser
 * covers many employers regardless of which ATS sits behind them.
 *
 * It is also the source of record we prefer on legal grounds. Vendor APIs are not
 * automatically fair game: api.smartrecruiters.com/robots.txt reserves
 * /v1/companies/ for LinkedInBot and sends `User-agent: * / Disallow: /`, while
 * the employer domain it redirects to (e.g. jobs.courir.com) publishes
 * `User-agent: * / Allow: /` plus a job sitemap. Same jobs, clean route, and the
 * apply URL is the employer's own — which is what a candidate should be handed.
 *
 * Verified 2026-09-01 on jobs.courir.com: job-sitemap.xml -> 200, and a detail
 * page yields title, datePosted, hiringOrganization, jobLocation with postalCode.
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const REQUEST_HEADERS = { 'user-agent': USER_AGENT };

/** Extracts <loc> values from a urlset or sitemapindex document. */
export function parseSitemapLocations(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
}

export async function fetchSitemapUrls(sitemapUrl: string): Promise<string[]> {
  const xml = await fetchText(sitemapUrl, { headers: REQUEST_HEADERS });
  return parseSitemapLocations(xml);
}

type JsonLdNode = Record<string, any>;

/** Walks @graph / arrays so a JobPosting nested in a graph is still found. */
function collectNodes(value: unknown, out: JsonLdNode[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const node = value as JsonLdNode;
  out.push(node);
  if (node['@graph']) collectNodes(node['@graph'], out);
}

function hasType(node: JsonLdNode, type: string): boolean {
  const raw = node['@type'];
  return Array.isArray(raw) ? raw.includes(type) : raw === type;
}

export function extractJobPostings(html: string): JsonLdNode[] {
  const blocks = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];

  const found: JsonLdNode[] = [];
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1].trim());
    } catch {
      // A single malformed block must not discard the rest of the page.
      continue;
    }
    const nodes: JsonLdNode[] = [];
    collectNodes(parsed, nodes);
    found.push(...nodes.filter((node) => hasType(node, 'JobPosting')));
  }
  return found;
}

function stripHtml(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(?:lt|gt|quot|#39);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

function firstOf<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** schema.org employmentType is an enum (FULL_TIME…), not a French contract. */
function readEmploymentType(value: unknown): string | undefined {
  const raw = firstOf(value as string | string[] | undefined);
  return typeof raw === 'string' ? raw : undefined;
}

export function normalizeJobPosting(
  node: JsonLdNode,
  pageUrl: string,
): NormalizedJob | null {
  const title = typeof node.title === 'string' ? node.title.trim() : undefined;
  if (!title) return null;

  const place = firstOf(node.jobLocation) as JsonLdNode | undefined;
  const address = place?.address as JsonLdNode | undefined;
  const city = typeof address?.addressLocality === 'string' ? address.addressLocality : undefined;
  const region = typeof address?.addressRegion === 'string' ? address.addressRegion : undefined;
  const postalCode = typeof address?.postalCode === 'string' ? address.postalCode : undefined;

  // addressCountry is either "FR" or { name: "France" }.
  const rawCountry = address?.addressCountry;
  const country =
    typeof rawCountry === 'string'
      ? rawCountry
      : typeof rawCountry?.name === 'string'
        ? rawCountry.name
        : undefined;

  const identifier = node.identifier as JsonLdNode | string | undefined;
  const externalId =
    (typeof identifier === 'object' && typeof identifier?.value === 'string'
      ? identifier.value
      : typeof identifier === 'string'
        ? identifier
        : undefined) ?? pageUrl;

  const postedAt = node.datePosted ? new Date(String(node.datePosted)) : undefined;

  return {
    externalId,
    title,
    location: [city, region, postalCode].filter(Boolean).join(', ') || undefined,
    country,
    contract: readEmploymentType(node.employmentType),
    description: stripHtml(node.description),
    // The employer's own page: the canonical apply URL under source priority.
    url: typeof node.url === 'string' ? node.url : pageUrl,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: node,
  };
}

/** Reads one job page and returns its first JobPosting, or null if none. */
export async function fetchJobFromPage(pageUrl: string): Promise<NormalizedJob | null> {
  const html = await fetchText(pageUrl, { headers: REQUEST_HEADERS });
  const [posting] = extractJobPostings(html);
  return posting ? normalizeJobPosting(posting, pageUrl) : null;
}
