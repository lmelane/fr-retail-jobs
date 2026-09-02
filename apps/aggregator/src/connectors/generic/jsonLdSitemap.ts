import { gunzipSync } from 'node:zlib';
import { fetchText, fetchWithRetry } from '../../lib/http.js';
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

/** Gzipped sitemaps are common at scale; fetchText would hand back binary. */
async function fetchSitemapXml(sitemapUrl: string): Promise<string> {
  if (!/\.gz(\?|$)/i.test(sitemapUrl)) {
    return fetchText(sitemapUrl, { headers: REQUEST_HEADERS });
  }
  const response = await fetchWithRetry(sitemapUrl, { headers: REQUEST_HEADERS });
  const buffer = Buffer.from(await response.arrayBuffer());
  // Some hosts pre-decompress .gz on the wire; only gunzip a real gzip header.
  const isGzip = buffer[0] === 0x1f && buffer[1] === 0x8b;
  return (isGzip ? gunzipSync(buffer) : buffer).toString('utf8');
}

/**
 * Reads a sitemap, expanding a sitemap INDEX one level down.
 *
 * Large boards do not publish a flat list: Welcome to the Jungle's entry URL is a
 * gzipped INDEX pointing at 9 shards, so a naive read returns 24 `.xml.gz` paths
 * and zero jobs. One level of expansion is enough for every source seen so far,
 * and it bounds the work — an index of indexes would otherwise fan out
 * unpredictably.
 */
export async function fetchSitemapUrls(sitemapUrl: string): Promise<string[]> {
  const xml = await fetchSitemapXml(sitemapUrl);
  const locations = parseSitemapLocations(xml);

  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  if (!isIndex) return locations;

  const shards = await Promise.all(
    locations.map(async (shard) => {
      try {
        return parseSitemapLocations(await fetchSitemapXml(shard));
      } catch {
        // One unreachable shard must not lose the others.
        return [];
      }
    }),
  );
  return shards.flat();
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
      // Some CMSs emit raw control characters inside JSON strings — Michael
      // Page's Drupal puts literal newlines in every description — which is
      // invalid JSON that still carries a complete JobPosting. Space the
      // control characters out and retry before giving up on the block.
      try {
        parsed = JSON.parse(block[1].trim().replace(/[\u0000-\u001f]+/g, ' '));
      } catch {
        // A single malformed block must not discard the rest of the page.
        continue;
      }
    }
    const nodes: JsonLdNode[] = [];
    collectNodes(parsed, nodes);
    found.push(...nodes.filter((node) => hasType(node, 'JobPosting')));
  }
  return found;
}

/**
 * HTML to readable plain text.
 *
 * Two lessons are baked in. Numeric entities must be decoded — Courir's
 * postings are full of `&#xa0;`, which the old named-entities-only pass left
 * as literal text on every offer page. And structure must survive: collapsing
 * ALL whitespace turned a posting with bullet lists into one wall of text, so
 * list items and paragraph breaks become line breaks instead.
 */
function stripHtml(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|li|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    // Numeric entities, hex and decimal, before the named ones.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&(?:quot|#39|rsquo|lsquo);/g, "'")
    // Inline bullets from sources that never used <li>: give each its line.
    .replace(/\s+•\s*/g, '\n• ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
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

  /**
   * The page URL is the identifier, not schema.org `identifier`.
   *
   * Publishers routinely put the EMPLOYER's id there rather than the posting's:
   * every Courir offer reports identifier.value "67fe4b37…", so eight postings
   * collapse to one id and every insert after the first violates the
   * (source, externalId) uniqueness constraint. A job page URL is unique by
   * construction.
   */
  const externalId = pageUrl;

  const postedAt = node.datePosted ? new Date(String(node.datePosted)) : undefined;
  const validThrough = node.validThrough ? new Date(String(node.validThrough)) : undefined;

  /**
   * baseSalary, when the publisher fills it. schema.org nests the band as
   * MonetaryAmount -> QuantitativeValue, and many publishers ship the skeleton
   * with empty strings — Michael Page emits the structure on every offer and
   * values on some — so blanks must read as absent, not as zero.
   */
  const salary = (node.baseSalary ?? {}) as JsonLdNode;
  const band = (salary.value ?? {}) as JsonLdNode;
  const toAmount = (value: unknown): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

  return {
    externalId,
    title,
    location: [city, region, postalCode].filter(Boolean).join(', ') || undefined,
    city,
    region,
    postalCode,
    country,
    contract: readEmploymentType(node.employmentType),
    salaryMin: toAmount(band.minValue ?? band.value),
    salaryMax: toAmount(band.maxValue),
    salaryCurrency: typeof salary.currency === 'string' && salary.currency ? salary.currency : undefined,
    salaryPeriod: typeof band.unitText === 'string' && band.unitText ? band.unitText : undefined,
    description: stripHtml(node.description),
    // The employer's own page: the canonical apply URL under source priority.
    url: typeof node.url === 'string' ? node.url : pageUrl,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    validThrough: validThrough && !Number.isNaN(validThrough.getTime()) ? validThrough : undefined,
    raw: node,
  };
}

/** Reads one job page and returns its first JobPosting, or null if none. */
export async function fetchJobFromPage(pageUrl: string): Promise<NormalizedJob | null> {
  const html = await fetchText(pageUrl, { headers: REQUEST_HEADERS });
  const [posting] = extractJobPostings(html);
  return posting ? normalizeJobPosting(posting, pageUrl) : null;
}
