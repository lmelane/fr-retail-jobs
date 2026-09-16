import type { NormalizedJob } from '../../types.js';

/** FashionJobs is discovery-only by owner decision (2026-09-11). The explicit
 * rejection also protects direct calls and an accidentally reactivated source. */
export class FashionjobsOffersWithdrawn extends Error {
  constructor() {
    super('FashionJobs is a discovery-only source (owner decision 2026-09-11): it must never supply postings. ' +
      'Actor discovery stays available through connectors/fashionjobs/companyDirectory.ts.');
    this.name = 'FashionjobsOffersWithdrawn';
  }
}

export async function fetchFashionjobsJobs(
  _config: Record<string, unknown> = {},
): Promise<NormalizedJob[]> {
  throw new FashionjobsOffersWithdrawn();
}

