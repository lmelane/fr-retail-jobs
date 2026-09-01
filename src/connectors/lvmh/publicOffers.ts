import { fetchJson } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

/**
 * LVMH public job offers.
 *
 * Scope boundary (deliberate): this connector reads only the PUBLIC offer route,
 * `/fr/nous-rejoindre/nos-offres/{REFERENCE}`, served by the unauthenticated
 * endpoint below. LVMH's robots.txt disallows `/*espace-candidat` and
 * `/*candidate-portal` — the APPLICATION portal — and we never touch those.
 * Reading a public posting and crawling the candidate portal are different things.
 *
 * Verified live 2026-09-01 with reference REPO00097 (Repossi, Paris, CDI):
 *   GET /proxyApi/v1/jobhub/offer?reference={REF}&lang=fr   -> 200, full payload
 *   GET /proxyApi/v1/jobhub/criteria?lang=fr                -> 200, 76 maisons
 * A closed or unknown reference returns 404, which drives the CLOSED lifecycle.
 */

const BASE = 'https://www.lvmh.com/proxyApi/v1/jobhub';
const PUBLIC_OFFER_PAGE = 'https://www.lvmh.com/fr/nous-rejoindre/nos-offres';

/** Sent so the API sees the same origin as the public listing page. */
const REQUEST_HEADERS = { accept: 'application/json', referer: PUBLIC_OFFER_PAGE };

export type LvmhCriteria = {
  maisons: Array<{ label: string; value: string }>;
  businessGroups: Array<{ label: string; value: string; maisons?: string[] }>;
  functions: Array<{ label: string; value: string }>;
  contracts: Array<{ label: string; value: string }>;
  countryRegions: Array<{ label: string; value: string }>;
};

/**
 * The group-wide reference lists (76 Maisons, business groups, functions...).
 * Doubles as a free sector-classification source for the wider pipeline.
 */
export async function fetchLvmhCriteria(lang = 'fr'): Promise<LvmhCriteria> {
  return fetchJson<LvmhCriteria>(`${BASE}/criteria?lang=${encodeURIComponent(lang)}`, {
    headers: REQUEST_HEADERS,
  });
}

type LvmhOffer = {
  id?: string;
  reference?: string;
  jobTitle?: string;
  maison?: string;
  company?: string;
  contract?: string;
  city?: string;
  regionState?: string;
  countryRegion?: string;
  geographicArea?: string;
  position?: string;
  profile?: string;
  applyLink?: string;
  salary?: string;
  publicationStartDate?: number | string;
  requiredExperience?: string;
  workMode?: string;
  sourceATS?: string;
};

/** Epoch seconds -> Date; the API sends numeric timestamps (or empty strings). */
function toDate(value: number | string | undefined): Date | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000);
}

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

export function normalizeLvmhOffer(offer: LvmhOffer): NormalizedJob | null {
  const reference = offer.reference;
  if (!reference || !offer.jobTitle) return null;

  const location = [offer.city, offer.regionState].filter(Boolean).join(', ') || undefined;
  const description = [stripHtml(offer.position), stripHtml(offer.profile)]
    .filter(Boolean)
    .join('\n\n');

  return {
    externalId: reference,
    title: offer.jobTitle,
    location,
    // countryRegion is the country ("France"); france.ts maps it to isFrance.
    country: offer.countryRegion,
    contract: offer.contract,
    description: description || undefined,
    // Canonical URL is the employer-side public posting, per source priority.
    url: `${PUBLIC_OFFER_PAGE}/${encodeURIComponent(reference)}`,
    postedAt: toDate(offer.publicationStartDate),
    // postingUserEmail is a named recruiter's address: personal data, not stored.
    raw: { ...offer, postingUserEmail: undefined },
  };
}

/**
 * Fetches one public offer. Returns null when the reference is unknown or the
 * posting has closed (HTTP 404) so the caller can mark it inactive.
 */
export async function fetchLvmhOffer(
  reference: string,
  lang = 'fr',
): Promise<NormalizedJob | null> {
  try {
    const offer = await fetchJson<LvmhOffer>(
      `${BASE}/offer?reference=${encodeURIComponent(reference)}&lang=${encodeURIComponent(lang)}`,
      { headers: REQUEST_HEADERS },
    );
    return normalizeLvmhOffer(offer);
  } catch (error) {
    if (error instanceof Error && /HTTP 404/.test(error.message)) return null;
    throw error;
  }
}
