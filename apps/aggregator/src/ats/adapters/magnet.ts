import { createHash } from 'node:crypto';
import { captureObservedAt } from '../../capture/context.js';
import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { CRAWLER_IDENTITY } from '../../lib/crawlerIdentity.js';

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
  CRAWLER_IDENTITY;

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
  publication_date?: string;
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


/**
 * L'identifiant CANONIQUE d'une offre Magnet — `id`, à défaut `reference`, et RIEN D'AUTRE.
 *
 * `normalizeMagnetOffer` retombe en dernier recours sur le TITRE. Un titre n'est pas une identité : deux
 * « Conseiller de vente F/H » partagent le même, et un titre réécrit change l'identifiant sans que
 * l'offre ait bougé. Une telle ligne est donc ANONYME pour la preuve d'absence — elle est observée et
 * publiée normalement, mais elle interdit de déclarer un identifiant historique disparu.
 */
export function magnetCanonicalId(offer: MagnetOffer): string | null {
  const id = offer.id ?? offer.reference;
  return id === undefined || id === null || String(id).trim() === '' ? null : String(id);
}

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
  const iso = captureObservedAt().toISOString();
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

export function normalizeMagnetOffer(offer: MagnetOffer, origin: string): NormalizedJob | null {
  if (!offer.title) return null;

  // A working apply link is mandatory — an offer a candidate cannot open is
  // worse than a missing row. The API always ships apply_link/link, so this
  // only drops a genuinely malformed offer, never a healthy one.
  const applyUrl = offer.apply_link || offer.link || offer.url;
  if (!applyUrl) return null;

  const locality = offer.localities?.[0];
  const publication = offer.publication_date ?? offer.published_at;
  const posted = publication ? new Date(publication) : undefined;

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
export async function fetchMagnetJobs(config: Record<string, unknown>): Promise<AdapterResult> {
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
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  const endpoint = `${API}/job-offers`;
  let declaredTotal: number | undefined;
  let rawCount = 0, anonymousRows = 0;
  let termination = 'PAGE_BUDGET_EXHAUSTED';

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const body = JSON.stringify({ ...EMPTY_FILTERS, limit: PAGE_SIZE, offset, sort: { date: 'desc' } });
    const response = await fetchJson<OffersResponse>(endpoint, { method: 'POST', headers, body });

    const list = response.data?.list ?? [];
    rawCount += list.length;
    const total = response.data?.total;
    if (total !== undefined) declaredTotal = total;

    /**
     * LE CONTRAT DES IDENTIFIANTS CANONIQUES.
     *
     * L'identifiant entre dans la preuve AVANT toute validation : une offre dotée d'un `id` a été
     * OBSERVÉE même si `normalizeMagnetOffer` la refuse ensuite faute de titre ou de lien de
     * candidature, et l'omettre ferait paraître ABSENTE au refresh suivant une JobSource historique
     * portant ce même identifiant.
     *
     * Ce que la preuve archive est exactement ce que l'adaptateur ÉCRIT en `externalId` — repli sur le
     * titre compris, sans quoi l'offre publiée manquerait à sa propre preuve. Mais un identifiant issu du
     * titre n'est pas une identité : il rend l'attestation d'absence inexploitable pour ce cycle.
     */
    const ids: string[] = [];
    for (const offer of list) {
      const canonical = magnetCanonicalId(offer);
      if (!canonical) anonymousRows++;
      const id = canonical ?? normalizeMagnetOffer(offer, origin)?.externalId;
      if (id) ids.push(id);
    }
    pageEvidence.push({ url: endpoint, checkedAt: captureObservedAt().toISOString(),
      sha256: createHash('sha256').update(JSON.stringify(response)).digest('hex'), offset,
      pagination: total === undefined ? null : { start: offset + 1, end: offset + list.length, total },
      ids, canonicalIds: ids, publisherCounter: total === undefined ? '' : String(total),
      componentCounters: [`rows=${list.length}`, `limit=${PAGE_SIZE}`] });

    let fresh = 0;
    for (const offer of list) {
      const job = normalizeMagnetOffer(offer, origin);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
      fresh++;
    }

    if (list.length < PAGE_SIZE || fresh === 0) { termination = list.length < PAGE_SIZE ? 'SHORT_PAGE' : 'NO_FRESH_ROWS'; break; }
    if (total !== undefined && jobs.length >= total) { termination = 'DECLARED_TOTAL_REACHED'; break; }
  }

  /**
   * Une offre VUE dont l'identifiant est connu mais qui n'a pas été publiée (titre ou lien de
   * candidature manquant, identifiant déjà rencontré) est nommée ici comme DISPOSITION : sans cela elle
   * resterait un trou dans la preuve, et son offre historique paraîtrait disparue.
   */
  const published = new Set(jobs.map((job) => job.externalId));
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [
    ...new Set(pageEvidence.flatMap((pe) => pe.canonicalIds ?? [])),
  ].filter((id) => !published.has(id)).map((id) => ({ reason: 'MISSING_TITLE_APPLY_LINK_OR_REPEATED_ID', raw: { id }, canonicalId: id }));

  return { jobs, declaredTotal, rejectedRows,
    enumeration: { method: 'AUTHENTICATED_PUBLIC_HANDSHAKE_OFFSET_PAGINATION', endpoint,
      pages: pageEvidence.length, rawCount, termination,
      // Une offre sans `id` ni `reference` n'est nommée que par son titre : ce n'est pas une identité,
      // donc aucun identifiant historique ne peut être déclaré absent pour ce cycle.
      canonicalAbsenceProofUsable: anonymousRows === 0, pageEvidence } };
}
