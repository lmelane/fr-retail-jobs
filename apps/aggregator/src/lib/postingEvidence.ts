import { createHash } from 'node:crypto';
import { extractJobPostings, normalizeJobPosting } from '../connectors/generic/jsonLdSitemap.js';
import type { NormalizedJob } from '../types.js';

/** Only a single JobPosting on the actual detail page can enrich this job.
 * Blog/WebPage dates, multiple postings and our fetch time are not publication evidence.
 */
export function readPostingEvidence(html: string, url: string) {
  const nodes = extractJobPostings(html);
  const node = nodes.length === 1 ? nodes[0] : undefined;
  const job = node ? normalizeJobPosting(node, url) : null;
  return { postedAt: job?.postedAt, validThrough: job?.validThrough, description: job?.description,
    evidence: { pageUrl: url, htmlSha256: createHash('sha256').update(html).digest('hex'),
      jobPostingCount: nodes.length, jobPosting: node ?? null } };
}

export function enrichPostingEvidence(job: NormalizedJob, html: string): NormalizedJob {
  const detail = readPostingEvidence(html, job.url);
  return { ...job, postedAt: job.postedAt ?? detail.postedAt,
    validThrough: job.validThrough ?? detail.validThrough,
    description: detail.description ?? job.description,
    raw: { ...(job.raw && typeof job.raw === 'object' ? job.raw : {}), postingEvidence: detail.evidence } };
}
