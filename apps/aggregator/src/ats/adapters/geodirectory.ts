import { fetchWithRetry } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * WordPress + GeoDirectory — sites carrière qui publient chaque offre comme un
 * lieu (`gd_place`) du plugin GeoDirectory.
 *
 * Beauty Success (recrutement.beautysuccess.fr) : la route `/wp/v2/offres`
 * annoncée par `/wp/v2/types` répond 404, mais le plugin expose la sienne,
 * `/wp-json/geodir/v2/offres`, avec `x-wp-total` / `x-wp-totalpages` et des
 * champs de lieu STRUCTURÉS (city, region, country, zip, latitude, longitude)
 * que ni la page HTML (aucun JSON-LD) ni le flux RSS (10 items) ne donnent.
 * Mesuré le 2026-09-06 : 109 offres en 2 appels, 109 avec lieu et description.
 */

const PAGE_SIZE = 100;
const MAX_PAGES = 40;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export type GeoDirPost = {
  id?: number | string;
  link?: string;
  date?: string;
  /** Heure UTC ; `date` est en heure locale du site, sans fuseau. */
  date_gmt?: string;
  title?: { rendered?: string };
  content?: { raw?: string; rendered?: string };
  city?: string;
  region?: string;
  country?: string;
  zip?: string;
  latitude?: string | number;
  longitude?: string | number;
  /** Champs personnalisés de Beauty Success ; absents ailleurs, donc optionnels. */
  type_de_contrat?: { rendered?: string };
  temps_de_travail?: { rendered?: string };
  description_de_lemployeur?: string;
  profil_recherch?: string;
};

function coordinate(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

/** Un post GeoDirectory -> une offre. Pure, testable sans réseau. */
export function normalizeGeoDirPost(post: GeoDirPost): NormalizedJob | null {
  const title = htmlToPlainText(post.title?.rendered);
  if (!title || !post.link) return null;

  const dateRaw = post.date_gmt ? `${post.date_gmt}Z` : post.date;
  const postedAt = dateRaw ? new Date(dateRaw) : undefined;
  const description = htmlToPlainText(
    [post.content?.rendered ?? post.content?.raw, post.description_de_lemployeur, post.profil_recherch]
      .filter(Boolean)
      .join('\n'),
  );
  const location = [post.city, post.zip, post.country].filter(Boolean).join(', ');

  return {
    externalId: String(post.id ?? post.link),
    title,
    location: location || undefined,
    city: post.city || undefined,
    postalCode: post.zip || undefined,
    region: post.region || undefined,
    country: post.country || undefined,
    latitude: coordinate(post.latitude),
    longitude: coordinate(post.longitude),
    contract: post.type_de_contrat?.rendered || undefined,
    workingTime: post.temps_de_travail?.rendered || undefined,
    description: description || undefined,
    url: post.link,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: post,
  };
}

/**
 * `config.origin` : le site, ex. "https://recrutement.beautysuccess.fr".
 * `config.restBase` : la base REST du type d'offre (défaut "offres" — lue dans
 * `/wp-json/wp/v2/types` → `rest_base` du type `gd_place`).
 */
export async function fetchGeoDirectoryJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('GeoDirectory origin required');
  const restBase = String(config.restBase ?? 'offres');

  const jobs: NormalizedJob[] = [];
  let declaredTotal: number | undefined;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await fetchWithRetry(
      `${origin}/wp-json/geodir/v2/${restBase}?per_page=${PAGE_SIZE}&page=${page}`,
      { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } },
    );
    // Même précaution que l'adaptateur WordPress : un BOM en tête casse JSON.parse.
    const text = (await response.text()).replace(/^﻿/, '');
    const posts = JSON.parse(text) as GeoDirPost[];
    if (!Array.isArray(posts) || posts.length === 0) break;

    const total = Number(response.headers.get('x-wp-total'));
    if (Number.isFinite(total)) declaredTotal = total;

    for (const post of posts) {
      const job = normalizeGeoDirPost(post);
      if (job) jobs.push(job);
    }

    const totalPages = Number(response.headers.get('x-wp-totalpages'));
    if (Number.isFinite(totalPages) && page >= totalPages) break;
  }

  return {
    jobs,
    declaredTotal,
    truncated: declaredTotal !== undefined && jobs.length < declaredTotal,
  };
}
