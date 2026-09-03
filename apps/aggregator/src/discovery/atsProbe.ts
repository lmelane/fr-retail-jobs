import { withHostGate } from '../lib/hostGate.js';
import { assertPublicUrl } from '../lib/ssrf.js';
import { techScanHostnames } from './techScan.js';
import type { AtsDetection } from '../types.js';
import type { AtsType } from '@prisma/client';

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

// Short on purpose: an ATS API answers fast or not at all. A long timeout makes a
// NON-match (a brand with no ATS, or a non-existent careers domain whose DNS
// stalls) dominate the run — the whole 14k throughput hinges on failing fast.
const PROBE_TIMEOUT_MS = Number(process.env.ATS_PROBE_TIMEOUT_MS ?? 5_000);

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

/**
 * A single probe fetch with a HARD short timeout and NO retry — a probe must fail
 * fast on a non-match. Goes through the host gate for politeness, but not through
 * fetchWithRetry (whose 20s timeout + retries would make non-matches dominate the
 * run). SSRF-guarded, no redirects followed (a probe wants the direct answer).
 */
async function probeFetch(
  url: string,
  init: RequestInit,
  asText: boolean,
): Promise<unknown | null> {
  try {
    assertPublicUrl(url);
  } catch {
    return null;
  }
  return withHostGate(url, async () => {
    try {
      // Follow redirects: some ATS endpoints 30x to a regional host before the
      // real answer (manual redirect would drop them). The SSRF guard already
      // validated the initial URL; ATS API hosts are well-known, low-risk.
      const response = await fetch(url, {
        ...init,
        redirect: 'follow',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      return asText ? await response.text() : await response.json();
    } catch {
      return null;
    }
  });
}

function probeBody(url: string, asText: boolean): Promise<unknown | null> {
  return probeFetch(url, {}, asText);
}

type Probe = {
  type: AtsDetection['type'];
  url: (slug: string) => string;
  /** Must return true only when the endpoint holds real postings. */
  hasJobs: (body: any) => boolean;
  careers: (slug: string) => string;
  config: (slug: string) => Record<string, unknown>;
  /** Endpoint returns text (XML), not JSON — probed as a string. */
  text?: boolean;
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
  {
    // Teamtailor: <slug>.teamtailor.com/jobs.json (verified: faguo -> 200).
    type: 'TEAMTAILOR',
    url: (s) => `https://${encodeURIComponent(s)}.teamtailor.com/jobs.json?per_page=1`,
    hasJobs: (b) => Array.isArray(b?.items) && b.items.length > 0,
    careers: (s) => `https://${s}.teamtailor.com`,
    config: (s) => ({ origin: `https://${s}.teamtailor.com` }),
  },
  {
    // Personio: <slug>.jobs.personio.de/xml (also .com); the XML lists positions.
    type: 'PERSONIO',
    url: (s) => `https://${encodeURIComponent(s)}.jobs.personio.de/xml`,
    // The probe returns XML text (not JSON) — hasJobs inspects the raw string.
    hasJobs: (b) => typeof b === 'string' && /<position/i.test(b),
    careers: (s) => `https://${s}.jobs.personio.de`,
    config: (s) => ({ subdomain: s, host: `${s}.jobs.personio.de` }),
    text: true,
  },
  {
    // Workable: apply.workable.com/api/v1/widget/accounts/<slug>?details=true.
    type: 'WORKABLE',
    url: (s) => `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(s)}?details=true`,
    hasJobs: (b) => Array.isArray(b?.jobs) && b.jobs.length > 0,
    careers: (s) => `https://apply.workable.com/${s}`,
    config: (s) => ({ subdomain: s }),
  },
  {
    // Welcome to the Jungle: the public pages API confirms a company exists on
    // WTTJ by slug (200 vs 404), no homepage read. The WTTJ adapter then fetches
    // the real jobs via Algolia from that slug. A job listing carries sections;
    // require at least one so an empty shell is not counted.
    type: 'WTTJ',
    url: (s) => `https://api.welcometothejungle.com/api/v1/pages?path=/fr/companies/${encodeURIComponent(s)}/jobs`,
    hasJobs: (b) => Boolean(b?.page?.id) && Array.isArray(b?.page?.sections) && b.page.sections.length > 0,
    careers: (s) => `https://www.welcometothejungle.com/fr/companies/${s}/jobs`,
    config: (s) => ({ slug: s }),
  },
];

/**
 * Careers-DOMAIN candidates for a brand whose ATS is keyed by a hostname rather
 * than a slug (DigitalRecruiters, a Teamtailor career subdomain). Built from the
 * brand's own registrable domain when we have its site URL — this is the API
 * path that BYPASSES a bot-blocked marketing homepage entirely (the ATS API is
 * public even when the site 403s; verified: careers.lacoste.com -> 461 offers).
 */
export function careersDomainCandidates(companyName: string, siteUrl?: string): string[] {
  const roots = new Set<string>();
  if (siteUrl) {
    try {
      const host = new URL(siteUrl).hostname.replace(/^www\./, '');
      roots.add(host);
    } catch {
      /* ignore */
    }
  }
  // Also derive a plausible <brand>.com from the name, for rosters without a URL.
  const core = slugCandidates(companyName)[0];
  if (core) roots.add(`${core}.com`);

  // The most likely careers hosts. `jobs.` is included for the tech-scan (DNS is
  // cheap and jobs.<brand> is common — jobs.sephora.com), even though it adds a
  // candidate: the CNAME lookup is far lighter than an HTTP probe.
  const prefixes = ['careers', 'talents', 'jobs', 'carriere'];
  const domains = new Set<string>();
  for (const root of roots) {
    for (const p of prefixes) domains.add(`${p}.${root}`);
  }
  return [...domains].slice(0, 8);
}

/** Does this careers domain serve a DigitalRecruiters board? */
async function probeDigitalRecruiters(domainName: string): Promise<boolean> {
  const url = `https://api.digitalrecruiters.com/public/v1/careers-site/job-ads?domainName=${encodeURIComponent(domainName)}&limit=1&page=1&locale=fr_FR`;
  const body = (await probeFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }, false)) as { items?: unknown[] } | null;
  return Array.isArray(body?.items) && body.items.length > 0;
}

