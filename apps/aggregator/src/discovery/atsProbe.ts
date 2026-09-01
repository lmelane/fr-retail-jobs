import { fetchWithRetry } from '../lib/http.js';
import type { AtsDetection } from '../types.js';

/**
 * Free ATS discovery: most ATS expose a public, unauthenticated endpoint keyed by
 * a company slug. Guessing slugs from the company name and probing those endpoints
 * resolves a large share of companies without spending a paid search credit.
 *
 * Verified live on 2026-09-01:
 *   SmartRecruiters  api.smartrecruiters.com/v1/companies/{slug}/postings   (Courir -> 396 jobs)
 *   Greenhouse       boards-api.greenhouse.io/v1/boards/{slug}/jobs
 *   Lever            api.lever.co/v0/postings/{slug}?mode=json
 *
 * A 200 is not sufficient on its own: SmartRecruiters answers 200 with
 * `totalFound: 0` for unknown companies, so each probe must confirm real postings.
 */

const PROBE_TIMEOUT_MS = Number(process.env.ATS_PROBE_TIMEOUT_MS ?? 12_000);

/** Slug candidates derived from a display name, most likely first. */
export function slugCandidates(companyName: string, fashionjobsSlug?: string): string[] {
  const ascii = companyName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const words = ascii.split(' ').filter(Boolean);
  // Legal/geographic suffixes are rarely part of an ATS slug.
  const noise = new Set(['sas', 'sasu', 'sa', 'sarl', 'group', 'groupe', 'france', 'paris', 'international']);
  const core = words.filter((w) => !noise.has(w));

  const variants = [
    fashionjobsSlug,
    words.join(''),
    words.join('-'),
    core.join(''),
    core.join('-'),
    core[0],
  ];

  return [...new Set(variants.filter((v): v is string => Boolean(v) && v!.length >= 3))];
}

async function probeJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }, 1);
    return await response.json();
  } catch {
    return null;
  }
}

type Probe = {
  type: AtsDetection['type'];
  url: (slug: string) => string;
  /** Must return true only when the endpoint holds real postings. */
  hasJobs: (body: any) => boolean;
  careers: (slug: string) => string;
  config: (slug: string) => Record<string, unknown>;
};

const PROBES: Probe[] = [
  {
    type: 'SMARTRECRUITERS',
    url: (s) => `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(s)}/postings?limit=1`,
    hasJobs: (b) => Number(b?.totalFound ?? 0) > 0,
    careers: (s) => `https://jobs.smartrecruiters.com/${s}`,
    config: (s) => ({ company: s }),
  },
  {
    type: 'GREENHOUSE',
    url: (s) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(s)}/jobs`,
    hasJobs: (b) => Array.isArray(b?.jobs) && b.jobs.length > 0,
    careers: (s) => `https://boards.greenhouse.io/${s}`,
    config: (s) => ({ board: s }),
  },
  {
    type: 'LEVER',
    url: (s) => `https://api.lever.co/v0/postings/${encodeURIComponent(s)}?mode=json&limit=1`,
    hasJobs: (b) => Array.isArray(b) && b.length > 0,
    careers: (s) => `https://jobs.lever.co/${s}`,
    config: (s) => ({ site: s }),
  },
  {
    type: 'RECRUITEE',
    url: (s) => `https://${encodeURIComponent(s)}.recruitee.com/api/offers/`,
    hasJobs: (b) => Array.isArray(b?.offers) && b.offers.length > 0,
    careers: (s) => `https://${s}.recruitee.com`,
    config: (s) => ({ subdomain: s }),
  },
];

/**
 * Attempts to identify a company's ATS without any paid search API.
 * Returns null when no probe confirms real postings.
 */
export async function probeAtsBySlug(
  companyName: string,
  fashionjobsSlug?: string,
): Promise<AtsDetection | null> {
  const slugs = slugCandidates(companyName, fashionjobsSlug);

  for (const slug of slugs) {
    for (const probe of PROBES) {
      const body = await probeJson(probe.url(slug));
      if (body === null || !probe.hasJobs(body)) continue;
      return {
        type: probe.type,
        careersUrl: probe.careers(slug),
        config: probe.config(slug),
        confidence: 0.9,
        note: `Resolved by direct ${probe.type} slug probe ("${slug}"); no search API used.`,
      };
    }
  }
  return null;
}
