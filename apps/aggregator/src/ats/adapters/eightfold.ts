import { log } from '../../observability/logger.js';
import pLimit from 'p-limit';
import { fetchJson, fetchWithRetry } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import { employmentTermsFrom, readEmployment } from '../../normalize/employment.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

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
  /** The tenant's own label: "Bogota,CO-DC,Colombia", "Paris, France". */
  locations?: string[];
  /**
   * Live tenants (ELC, Kering) send STRINGS — "Bogotá, Bogota, CO", "England,GB"
   * — the ISO-2 country last. Read as objects, the country was lost on
   * 1 469/1 470 Estée Lauder offers (audit a4). The object form is kept for
   * tenants that still send it.
   */
  standardizedLocations?: Array<string | { city?: string; country?: string }>;
  postedTs?: number;
  positionUrl?: string;
  department?: string;
};

type SearchResponse = {
  data?: { positions?: EightfoldPosition[]; count?: number };
};

type DetailResponse = {
  data?: {
    /** The live API answers camelCase; older tenants snake_case. Read both. */
    jobDescription?: string;
    job_description?: string;
    positionUrl?: string;
    /**
     * Tenant-custom brand field — the Maison this offer belongs to. Verified
     * live on careers.elcompanies.com: efcustomTextBrand = ["Le Labo"].
     * Without it every ELC offer inherits the catalogue label (audit A-01).
     */
    efcustomTextBrand?: string[] | string;
    /** Kering's Maison field — verified live 2026-09-06: efcustomTextHouse = ["Bottega Veneta"]. */
    efcustomTextHouse?: string[] | string;
    brand?: string[] | string;
    business_unit?: string[] | string;
    /** ELC: "Fulltime-Regular" / "Fulltime-Temporary" — contract AND working time in one word. */
    efcustomTextAssignmentcat?: string[] | string;
    /** Kering: "Regular" / "Fixed Term". */
    efcustomTextWorkerSubtype?: string[] | string;
    custom_JD?: { data_fields?: { assignmentcat?: string[] | string } };
  };
};

/** First non-empty brand value, whatever shape the tenant uses. */
function brandOf(data: DetailResponse['data']): string | undefined {
  for (const value of [data?.efcustomTextBrand, data?.efcustomTextHouse, data?.brand, data?.business_unit]) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first && String(first).trim()) return String(first).trim();
  }
  return undefined;
}

/** The contract / working-time words the tenant publishes on the detail (l2). */
function termsOf(data: DetailResponse['data']): string | undefined {
  return employmentTermsFrom([
    data?.efcustomTextAssignmentcat,
    data?.efcustomTextWorkerSubtype,
    data?.custom_JD?.data_fields?.assignmentcat,
  ]);
}

/**
 * Where the offer is, from the two location fields the search returns.
 *
 * Verified live 2026-09-06 — ELC: locations ["London,GB-LND,United Kingdom"],
 * standardizedLocations ["England,GB"]; Kering: ["Paris, France"] /
 * ["Paris, IDF, FR"]. The ISO country is the LAST token of the standardized
 * string; the city is the FIRST token of the tenant's own label (the
 * standardized one can stop at the region, "England"). Exported for tests.
 */
export function placeFromEightfold(position: EightfoldPosition): { location?: string; city?: string; country?: string } {
  const split = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
  const rawParts = position.locations?.[0] ? split(position.locations[0]) : [];
  const standardized = position.standardizedLocations?.[0];

  if (standardized && typeof standardized === 'object') {
    return {
      location: rawParts.join(', ') || standardized.city,
      city: rawParts[0] ?? standardized.city,
      country: standardized.country,
    };
  }

  const stdParts = typeof standardized === 'string' ? split(standardized) : [];
  const last = stdParts.at(-1);
  const country = last && /^[A-Z]{2}$/.test(last) ? last : rawParts.length > 1 ? rawParts.at(-1) : undefined;
  return {
    location: rawParts.join(', ') || stdParts.join(', ') || undefined,
    city: rawParts[0] ?? (stdParts.length >= 3 ? stdParts[0] : undefined),
    country,
  };
}


