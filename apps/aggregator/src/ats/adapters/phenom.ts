import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import { employmentTermsFrom } from '../../normalize/contract.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

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
  /** schema.org value: "FULL_TIME" / "PART_TIME" — a working time, not a contract. */
  employment_type?: string;
  /** The employer as published ("Foot Locker") — never the catalogue line's fallback ("Foot Locker France" on 1 769 US posts, audit a4). */
  hiring_organization?: string;
  /** Tenant-configured: Foot Locker files the contract in tags2 ("Regular Part-Time") and the banner in tags4 ("Kids Foot Locker"). */
  tags1?: string[];
  tags2?: string[];
  tags3?: string[];
  tags4?: string[];
  tags5?: string[];
  tags6?: string[];
  tags7?: string[];
  tags8?: string[];
  tags9?: string[];
};

/** Every `tagsN` value, whatever the tenant filed there. */
function tagValues(data: PhenomJobData): unknown[] {
  return Object.entries(data)
    .filter(([key]) => /^tags\d+$/.test(key))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));
}

/**
 * The brand to credit the offer to.
 *
 * `config.brandTag` names the tag that carries the banner on tenants that have
 * one (Foot Locker: `tags4` = "Kids Foot Locker", "Champs Sports"…); it is
 * tenant-specific, so it is opt-in per catalogue line. Otherwise the employer
 * the API publishes — always better than the catalogue label.
 */
function brandOf(data: PhenomJobData, config: Record<string, unknown>): string | undefined {
  const tag = config.brandTag ? (data as Record<string, unknown>)[String(config.brandTag)] : undefined;
  const banner = Array.isArray(tag) ? tag[0] : tag;
  const brand = banner ? String(banner).trim() : '';
  return brand || data.hiring_organization?.trim() || undefined;
}

type PhenomResponse = {
  jobs?: Array<{ data?: PhenomJobData }>;
  totalCount?: number;
  count?: number;
};


/** One `/api/jobs` entry → one posting. Exported for tests (no network). */
export function parsePhenomJob(data: PhenomJobData, origin: string, config: Record<string, unknown> = {}): NormalizedJob | null {
  if (!data.title) return null;

  const id = data.slug ?? data.req_id;
  const posted = data.create_date ?? data.posted_date;
  const postedAt = posted ? new Date(posted) : undefined;
  // employment_type is a working time; the contract, when the tenant publishes
  // it, sits in a tag ("Regular Part-Time"). Only values naming a term are kept.
  const terms = employmentTermsFrom([data.employment_type, ...tagValues(data)]);

  return {
    externalId: String(id ?? data.title),
    title: data.title,
    location: [data.city, data.state, data.postal_code].filter(Boolean).join(', ') || undefined,
    // country_code is ISO-2 ("FR"); country is the display name ("France").
    country: data.country_code ?? data.country,
    contract: terms,
    workingTime: terms,
    company: brandOf(data, config),
    city: data.city,
    region: data.state,
    postalCode: data.postal_code,
    // Phenom ships coordinates, so these rows skip geocoding.
    latitude: Number.isFinite(Number(data.latitude)) ? Number(data.latitude) : undefined,
    longitude: Number.isFinite(Number(data.longitude)) ? Number(data.longitude) : undefined,
    description: htmlToPlainText(data.description),
    // Phenom livre `apply_url` = l'étape de CONNEXION iCIMS (`/jobs/<id>/login`,
    // 2 842/2 842 liens Foot Locker sur une page de login) ; la fiche publique est
    // `/jobs/<id>/job` (audit A5, 2026-09-06).
    url: publicJobUrl(data.applyUrl ?? data.apply_url ?? `${origin}/job/${id ?? ''}`),
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: data,
  };
}

/** La fiche publique, jamais l'étape de connexion iCIMS que Phenom met dans apply_url (`/jobs/<id>/login` → `/jobs/<id>/job`). */
export function publicJobUrl(url: string): string {
  return url.replace(/(\/jobs\/[^/?#]+)\/login(?=[/?#]|$)/, '$1/job');
}

/**
 * Reads a whole Phenom board.
 * `config.origin` is the careers host, e.g. "https://careers.footlocker.com".
 */
export async function fetchPhenomJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('Phenom origin missing');

  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  let declaredTotal: number | undefined;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetchJson<PhenomResponse>(
      `${origin}/api/jobs?limit=${PAGE_SIZE}&page=${page}`,
      { headers: HEADERS },
    );

    const batch = response.jobs ?? [];
    let fresh = 0;

    for (const entry of batch) {
      const job = entry.data ? parsePhenomJob(entry.data, origin, config) : null;
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
      fresh++;
    }

    const total = response.totalCount ?? response.count;
    if (total !== undefined) declaredTotal = total;

    // A short page, or one that adds nothing new, is the end of the board.
    if (batch.length < PAGE_SIZE || fresh === 0) break;
    if (total !== undefined && jobs.length >= total) break;
  }

  return { jobs, declaredTotal };
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
