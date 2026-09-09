import { normalizeCountry } from '../normalize/country.js';
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
  const places = node?.jobLocation ? (Array.isArray(node.jobLocation) ? node.jobLocation : [node.jobLocation]) : [];
  const geography = places.length === 1 ? job : null;
  return { geography, postedAt: job?.postedAt, validThrough: job?.validThrough, description: job?.description,
    evidence: { pageUrl: url, htmlSha256: createHash('sha256').update(html).digest('hex'),
      jobPostingCount: nodes.length, jobPosting: node ?? null } };
}

export function enrichPostingEvidence(job: NormalizedJob, html: string): NormalizedJob {
  const detail = readPostingEvidence(html, job.url);
  const countryKey = (value: string) => normalizeCountry(value) ?? value.trim().toLowerCase();
  const geographyConflict = !!(job.country && detail.geography?.country && countryKey(job.country) !== countryKey(detail.geography.country)) ||
    !!(job.city && detail.geography?.city && job.city.trim().toLowerCase() !== detail.geography.city.trim().toLowerCase());
  // Do not assemble a country from one observation and an incompatible city
  // from another. Both original observations remain in the evidence.
  const geography = geographyConflict ? null : detail.geography;
  return { ...job,
    country: job.country ?? geography?.country,
    city: job.city ?? geography?.city,
    region: job.region ?? geography?.region,
    postalCode: job.postalCode ?? geography?.postalCode,
    location: job.location ?? geography?.location,
    postedAt: job.postedAt ?? detail.postedAt,
    validThrough: job.validThrough ?? detail.validThrough,
    description: detail.description ?? job.description,
    raw: { ...(job.raw && typeof job.raw === 'object' ? job.raw : {}), postingEvidence: { ...detail.evidence, geographyConflict } } };
}
