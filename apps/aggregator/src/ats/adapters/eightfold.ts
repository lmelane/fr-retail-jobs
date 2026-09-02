import pLimit from 'p-limit';
import { fetchJson, fetchWithRetry } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

/**
 * Eightfold AI career sites (Estée Lauder and its Maisons).
 *
 * Its `/api/pcsx/` endpoints are explicitly allowed by robots.txt —
 * `Disallow: /` with `Allow: /careers`, `Allow: /api/apply`, `Allow: /api/pcsx`
 * — so this is the route the site itself invites.
 *
 * Two things cost time to find and are worth recording: the older
 * /api/apply/v2/jobs path 403s regardless of headers, and /api/pcsx/search needs
 * a session cookie from the careers page first (a bare request 403s in a way
 * that reads like a blocked endpoint rather than a missing cookie).
 *
 * Verified 2026-09-01 on careers.elcompanies.com: count 1400, positions carrying
 * id, name, locations and postedTs. The listing has no description, so
 * /api/pcsx/position_details supplies it per offer.
 */

/**
 * The API pins its page to 10 regardless of `num`, `size` or `pageSize`; only
 * `start` advances. So a 1400-offer board is 140 requests — small pages, but the
 * only shape it offers.
 */
const PAGE_SIZE = 10;
const MAX_PAGES = Number(process.env.EIGHTFOLD_MAX_PAGES ?? 300);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

type EightfoldPosition = {
  id?: number | string;
  displayJobId?: string;
  name?: string;
  locations?: string[];
  standardizedLocations?: Array<{ city?: string; country?: string }>;
  postedTs?: number;
  positionUrl?: string;
  department?: string;
};

type SearchResponse = {
  data?: { positions?: EightfoldPosition[]; count?: number };
};

type DetailResponse = {
  data?: { job_description?: string; positionUrl?: string };
};

function stripHtml(value?: string): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(?:lt|gt|quot|#39);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

/** The search endpoint needs a session cookie issued by the careers page. */
async function openSession(origin: string): Promise<string> {
  const response = await fetchWithRetry(`${origin}/careers`, {
    headers: { 'user-agent': USER_AGENT },
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

function toNormalized(position: EightfoldPosition, origin: string): NormalizedJob | null {
  if (!position.name) return null;

  const standardized = position.standardizedLocations?.[0];
  const postedAt = position.postedTs ? new Date(position.postedTs * 1000) : undefined;

  // positionUrl is RELATIVE ("/careers/job/123"): stored as-is it is not a
  // fetchable URL, so every Eightfold apply link (Estée Lauder, Dr. Jart+…) was
  // a dead relative path. Resolve it against the origin; verified 200.
  const positionUrl = position.positionUrl
    ? new URL(position.positionUrl, `${origin}/`).toString()
    : `${origin}/careers?pid=${position.id ?? ''}`;

  return {
    externalId: String(position.id ?? position.displayJobId ?? position.name),
    title: position.name,
    location: standardized?.city ?? position.locations?.[0],
    country: standardized?.country,
    url: positionUrl,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: position,
  };
}

/**
 * Reads a whole Eightfold board.
 * `config.origin` e.g. "https://careers.elcompanies.com".
 * `config.domain` e.g. "elcompanies.com".
 */
export async function fetchEightfoldJobs(
  config: Record<string, unknown>,
): Promise<NormalizedJob[]> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  const domain = String(config.domain ?? origin.replace(/^https?:\/\/careers\./, ''));
  if (!origin) throw new Error('Eightfold origin missing');

  const cookie = await openSession(origin);
  const headers = {
    'user-agent': USER_AGENT,
    accept: 'application/json',
    referer: `${origin}/careers`,
    ...(cookie ? { cookie } : {}),
  };

  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${origin}/api/pcsx/search?domain=${encodeURIComponent(domain)}&query=&location=&start=${page * PAGE_SIZE}&num=${PAGE_SIZE}`;
    const response = await fetchJson<SearchResponse>(url, { headers });

    const positions = response.data?.positions ?? [];
    let fresh = 0;

    for (const position of positions) {
      const job = toNormalized(position, origin);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
      fresh++;
    }

    if (positions.length < PAGE_SIZE || fresh === 0) break;
    const count = response.data?.count;
    if (count !== undefined && jobs.length >= count) break;
  }

  if (config.withDescriptions === false) return jobs;

  // Descriptions come from a per-position endpoint; the listing has none.
  const limit = pLimit(Number(config.detailConcurrency ?? 6));
  return Promise.all(
    jobs.map((job) =>
      limit(async () => {
        try {
          const detail = await fetchJson<DetailResponse>(
            `${origin}/api/pcsx/position_details?position_id=${encodeURIComponent(job.externalId)}&domain=${encodeURIComponent(domain)}&hl=fr`,
            { headers },
          );
          return { ...job, description: stripHtml(detail.data?.job_description) };
        } catch {
          // A failed detail fetch must not lose the listing entry.
          return job;
        }
      }),
    ),
  );
}