/**
 * Best-effort session cookie from the careers page. It is NOT required — the
 * /api/pcsx/search endpoint answers 200 without a cookie (verified). So a failure
 * here (a 405/throttle, common when several brands share one tenant like ELC's
 * careers.elcompanies.com hit 6×/run) must NOT sink the whole source: return an
 * empty cookie and let the search run. Before this, one throttled brand (origins)
 * failed the entire feed while its siblings succeeded.
 */
async function openSession(origin: string): Promise<string> {
  try {
    const response = await fetchWithRetry(`${origin}/careers`, {
      headers: { 'user-agent': USER_AGENT },
    });
    const cookies = response.headers.getSetCookie?.() ?? [];
    await response.body?.cancel();
    return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  } catch (error) {
    await log.warn('adapter.incomplete', `[eightfold] session cookie unavailable for ${origin} (${error instanceof Error ? error.message : error}); continuing without it`);
    return '';
  }
}

function toNormalized(position: EightfoldPosition, origin: string): NormalizedJob | null {
  if (!position.name) return null;

  const place = placeFromEightfold(position);
  const postedAt = position.postedTs ? new Date(position.postedTs * 1000) : undefined;

  // positionUrl is RELATIVE ("/careers/job/123"): stored as-is it is not a
  // fetchable URL, so every Eightfold apply link (Estée Lauder, Dr. Jart+…) was
  // a dead relative path. Resolve it against the origin; verified 200.
  /**
   * L'URL est construite depuis l'id de LA position, jamais reprise de
   * `positionUrl` : sur la liste `positions`, Eightfold y met l'URL canonique
   * du GROUPE de positions similaires — 125 offres Estée Lauder envoyaient le
   * candidat sur une autre position (autre ville, autre contrat), promesse D18
   * rompue (audit A1, 2026-09-06). Vérifié : `/careers/job/<id>` → 200.
   */
  const positionUrl = position.id
    ? `${origin}/careers/job/${position.id}`
    : position.positionUrl
      ? new URL(position.positionUrl, `${origin}/`).toString()
      : `${origin}/careers?pid=`;

  return {
    externalId: String(position.id ?? position.displayJobId ?? position.name),
    title: position.name,
    ...place,
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
): Promise<AdapterResult> {
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
  // F-04: the vendor's own announced count — the truncation signal.
  let declaredTotal: number | undefined;

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

    const count = response.data?.count;
    if (count !== undefined) declaredTotal = count;
    if (positions.length < PAGE_SIZE || fresh === 0) break;
    if (count !== undefined && jobs.length >= count) break;
  }

  if (config.withDescriptions === false) return { jobs, declaredTotal };

  // Descriptions come from a per-position endpoint; the listing has none.
  const limit = pLimit(Number(config.detailConcurrency ?? 4));
  const withDescriptions = await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        try {
          const detail = await fetchJson<DetailResponse>(
            `${origin}/api/pcsx/position_details?position_id=${encodeURIComponent(job.externalId)}&domain=${encodeURIComponent(domain)}&hl=fr`,
            { headers },
          );
          const terms = termsOf(detail.data);
          return {
            ...job,
            description: htmlToPlainText(detail.data?.jobDescription ?? detail.data?.job_description),
            // Group tenants: the offer belongs to its Maison, not the feed label.
            company: brandOf(detail.data) ?? job.company,
            // "Fulltime-Regular" carries both; the boundary splits contract from time.
            contract: terms ?? job.contract,
            workingTime: terms && readEmployment(terms) !== null ? terms : job.workingTime,
          };
        } catch {
          // A failed detail fetch must not lose the listing entry.
          return job;
        }
      }),
    ),
  );
  return { jobs: withDescriptions, declaredTotal };
}
