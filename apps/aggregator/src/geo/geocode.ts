import { fetchJson } from '../lib/http.js';
import { normalizeLocationString } from '../normalize/location.js';

/**
 * Geocoding against the French government's Adresse API.
 *
 * Sources give a city and usually a postcode, never coordinates — so the Leaflet
 * map needs a resolution step. api-adresse.data.gouv.fr is free, needs no key,
 * allows 50 req/s per IP and is rebuilt twice weekly from BAN data.
 *
 * Verified 2026-09-01: "78100" -> Saint-Germain-en-Laye, [2.111227, 48.923869],
 * INSEE 78551.
 *
 * Lookups are cached by city, not by offer: the same towns repeat across
 * thousands of postings, so per-offer calls would be pure waste.
 */

const ENDPOINT = 'https://api-adresse.data.gouv.fr/search/';

/** Kept well under the documented 50 req/s so we never trip the 429. */
const REQUESTS_PER_SECOND = Number(process.env.GEOCODE_RPS ?? 10);

/**
 * Ceiling per run, so a first pass over a large backlog never blocks the cron.
 * Anything left over is picked up by the next run — the cache makes it cumulative.
 *
 * Sizing, measured on real feeds rather than assumed: the unit of work is the
 * DISTINCT CITY, not the offer. Richemont posts 228 French jobs across 11 towns;
 * Sephora 154 across 49; together 382 jobs across 56 towns — because 4 towns
 * (Paris, Cannes, Lyon, Lille) already overlapped. The ratio climbs from 3.1 to
 * 6.8 jobs per town as sources are added, since fashion hiring concentrates in a
 * few hundred places out of ~35,000 French communes. So 50,000 offers do not mean
 * 50,000 lookups: even a pessimistic 3,000 distinct towns is ~5 minutes once, then
 * only genuinely new towns each day.
 */
const MAX_LOOKUPS_PER_RUN = Number(process.env.GEOCODE_MAX_PER_RUN ?? 2000);

/**
 * Minimum Adresse-API confidence accepted when no postcode narrows the search.
 * Below this the answer is a loose name match rather than the real town.
 */
const MIN_MATCH_SCORE = Number(process.env.GEOCODE_MIN_SCORE ?? 0.6);

export type GeoPoint = {
  city?: string;
  postalCode?: string;
  /** INSEE commune code — a stable join key, unlike a city name. */
  inseeCode?: string;
  latitude: number;
  longitude: number;
};

type AdresseFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    label?: string;
    city?: string;
    postcode?: string;
    citycode?: string;
    score?: number;
  };
};

type AdresseResponse = { features?: AdresseFeature[] };

/**
 * Stable cache key for a raw location string.
 *
 * Keyed on the city plus the DEPARTMENT (the postcode's first two digits), not
 * the full postcode: "PARIS 75008" and "PARIS" are one commune and must share a
 * cache entry, while the department still separates true homonyms such as
 * Saint-Germain in 78 from another in 86.
 */
export function geoCacheKey(rawLocation: string): string {
  const { city } = normalizeLocationString(rawLocation);
  const department = rawLocation.match(/\b(\d{5})\b/)?.[1]?.slice(0, 2);
  const base = city ?? rawLocation.trim().toUpperCase();
  if (!base) return '';
  return department ? `${department}|${base}` : base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves one location. Returns null when the API finds nothing — the caller
 * should cache that too, so a bad string is not retried on every run.
 */
export async function geocodeLocation(rawLocation: string): Promise<GeoPoint | null> {
  const { city } = normalizeLocationString(rawLocation);
  const postcode = rawLocation.match(/\b(\d{5})\b/)?.[1];
  const query = [city, postcode].filter(Boolean).join(' ').trim();
  if (!query) return null;

  const url = new URL(ENDPOINT);
  url.searchParams.set('q', query);
  // `municipality` keeps results at town level: we plot cities, not doorways.
  url.searchParams.set('type', 'municipality');
  url.searchParams.set('limit', '1');
  // A postcode pins the department, which is what stops a fuzzy name match from
  // landing in the wrong region.
  if (postcode) url.searchParams.set('postcode', postcode);

  const data = await fetchJson<AdresseResponse>(url.toString());
  const feature = data.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  if (!feature || !coordinates) return null;

  /**
   * Reject weak matches. Without this the API happily answers "MARNE LA VALLEE"
   * with "La Vallée" in Charente-Maritime — 500 km from the real place, and the
   * offer would be plotted in the wrong part of France. A missing pin beats a
   * confidently wrong one.
   */
  const score = feature.properties?.score ?? 0;
  if (!postcode && score < MIN_MATCH_SCORE) return null;

  // GeoJSON orders coordinates [lon, lat]; Leaflet expects [lat, lon].
  const [longitude, latitude] = coordinates;
  return {
    city: feature.properties?.city ?? feature.properties?.label,
    postalCode: feature.properties?.postcode ?? postcode,
    inseeCode: feature.properties?.citycode,
    latitude,
    longitude,
  };
}

export type GeocodeBatch = {
  results: Map<string, GeoPoint | null>;
  /** Distinct locations left for the next run once the ceiling was reached. */
  remaining: number;
};

/**
 * Resolves many distinct locations, deduplicated and rate-limited, stopping at
 * MAX_LOOKUPS_PER_RUN. A failed lookup maps to null so callers can persist the
 * negative result and avoid retrying a bad string forever.
 */
export async function geocodeMany(
  rawLocations: readonly string[],
): Promise<GeocodeBatch> {
  const byKey = new Map<string, string>();
  for (const raw of rawLocations) {
    const key = geoCacheKey(raw);
    if (key && !byKey.has(key)) byKey.set(key, raw);
  }

  const results = new Map<string, GeoPoint | null>();
  const delayMs = Math.ceil(1000 / REQUESTS_PER_SECOND);
  const queue = [...byKey.entries()];
  const batch = queue.slice(0, MAX_LOOKUPS_PER_RUN);

  for (const [key, raw] of batch) {
    try {
      results.set(key, await geocodeLocation(raw));
    } catch {
      // A transient failure must not be cached as "no such place".
      results.set(key, null);
    }
    await sleep(delayMs);
  }

  return { results, remaining: queue.length - batch.length };
}
