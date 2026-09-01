import { fetchJson } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

/**
 * Phenom People career sites.
 *
 * The biggest single win in the catalogue: Foot Locker, Primark, Pandora,
 * Rolex, Goyard and New Balance all run Phenom — roughly 5,000 offers behind
 * one adapter.
 *
 * Their pages are JS-rendered, which is why a JSON-LD parser reported zero, but
 * `/api/jobs` is public and returns everything: title, city, country,
 * description AND latitude/longitude, so these rows never need geocoding.
 *
 * Verified 2026-09-01 on careers.footlocker.com: 2814 jobs, 3.1k-character
 * descriptions, coordinates included.
 */

/**
 * The API honours `limit` (not `size`) and paginates with a 1-based `page`.
 * `offset`, `from` and `start` are all silently ignored — they return page one
 * every time, which looks like a board with only ten jobs.
 */
const PAGE_SIZE = 100;
/** Guard against a changed response shape paginating forever. */
const MAX_PAGES = Number(process.env.PHENOM_MAX_PAGES ?? 80);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = { 'user-agent': USER_AGENT, accept: 'application/json' };

type PhenomJobData = {
  slug?: string;
  req_id?: string;
  title?: string;
  description?: string;
  city?: string;
  state?: string;
  country?: string;
  country_code?: string;
  postal_code?: string;
  latitude?: number | string;
  longitude?: number | string;
  create_date?: string;
  posted_date?: string;
  applyUrl?: string;
  apply_url?: string;
  category?: string;
  employment_type?: string;
};

type PhenomResponse = {
  jobs?: Array<{ data?: PhenomJobData }>;
  totalCount?: number;
  count?: number;
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

function toNormalized(data: PhenomJobData, origin: string): NormalizedJob | null {
  if (!data.title) return null;

  const id = data.slug ?? data.req_id;
  const posted = data.create_date ?? data.posted_date;
  const postedAt = posted ? new Date(posted) : undefined;

  return {
    externalId: String(id ?? data.title),
    title: data.title,
    location: [data.city, data.state, data.postal_code].filter(Boolean).join(', ') || undefined,
    // country_code is ISO-2 ("FR"); country is the display name ("France").
    country: data.country_code ?? data.country,
    contract: data.employment_type,
    description: stripHtml(data.description),
    url: data.applyUrl ?? data.apply_url ?? `${origin}/job/${id ?? ''}`,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: data,
  };
}

/**
 * Reads a whole Phenom board.
 * `config.origin` is the careers host, e.g. "https://careers.footlocker.com".
 */
export async function fetchPhenomJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('Phenom origin missing');

  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetchJson<PhenomResponse>(
      `${origin}/api/jobs?limit=${PAGE_SIZE}&page=${page}`,
      { headers: HEADERS },
    );

    const batch = response.jobs ?? [];
    let fresh = 0;

    for (const entry of batch) {
      const job = entry.data ? toNormalized(entry.data, origin) : null;
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
      fresh++;
    }

    // A short page, or one that adds nothing new, is the end of the board.
    if (batch.length < PAGE_SIZE || fresh === 0) break;

    const total = response.totalCount ?? response.count;
    if (total !== undefined && jobs.length >= total) break;
  }

  return jobs;
}

/**
 * Coordinates Phenom already provides, so these rows skip geocoding entirely.
 * Returns null when the payload has none.
 */
export function phenomCoordinates(raw: unknown): { latitude: number; longitude: number } | null {
  const data = raw as PhenomJobData | undefined;
  const latitude = Number(data?.latitude);
  const longitude = Number(data?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}
