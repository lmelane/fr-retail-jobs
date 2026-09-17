import { createHash } from 'node:crypto';
import { captureObservedAt } from '../../capture/context.js';
import { fetchJson } from '../../lib/http.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { ashbyBoard } from '../portalConfig.js';

type AshbyJob = {
  id?: string; title?: string; location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  employmentType?: string; department?: string; team?: string;
  publishedAt?: string; isListed?: boolean; isRemote?: boolean; workplaceType?: string;
  jobUrl?: string; descriptionPlain?: string; descriptionHtml?: string;
  address?: { postalAddress?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } };
};

/** The same identity path as the published externalId, so the enumeration proof and
 * the stored representations speak one vocabulary. Null when the row cannot be named. */
function ashbyCanonicalId(job: AshbyJob): string | null {
  if (typeof job?.id === 'string' && job.id.trim()) return job.id;
  return typeof job?.jobUrl === 'string' && job.jobUrl.trim() ? job.jobUrl : null;
}

/** Ashby's documented unfiltered feed includes public direct-link-only posts.
 * Keep those observations, but honour isListed=false on our public job board.
 * A missing/error response never means an empty employer feed. */
export async function fetchAshbyJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const board = ashbyBoard(config);
  const endpoint = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
  const data = await fetchJson<{ apiVersion?: string; jobs?: AshbyJob[] }>(endpoint);
  if (data?.apiVersion !== '1' || !Array.isArray(data.jobs)) throw new Error('ASHBY_INVALID_FEED: expected API version 1 and jobs array');
  const observedAt = captureObservedAt();
  const jobs: NormalizedJob[] = [], rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const canonicalIds: string[] = [];
  let anonymousRows = 0;
  for (const job of data.jobs) {
    const canonicalId = ashbyCanonicalId(job);
    if (canonicalId) canonicalIds.push(canonicalId); else anonymousRows++;
    const normalized = parseAshbyJob(job, board, observedAt);
    if (!normalized) { rejectedRows.push({ reason: 'MISSING_ID_TITLE_OR_PUBLICATION_FLAG', raw: job, ...(canonicalId ? { canonicalId } : {}) }); continue; }
    jobs.push(normalized);
  }
  return { jobs, rejectedRows, declaredTotal: data.jobs.length,
    complete: rejectedRows.length === 0 && new Set(jobs.map(j => j.externalId)).size === jobs.length,
    enumeration: { method: 'DOCUMENTED_COMPLETE_PUBLIC_FEED', endpoint, pages: 1, rawCount: data.jobs.length, termination: 'FULL_RESPONSE',
      documentation: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
      // A row without id or URL was seen but cannot be named: no historical id may be declared absent.
      canonicalAbsenceProofUsable: anonymousRows === 0,
      pageEvidence: [{ url: endpoint, checkedAt: observedAt.toISOString(), sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
        offset: 0, pagination: null, ids: canonicalIds, canonicalIds, publisherCounter: String(data.jobs.length), componentCounters: [] }] } };
}

/** Shared live and retained-RAW reader; the observation time is explicit. */
export function parseAshbyJob(job: AshbyJob, board: string, observedAt: Date): NormalizedJob | null {
  const externalId = ashbyCanonicalId(job);
  if (!externalId || typeof job?.title !== 'string' || !job.title.trim() || typeof job.isListed !== 'boolean') return null;
  const address = job.address?.postalAddress;
  const postedAt = job.publishedAt ? new Date(job.publishedAt) : undefined;
  return { externalId, title: job.title,
    location: address?.addressLocality ? [address.addressLocality, address.addressRegion].filter(Boolean).join(', ') : job.location,
    city: address?.addressLocality, region: address?.addressRegion, country: address?.addressCountry,
    contract: job.employmentType, department: job.department ?? job.team,
    remote: job.workplaceType ?? (job.isRemote === true ? 'Remote' : undefined),
    description: job.descriptionPlain ?? job.descriptionHtml,
    url: job.jobUrl ?? `https://jobs.ashbyhq.com/${encodeURIComponent(board)}/${encodeURIComponent(externalId)}`,
    postedAt: postedAt && Number.isFinite(postedAt.getTime()) ? postedAt : undefined,
    ...(job.isListed === false ? { publicationHold: 'SOURCE_UNLISTED', publicationWithdrawnAt: observedAt } : {}),
    raw: job,
  };
}
