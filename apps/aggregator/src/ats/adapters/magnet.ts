import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { NormalizedJob } from '../../types.js';

/**
 * Magnet (api.magnet.work) career sites — Groupe Beaumanoir (Cache Cache,
 * Bonobo, Morgan, BZB) and others.
 *
 * The discovery pass had labelled this "gestmax", which was wrong: capturing the
 * XHR shows api.magnet.work. Worth noting as a method point — vendor guesses
 * from page markup are unreliable, the network calls are not.
 *
 * Access is a two-step public handshake, all client-side:
 *   1. POST /v2/security/login with { usr, pass } where `usr` is the site's own
 *      public key and `pass` is the CURRENT timestamp, both base64-encoded
 *   2. POST /v2/job-offers with the returned Bearer token
 *
 * Two traps: the timestamp must be fresh (a stale one is rejected), and the
 * request body must carry EVERY filter array — omitting any returns 400
 * "body should have required property 'skills'" and so on.
 *
 * Verified 2026-09-01 on Beaumanoir: total 408, each entry carrying
 * mission_description, profile_description and company_description.
 */

const API = 'https://api.magnet.work/v2';
const PAGE_SIZE = 100;
/** Guard against a changed response shape paginating forever. */
const MAX_PAGES = Number(process.env.MAGNET_MAX_PAGES ?? 40);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Every filter array is mandatory; a missing one is a 400, not a default. */
const EMPTY_FILTERS = {
  jobs: [],
  skills: [],
  trainings: [],
  hobbies: [],
  cities: [],
  departments: [],
  regions: [],
  countries: [],
  contracts: [],
  job_sectors: [],
  remote_work_types: [],
};

type LoginResponse = { data?: { token?: string }; token?: string };

type MagnetOffer = {
  id?: number | string;
  reference?: string;
  title?: string;
  company?: string;
  brand?: string;
  /** Location lives here, not in a `city` field — with coordinates. */
  localities?: Array<{
    country?: string;
    coordinates?: string;
    city_label?: string;
    department_label?: string;
    region_label?: string;
  }>;
  contract?: { name?: string } | string;
  published_at?: string;
  url?: string;
  /**
   * The real, working links the API ships. `apply_link`/`link` are canonical
   * redirect URLs (api.magnet.work/v2/redirect/... -> the live offer), verified
   * 200. There is NO `url` field: building `/offre/{id}` from the internal id
   * instead produced a 404 on every Magnet offer (the id is `10955-<base64>`,
   * not a path segment). Prefer these over any constructed URL.
   */
  link?: string;
  apply_link?: string;
  mission_description?: string;
  profile_description?: string;
  company_description?: string;
};

type OffersResponse = {
  data?: { total?: number; list?: MagnetOffer[] };
};


/** Magnet writes coordinates as a single "lat,lon" string. */
function parseCoordinates(value?: string): { latitude?: number; longitude?: number } {
  const [lat, lon] = (value ?? '').split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return {};
  return { latitude: lat, longitude: lon };
}

function nameOf(value: { name?: string } | string | undefined): string | undefined {
  if (!value) return undefined;
  return typeof value === 'string' ? value : value.name;
}

/** base64 of the current instant, in the exact shape the API expects. */
function timestampPassword(): string {
  const iso = new Date().toISOString();
  return Buffer.from(iso).toString('base64');
}

async function login(siteKey: string, origin: string): Promise<string> {
  const response = await fetchJson<LoginResponse>(`${API}/security/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
      referer: origin,
    },
    body: JSON.stringify({
      usr: Buffer.from(siteKey).toString('base64'),
      pass: timestampPassword(),
    }),
  });

  const token = response.data?.token ?? response.token;
  if (!token) throw new Error('Magnet login returned no token');
  return token;
}

function toNormalized(offer: MagnetOffer, origin: string): NormalizedJob | null {
  if (!offer.title) return null;

  // A working apply link is mandatory — an offer a candidate cannot open is
  // worse than a missing row. The API always ships apply_link/link, so this
  // only drops a genuinely malformed offer, never a healthy one.
  const applyUrl = offer.apply_link || offer.link || offer.url;
  if (!applyUrl) return null;

  const locality = offer.localities?.[0];
  const posted = offer.published_at ? new Date(offer.published_at) : undefined;

  // The posting is split across three blocks; a candidate reads them in order.
  const description = [offer.mission_description, offer.profile_description]
    .map((part) => htmlToPlainText(part))
    .filter(Boolean)
    .join('\n\n');

  return {
    externalId: String(offer.id ?? offer.reference ?? offer.title),
    title: offer.title,
    location:
      [locality?.city_label, locality?.department_label].filter(Boolean).join(', ') || undefined,
    country: locality?.country,
    city: locality?.city_label,
    region: locality?.department_label,
    // Magnet ships "lat,lon" — these rows skip geocoding.
    ...parseCoordinates(locality?.coordinates),
    contract: nameOf(offer.contract),
    // Beaumanoir's feed carries the enseigne per offer (Cache Cache, Bonobo,
    // Morgan) — credit it, not the group (audit A-01, D11).
    company: offer.brand ?? offer.company,
    description: description || undefined,
    // The API's own links, in preference order — all verified to resolve. NEVER
    // fall back to `/offre/{id}`: the id is `10955-<base64>`, not a URL path, so
    // that produced a 404 on every Magnet offer (Groupe Eram, ETAM, Beaumanoir…).
    url: applyUrl,
    postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : undefined,
    raw: offer,
  };
}

/**
 * Reads a whole Magnet board.
 * `config.siteKey` is the site's public key (32 hex chars, from its own login
 * call); `config.origin` is the careers host used as Referer.
 */
export async function fetchMagnetJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const siteKey = String(config.siteKey ?? '');
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!siteKey) throw new Error('Magnet siteKey missing');

  const token = await login(siteKey, origin);
  const headers = {
    'content-type': 'application/json',
    'user-agent': USER_AGENT,
    authorization: `Bearer ${token}`,
    referer: origin,
  };

  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetchJson<OffersResponse>(`${API}/job-offers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...EMPTY_FILTERS,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        sort: { date: 'desc' },
      }),
    });

    const list = response.data?.list ?? [];
    let fresh = 0;

    for (const offer of list) {
      const job = toNormalized(offer, origin);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
      fresh++;
    }

    if (list.length < PAGE_SIZE || fresh === 0) break;
    const total = response.data?.total;
    if (total !== undefined && jobs.length >= total) break;
  }

  return jobs;
}
