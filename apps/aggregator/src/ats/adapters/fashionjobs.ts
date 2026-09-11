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
 *
 * All of the above is kept as the record of what this feed WAS. Since 2026-09-11 it supplies no postings at all
 * (see the owner decision below); only the access notes remain useful, for the actor-discovery circuit.
 */


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
 * OWNER DECISION, 2026-09-11: FashionJobs is EXCLUSIVELY a discovery source for Maisons, groups and retailers.
 * It is out of the offer circuit, entirely and permanently.
 *
 * The guard lives HERE, at the only door through which postings could re-enter, rather than only in the catalogue:
 * a `Source` row can be re-created, `sources.csv` re-imported (it rewrites config at every boot), a config copied,
 * or an older execution path replayed — each of those would silently refeed the circuit. Refusing at the adapter
 * makes every one of those routes fail loudly instead.
 *
 * What is NOT touched: `connectors/fashionjobs/companyDirectory.ts` and `pipeline/discoverFashionJobs.ts`, the
 * actor-discovery circuit, which stays fully usable — and the Maisons already discovered through it keep their
 * place in the inventory.
 */
export class FashionjobsOffersWithdrawn extends Error {
  constructor() {
    super('FashionJobs is a discovery-only source (owner decision 2026-09-11): it must never supply postings. ' +
      'Actor discovery stays available through connectors/fashionjobs/companyDirectory.ts.');
    this.name = 'FashionjobsOffersWithdrawn';
  }
}

export async function fetchFashionjobsJobs(
  config: Record<string, unknown> = {},
): Promise<NormalizedJob[]> {
  throw new FashionjobsOffersWithdrawn();
}

