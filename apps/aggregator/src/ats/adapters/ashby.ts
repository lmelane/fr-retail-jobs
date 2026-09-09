import { fetchJson } from '../../lib/http.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

type AshbyJob = {
  id?: string; title?: string; location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  employmentType?: string; department?: string; team?: string;
  publishedAt?: string; isListed?: boolean; isRemote?: boolean; workplaceType?: string;
  jobUrl?: string; descriptionPlain?: string; descriptionHtml?: string;
  address?: { postalAddress?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } };
};

/** Ashby's documented unfiltered feed includes public direct-link-only posts.
 * Keep those observations, but honour isListed=false on our public job board.
 * A missing/error response never means an empty employer feed. */
export async function fetchAshbyJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const board = String(config.board ?? config.slug ?? '');
  if (!board) throw new Error('Ashby board handle missing');
  const endpoint = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
  const data = await fetchJson<{ apiVersion?: string; jobs?: AshbyJob[] }>(endpoint);
  if (data?.apiVersion !== '1' || !Array.isArray(data.jobs)) throw new Error('ASHBY_INVALID_FEED: expected API version 1 and jobs array');
  const observedAt = new Date();
  const jobs: NormalizedJob[] = [], rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  for (const job of data.jobs) {
    // Job URL is also a durable source ID when the API omits its optional id.
    const externalId = typeof job?.id === 'string' && job.id.trim() ? job.id : job?.jobUrl;
    if (!externalId || typeof job?.title !== 'string' || !job.title.trim() || typeof job.isListed !== 'boolean') {
      rejectedRows.push({ reason: 'MISSING_ID_TITLE_OR_PUBLICATION_FLAG', raw: job }); continue;
    }
    const address = job.address?.postalAddress;
    const postedAt = job.publishedAt ? new Date(job.publishedAt) : undefined;
    jobs.push({ externalId, title: job.title,
      location: address?.addressLocality ? [address.addressLocality, address.addressRegion].filter(Boolean).join(', ') : job.location,
      city: address?.addressLocality, region: address?.addressRegion, country: address?.addressCountry,
      contract: job.employmentType, department: job.department ?? job.team,
      remote: job.workplaceType ?? (job.isRemote === true ? 'Remote' : undefined),
      description: job.descriptionPlain ?? job.descriptionHtml,
      url: job.jobUrl ?? `https://jobs.ashbyhq.com/${encodeURIComponent(board)}/${encodeURIComponent(externalId)}`,
      postedAt: postedAt && Number.isFinite(postedAt.getTime()) ? postedAt : undefined,
      ...(job.isListed === false ? { publicationHold: 'SOURCE_UNLISTED', publicationWithdrawnAt: observedAt } : {}),
      raw: job,
    });
  }
  return { jobs, rejectedRows, declaredTotal: data.jobs.length,
    complete: rejectedRows.length === 0 && new Set(jobs.map(j => j.externalId)).size === jobs.length,
    enumeration: { method: 'DOCUMENTED_COMPLETE_PUBLIC_FEED', endpoint, pages: 1, rawCount: data.jobs.length, termination: 'FULL_RESPONSE',
      documentation: 'https://developers.ashbyhq.com/docs/public-job-posting-api' } };
}