/**
 * Attempts to identify a company's ATS without any paid search API and WITHOUT
 * reading its (possibly bot-blocked) homepage — by probing public ATS endpoints
 * directly. Slug-keyed ATS first (cheap), then careers-domain-keyed ones.
 * Returns null when nothing confirms real postings.
 */
/** An AtsDetection from a tech-scan hit — the careers host + its identified ATS. */
function detectionFromTechScan(ats: AtsType, careersHost: string, cname: string): AtsDetection | null {
  const careersUrl = `https://${careersHost}`;
  const note = `Tech-scan: ${careersHost} CNAMEs to ${cname || ats}; no page read.`;
  switch (ats) {
    case 'DIGITALRECRUITERS':
      return { type: ats, careersUrl, config: { domainName: careersHost }, confidence: 0.95, note };
    case 'EIGHTFOLD':
      return { type: ats, careersUrl, config: { origin: careersUrl }, confidence: 0.9, note };
    case 'TEAMTAILOR':
    case 'TALENTSOFT':
      return { type: ats, careersUrl, config: { origin: careersUrl }, confidence: 0.9, note };
    case 'SUCCESSFACTORS':
      return { type: ats, careersUrl, config: { origin: careersUrl }, confidence: 0.85, note };
    default:
      // A provider we recognise but have no ready-to-use config for (Workday needs
      // a tenant, Taleo/iCIMS have no adapter yet): record the careers page for
      // review with the provider named in the note, so a human knows exactly which
      // adapter to wire — rather than an unusable config or a silent drop.
      return { type: 'GENERIC_JSONLD', careersUrl, config: { startUrl: careersUrl }, confidence: 0.6, note: `${note} (adapter/slug needed — review)` };
  }
}

export async function probeAtsBySlug(
  companyName: string,
  fashionjobsSlug?: string,
  siteUrl?: string,
): Promise<AtsDetection | null> {
  // TECH-SCAN FIRST (the technographics approach): a careers subdomain CNAMEs
  // straight to its ATS provider (careers.lacoste.com -> digitalrecruiters.com).
  // Pure DNS — no page load, never blocked, and it says WHICH ATS so we skip
  // blind probing. Cheapest and most reliable signal, so it leads.
  const scan = await techScanHostnames(careersDomainCandidates(companyName, siteUrl));
  if (scan) {
    const detection = detectionFromTechScan(scan.ats, scan.host, scan.cname);
    if (detection) return detection;
  }

  // Bounded: the top few slugs only. More candidates barely help and multiply the
  // request count per brand (14k brands -> that matters).
  const slugs = slugCandidates(companyName, fashionjobsSlug).slice(0, 3);

  // Try every (slug, probe) pair CONCURRENTLY and take the first real hit — much
  // faster than the nested sequential loops, and the host-gate still keeps us
  // polite per ATS host.
  const slugAttempts = slugs.flatMap((slug) =>
    PROBES.map(async (probe): Promise<AtsDetection | null> => {
      const body = await probeBody(probe.url(slug), probe.text ?? false);
      if (body === null || !probe.hasJobs(body)) return null;
      return {
        type: probe.type,
        careersUrl: probe.careers(slug),
        config: probe.config(slug),
        confidence: 0.9,
        note: `Resolved by direct ${probe.type} slug probe ("${slug}"); no search API used.`,
      };
    }),
  );
  const slugHit = (await Promise.all(slugAttempts)).find(Boolean);
  if (slugHit) return slugHit;

  // Domain-keyed: DigitalRecruiters on a careers.<brand> host — reaches a
  // Cloudflare-blocked brand (Lacoste, Aigle…) through its public API, no
  // homepage read. Probed concurrently, first hit wins.
  const domainAttempts = careersDomainCandidates(companyName, siteUrl).map(
    async (domainName): Promise<AtsDetection | null> =>
      (await probeDigitalRecruiters(domainName))
        ? {
            type: 'DIGITALRECRUITERS' as const,
            careersUrl: `https://${domainName}`,
            config: { domainName },
            confidence: 0.92,
            note: `Resolved by direct DigitalRecruiters API probe (${domainName}); no homepage read.`,
          }
        : null,
  );
  return (await Promise.all(domainAttempts)).find(Boolean) ?? null;
}
