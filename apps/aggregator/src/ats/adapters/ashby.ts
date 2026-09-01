import { fetchJson } from '../../lib/http.js';
import type { NormalizedJob } from '../../types.js';

/**
 * Ashby public job board API.
 *
 * Verified 2026-09-01: one request returns every posting WITH its full
 * description — 67 jobs, descriptions up to 20k characters. That is the whole
 * argument for preferring an ATS over a sitemap: L'Oréal costs 1734 page fetches
 * through its sitemap and would cost one call here.
 */

type AshbyJob = {
  id?: string;
  title?: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  employmentType?: string;
  publishedAt?: string;
  isListed?: boolean;
  isRemote?: boolean;
  jobUrl?: string;
  descriptionPlain?: string;
  address?: {
    postalAddress?: {
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string;
    };
  };
};

type AshbyResponse = { jobs?: AshbyJob[] };

export async function fetchAshbyJobs(config: Record<string, unknown>): Promise<NormalizedJob[]> {
  const board = String(config.board ?? config.slug ?? '');
  if (!board) throw new Error('Ashby board handle missing');

  const data = await fetchJson<AshbyResponse>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`,
  );

  return (data.jobs ?? [])
    // Unlisted postings are drafts or internal roles, not public openings.
    .filter((job) => job.isListed !== false && job.title)
    .map((job) => {
      const address = job.address?.postalAddress;
      const postedAt = job.publishedAt ? new Date(job.publishedAt) : undefined;

      return {
        externalId: String(job.id ?? job.jobUrl ?? job.title),
        title: String(job.title),
        location: address?.addressLocality
          ? [address.addressLocality, address.addressRegion].filter(Boolean).join(', ')
          : job.location,
        country: address?.addressCountry,
        contract: job.employmentType,
        description: job.descriptionPlain,
        url: job.jobUrl ?? `https://jobs.ashbyhq.com/${board}/${job.id ?? ''}`,
        postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
        raw: job,
      } satisfies NormalizedJob;
    });
}
