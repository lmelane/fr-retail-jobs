import { gunzipSync } from 'node:zlib';
import { fetchText, fetchWithRetry, readBytesBounded } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
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
  const buffer = await readBytesBounded(response, sitemapUrl);
  // Some hosts pre-decompress .gz on the wire; only gunzip a real gzip header.
  const isGzip = buffer[0] === 0x1f && buffer[1] === 0x8b;
  return (isGzip ? gunzipSync(buffer, { maxOutputLength: 20_000_000 }) : buffer).toString('utf8');
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

  /**
   * An index is declared by <sitemapindex> — or, when the publisher wraps its
   * child sitemaps in a plain <urlset> (Selfridges, 2026-09-06: 5 children,
   * read as 5 "offers" .xml, so 0 real offers), recognised by its content:
   * every entry is itself a sitemap path.
   */
  const looksLikeSitemap = (url: string) => /sitemap.*\.xml(\.gz)?(\?|$)|\/sitemap\/[^/]+$/i.test(url);
  const isIndex =
    /<sitemapindex[\s>]/i.test(xml) || (locations.length > 0 && locations.every(looksLikeSitemap));
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
  /**
   * A placeholder is not a value: Boots (2026-09-06, 1 391 offers) fills
   * addressLocality / addressRegion / postalCode with « - » and puts the real
   * place in streetAddress, which produced « -, -, - » on every offer. Dashes
   * are dropped; when no structured city survives, streetAddress becomes the
   * location text, and the write-time city derivation (street-aware) reads it.
   */
  const text = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed && !/^[-–—.]+$/.test(trimmed) ? trimmed : undefined;
  };
  const city = text(address?.addressLocality);
  const region = text(address?.addressRegion);
  const postalCode = text(address?.postalCode);
  const streetAddress = text(address?.streetAddress);

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
    location: [city, region, postalCode].filter(Boolean).join(', ') || streetAddress || undefined,
    city,
    region,
    postalCode,
    country,
    contract: readEmploymentType(node.employmentType),
    salaryMin: toAmount(band.minValue ?? band.value),
    salaryMax: toAmount(band.maxValue),
    salaryCurrency: typeof salary.currency === 'string' && salary.currency ? salary.currency : undefined,
    salaryPeriod: typeof band.unitText === 'string' && band.unitText ? band.unitText : undefined,
    description: htmlToPlainText(node.description),
    // The employer's own page: the canonical apply URL under source priority.
    url: typeof node.url === 'string' ? node.url : pageUrl,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    validThrough: validThrough && !Number.isNaN(validThrough.getTime()) ? validThrough : undefined,
    raw: node,
  };
}

/**
 * Le HTML intérieur du bloc `itemprop="description"` (microdata schema.org).
 *
 * Le bloc contient des div imbriquées : une capture paresseuse jusqu'au
 * premier </div> s'arrête après ~13 caractères. La fin se trouve en suivant
 * la profondeur des div. Partagé avec SuccessFactors et Avature, dont les
 * pages portent le texte sous cette forme — et par le connecteur générique,
 * dont le JSON-LD est parfois vide de description (L'Oréal).
 */
export function microdataDescriptionHtml(html: string): string | undefined {
  const start = html.search(/itemprop="description"[^>]*>/i);
  if (start === -1) return undefined;
  const openTag = html.slice(start).match(/itemprop="description"[^>]*>/i)?.[0] ?? '';
  const from = start + openTag.length;
  let cursor = from;
  let end = html.length;
  let depth = 1;
  while (depth > 0 && cursor < html.length) {
    const next = html.slice(cursor).match(/<(\/?)div\b/i);
    if (!next || next.index === undefined) break;
    depth += next[1] ? -1 : 1;
    if (depth === 0) end = cursor + next.index;
    cursor += next.index + next[0].length;
  }
  // Les fins de ligne du HTML source (\r\n chez SAP) ne sont pas du texte :
  // gardées, elles empêchent les lignes vides de se replier ("\n\r\n\n\r\n").
  const inner = html.slice(from, end).replace(/\r/g, '');
  return inner.trim() ? inner : undefined;
}

/**
 * Le texte d'offre d'une page Next.js, dans `props.pageProps.description`.
 *
 * Mesuré le 2026-09-06 sur kering.com (1 427 pages du sitemap) : le JSON-LD
 * met dans `description` le portrait de la Maison (151–204 caractères, le
 * même sur chaque offre), et le texte du poste (2 329 caractères, avec
 * paragraphes et listes) n'est que dans `__NEXT_DATA__`.
 */
export function nextDataDescriptionHtml(html: string): string | undefined {
  const raw = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) return undefined;
  try {
    const description = JSON.parse(raw)?.props?.pageProps?.description;
    return typeof description === 'string' && description.trim() ? description : undefined;
  } catch {
    return undefined;
  }
}

/** Sous ce seuil, une « description » est un résumé, pas l'offre (le taux de couverture compte ≥ 200). */
const USABLE_DESCRIPTION = 200;

/**
 * La description la plus riche que la page porte, JSON-LD compris.
 *
 * Le JSON-LD n'est pas toujours l'endroit où vit le texte : L'Oréal (Avature)
 * n'y met que titre + datePosted et garde l'offre en microdata ; Kering y met
 * le portrait de la Maison et garde l'offre dans `__NEXT_DATA__`. Mesuré le
 * 2026-09-06 : 1 716 offres L'Oréal à 0 % de description, 1 427 Kering à 12 %.
 *
 * Le texte de page ne remplace le JSON-LD que quand celui-ci est inutilisable
 * (< 200 caractères) ou que la page porte au moins deux fois plus : un bloc
 * microdata étranger à l'offre (portrait d'entreprise) ne doit pas évincer un
 * JSON-LD complet.
 */
export function richestDescription(html: string, fromJsonLd?: string): string | undefined {
  const fromPage = [microdataDescriptionHtml(html), nextDataDescriptionHtml(html)]
    .map((fragment) => htmlToPlainText(fragment))
    .filter((text): text is string => !!text)
    .sort((a, b) => b.length - a.length)[0];
  if (!fromPage) return fromJsonLd;
  const current = fromJsonLd?.length ?? 0;
  if (current < USABLE_DESCRIPTION || fromPage.length >= 2 * current) return fromPage;
  return fromJsonLd;
}

/** Reads one job page and returns its first JobPosting, or null if none. */
export async function fetchJobFromPage(pageUrl: string): Promise<NormalizedJob | null> {
  const html = await fetchText(pageUrl, { headers: REQUEST_HEADERS });
  const [posting] = extractJobPostings(html);
  if (!posting) return null;
  const job = normalizeJobPosting(posting, pageUrl);
  if (!job) return null;
  const description = richestDescription(html, job.description);
  return description === job.description ? job : { ...job, description };
}
