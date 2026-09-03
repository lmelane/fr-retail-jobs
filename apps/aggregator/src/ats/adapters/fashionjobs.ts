import { fetchRenderedHtml } from '../../lib/browser.js';
import { extractJobPostings, normalizeJobPosting } from '../../connectors/generic/jsonLdSitemap.js';
import { createHash } from 'node:crypto';
import type { NormalizedJob } from '../../types.js';

/**
 * FashionJobs — the sector's own jobboard, behind Cloudflare.
 *
 * 7,611 offers at last count, including employers that exist NOWHERE else:
 * small Maisons with no ATS publish here (Agatha literally tells candidates
 * "voir nos offres" on a jobboard). That makes this feed flow B at its most
 * valuable — for those employers it is the canonical source.
 *
 * Access, verified 2026-09-02 at every layer:
 *  - robots.txt: /emploi/ (detail pages) and /s/ (listing) are NOT disallowed;
 *    the Disallows cover accounts, dashboards and applications. Policy allows.
 *  - Cloudflare 403s every plain HTTP client regardless of UA. A real Chromium
 *    passes. WAF_BLOCKED, not forbidden — the browser is the legitimate route.
 *  - The listing is server-rendered at /s/{page}.html, 27 cards per page, each
 *    card linking /emploi/{company}/{title},{id}.html.
 *  - Detail pages carry a complete JobPosting: 3,573 chars of description on
 *    the probe, hiringOrganization, address, employmentType, datePosted.
 *
 * Cloudflare also RATE-limits: page 3 fetched right after page 2 came back
 * 403. So everything here is deliberately slow — one page at a time, a pause
 * between requests, and a long wait before retrying a 403. A full sweep of
 * ~282 listing pages plus details takes hours; the default maxPages therefore
 * reads only the newest slice, which is all an incremental cron needs — the
 * listing is date-sorted, the database keeps what earlier runs wrote, and the
 * refresh pass closes what disappears.
 */

const ORIGIN = 'https://fr.fashionjobs.com';

/** ~27 offers per listing page; 40 pages ≈ the newest 1,000 offers. */
const DEFAULT_MAX_PAGES = Number(process.env.FASHIONJOBS_MAX_PAGES ?? 40);

/** Cloudflare's tolerance, measured: back-to-back pages trip it. */
const PAGE_DELAY_MS = 4_000;
const DETAIL_DELAY_MS = 2_500;
const BLOCKED_RETRY_MS = 60_000;

const CARD_LINK = /href="(https:\/\/fr\.fashionjobs\.com\/emploi\/[^"]+,\d+\.html)"/g;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One rendered fetch with a single patient retry when the shield answers. */
async function renderPatiently(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const html = await fetchRenderedHtml(url);
    // Cloudflare's block page is small and titled; a real page is neither.
    const blocked = html.length < 40_000 && /cloudflare|attention required|just a moment/i.test(html);
    if (!blocked) return html;
    await sleep(BLOCKED_RETRY_MS);
  }
  return null;
}

/**
 * A rotating crawl reports back where it got to, so the ingest layer can move
 * the cursor: `reachedEnd` is true when the board ran out of pages before the
 * window filled (wrap to page 1 next run).
 */
export type CrawlProgress = {
  reachedEnd?: boolean;
  /**
   * Last listing page fully processed (F-07). The cursor resumes at
   * lastPageDone + 1 — a sweep cut by Cloudflare or the deadline at page
   * startPage+3 must NOT advance by the whole window and skip 37 pages.
   */
  lastPageDone?: number;
};

/**
 * Reads FashionJobs offers, newest first.
 *
 * `config.maxPages` bounds the listing sweep (default 40); pass ~300 for a
 * one-off full harvest. `config.maxJobs` caps detail fetches. `config.startPage`
 * (1-based) resumes a rotating crawl partway through the listing, and
 * `config.progress` (a mutable object) receives `reachedEnd`.
 */
export async function fetchFashionjobsJobs(
  config: Record<string, unknown> = {},
): Promise<NormalizedJob[]> {
  const maxPages = Number(config.maxPages ?? DEFAULT_MAX_PAGES);
  const maxJobs = Number(config.maxJobs ?? 0);
  const startPage = Math.max(1, Number(config.startPage) || 1);
  const progress = (config.progress ?? {}) as CrawlProgress;
  // A soft wall-clock budget: Cloudflare forces this crawl to be slow (a pause
  // between every page and every detail), so even the newest 40 pages overrun a
  // 20-minute window. Rather than be cut mid-flight and lose the run, it stops
  // itself before the deadline with what it fetched — the listing is date-sorted
  // and the database keeps prior runs, so coverage accumulates across the day.
  const deadlineMs = Number(config.deadlineMs) || 0;
  const pastDeadline = () => deadlineMs > 0 && Date.now() >= deadlineMs;

  const detailUrls: string[] = [];
  const seen = new Set<string>();

  // Crawl a window [startPage, startPage + maxPages) of the listing.
  for (let page = startPage; page < startPage + maxPages; page++) {
    if (pastDeadline()) break;
    const url = page === 1 ? `${ORIGIN}/s/` : `${ORIGIN}/s/${page}.html`;
    const html = await renderPatiently(url);
    if (html === null) {
      // The shield held through the retry. Keep what we have rather than
      // failing the run — but say so, loudly enough for the health check.
      console.error(`[fashionjobs] listing page ${page} blocked twice; stopping the sweep here`);
      break;
    }

    const links = [...html.matchAll(CARD_LINK)]
      .map((match) => match[1])
      .filter((link) => !seen.has(link));
    // An empty page is the end of the board: mark it so the cursor wraps to 1.
    if (links.length === 0) {
      progress.reachedEnd = true;
      break;
    }
    for (const link of links) {
      seen.add(link);
      detailUrls.push(link);
    }
    progress.lastPageDone = page;
    if (maxJobs > 0 && detailUrls.length >= maxJobs) break;
    await sleep(PAGE_DELAY_MS);
  }

  const targets = maxJobs > 0 ? detailUrls.slice(0, maxJobs) : detailUrls;
  const jobs: NormalizedJob[] = [];

  // Sequential on purpose: this host blocks bursts, and one browser tab
  // working calmly through the list is what it tolerates.
  for (const url of targets) {
    if (pastDeadline()) break;
    await sleep(DETAIL_DELAY_MS);
    let html: string | null;
    try {
      html = await renderPatiently(url);
    } catch {
      continue;
    }
    if (!html) continue;

    const [posting] = extractJobPostings(html);
    if (!posting) continue;
    const job = normalizeJobPosting(posting, url);
    if (!job) continue;

    const organization = (posting.hiringOrganization as { name?: string } | undefined)?.name;
    jobs.push({
      ...job,
      // The numeric id from the URL is FashionJobs' own posting id — stable
      // across title edits, unlike a URL hash.
      externalId: url.match(/,(\d+)\.html$/)?.[1] ?? createHash('sha1').update(url).digest('hex'),
      // The EMPLOYER, not the board: dedup and the reference list key on it.
      company: organization,
      url,
    });
  }

  return jobs;
}
