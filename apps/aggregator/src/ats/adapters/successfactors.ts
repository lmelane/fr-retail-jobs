import pLimit from 'p-limit';
import { fetchText } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

/**
 * SAP SuccessFactors (RMK) career sites.
 *
 * Widely used across the sector: Puig, Sephora, Goyard, Douglas, The Body Shop,
 * Petit Bateau. It has no JSON API, but its search page is SERVER-rendered —
 * which is why a JSON-LD parser found nothing on Puig and reported zero offers.
 *
 * Verified 2026-09-01 on jobs.puig.com: the search page returns 25 job links per
 * page with `startrow=` pagination, so the whole board is reachable over plain
 * HTTP without a browser.
 *
 * Detail pages carry the posting as MICRODATA, not JSON-LD — schema.org/JobPosting
 * on a div with itemprop="description" inside. Verified by capturing every XHR on
 * a Puig job page: nothing but analytics, so the content is server-rendered and a
 * JSON-LD-only parser silently finds nothing.
 */

const PAGE_SIZE = 25;
/** Guard against a mis-parsed listing paginating forever. */
const MAX_PAGES = Number(process.env.SF_MAX_PAGES ?? 60);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = { 'user-agent': USER_AGENT };

/**
 * Job links look like /job/{City}-{Title}/{id}/ — the city and title are already
 * in the path, which is enough to build the listing without a detail fetch.
 */
const JOB_LINK = /href="(\/job\/([^"/]+)\/(\d+)\/?)"/g;

export type SuccessFactorsJob = {
  url: string;
  externalId: string;
  /** Raw "City-Job-Title" segment, still URL-encoded. */
  slug: string;
};

export function parseListing(html: string, origin: string): SuccessFactorsJob[] {
  const seen = new Map<string, SuccessFactorsJob>();
  for (const match of html.matchAll(JOB_LINK)) {
    const [, path, slug, id] = match;
    if (!seen.has(id)) {
      seen.set(id, { url: `${origin}${path}`, externalId: id, slug });
    }
  }
  return [...seen.values()];
}

/** "PARIS-Social-Media-Coordinator" -> { city: "PARIS", title: "Social Media Coordinator" } */
export function splitSlug(slug: string): { city?: string; title: string } {
  const decoded = decodeURIComponent(slug).replace(/-/g, ' ').trim();
  const parts = decoded.split(' ');
  // The leading token(s) are the city; SuccessFactors writes it in caps when it
  // is a single word, which is the only reliable separator available here.
  const cityWords: string[] = [];
  for (const part of parts) {
    if (part === part.toUpperCase() && /[A-ZÀ-Ý]/.test(part)) cityWords.push(part);
    else break;
  }
  const title = parts.slice(cityWords.length).join(' ').trim();
  return {
    city: cityWords.length ? cityWords.join(' ') : undefined,
    title: title || decoded,
  };
}

/**
 * Reads a whole SuccessFactors board.
 * `config.origin` is the careers host, e.g. "https://jobs.puig.com".
 */
export async function fetchSuccessFactorsJobs(
  config: Record<string, unknown>,
): Promise<NormalizedJob[]> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('SuccessFactors origin missing');

  const jobs: NormalizedJob[] = [];
  const seenIds = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${origin}/search/?createNewAlert=false&q=&locationsearch=&startrow=${page * PAGE_SIZE}`;
    const html = await fetchText(url, { headers: HEADERS });
    const listing = parseListing(html, origin);

    // An empty page, or one that repeats what we already have, is the end.
    const fresh = listing.filter((job) => !seenIds.has(job.externalId));
    if (fresh.length === 0) break;

    for (const job of fresh) {
      seenIds.add(job.externalId);
      const { city, title } = splitSlug(job.slug);
      jobs.push({
        externalId: job.externalId,
        title,
        location: city,
        // The listing does not carry a country; France detection falls back to
        // the city, which is what the location normaliser already handles.
        url: job.url,
        raw: { slug: job.slug, source: 'successfactors' },
      });
    }
  }

  if (config.withDescriptions === false) return jobs;
  return attachSuccessFactorsDescriptions(jobs, Number(config.detailConcurrency ?? 8));
}

/**
 * Microdata, not JSON-LD: the text sits in itemprop="description".
 *
 * The block contains nested divs, so a lazy match up to the first </div> stops
 * after ~13 characters. The end is found by walking div depth instead.
 */
export function parseMicrodataDescription(html: string): string | undefined {
  const start = html.search(/itemprop="description"[^>]*>/i);
  if (start === -1) return undefined;

  const openTag = html.slice(start).match(/itemprop="description"[^>]*>/i)?.[0] ?? '';
  let cursor = start + openTag.length;
  let depth = 1;

  while (depth > 0 && cursor < html.length) {
    const next = html.slice(cursor).match(/<(\/?)div\b/i);
    if (!next || next.index === undefined) break;
    depth += next[1] ? -1 : 1;
    cursor += next.index + next[0].length;
  }

  const match = [undefined, html.slice(start + openTag.length, cursor)] as const;
  const text = match[1]
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(?:lt|gt|quot|#39);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

/** Fills in descriptions from each posting's detail page. */
export async function attachSuccessFactorsDescriptions(
  jobs: NormalizedJob[],
  concurrency = 8,
): Promise<NormalizedJob[]> {
  const limit = pLimit(concurrency);

  return Promise.all(
    jobs.map((job) =>
      limit(async () => {
        try {
          const html = await fetchText(job.url, { headers: HEADERS });
          const description = parseMicrodataDescription(html);
          return description ? { ...job, description } : job;
        } catch {
          // A failed detail fetch must not lose the listing entry.
          return job;
        }
      }),
    ),
  );
}
