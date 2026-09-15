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
  return readPostingNode(node, { pageUrl: url, htmlSha256: createHash('sha256').update(html).digest('hex'), jobPostingCount: nodes.length, jobPosting: node ?? null });
}

type NativePostingEvidence = { pageUrl: string; htmlSha256: string; jobPostingCount: number; jobPosting: Record<string, unknown> | null };
function readPostingNode(node: Record<string, unknown> | undefined, evidence: NativePostingEvidence) {
  const url = evidence.pageUrl;
  const job = node ? normalizeJobPosting(node, url) : null;
  const places = node?.jobLocation ? (Array.isArray(node.jobLocation) ? node.jobLocation : [node.jobLocation]) : [];
  const geography = places.length === 1 ? job : null;
  const org = node?.hiringOrganization && typeof node.hiringOrganization === 'object' && !Array.isArray(node.hiringOrganization) ? node.hiringOrganization as Record<string, unknown> : null;
  const orgName = typeof org?.name === 'string' && org.name.trim() ? org.name.trim() : undefined;
  const hiringOrganization = orgName ? { name: orgName, sameAs: typeof org?.sameAs === 'string' ? org.sameAs : undefined } : null;
  return { geography, hiringOrganization, postedAt: job?.postedAt, validThrough: job?.validThrough, description: job?.description,
    evidence };
}

export type PostingEvidenceOptions = {
  /**
   * Take the employer from the detail page's own JobPosting `hiringOrganization`
   * instead of the catalogue label. Opt-in per source, established by a portal
   * owner review: a shared group portal (URBN's iCIMS hub, 2026-09-09) names the
   * employing brand on every posting page, and the catalogue label would credit
   * the group. Never inferred from a title or a description.
   */
  employerFromJobPosting?: boolean;
};

/** Reads the opt-in from a source configuration; anything but `true` leaves the catalogue label in place. */
export function postingEvidenceOptions(config: Record<string, unknown>): PostingEvidenceOptions {
  return { employerFromJobPosting: config.employerFromJobPosting === true };
}

export function enrichPostingEvidence(job: NormalizedJob, html: string, options: PostingEvidenceOptions = {}): NormalizedJob {
  const detail = readPostingEvidence(html, job.url);
  return applyPostingEvidence(job, detail, options);
}

/** Reuses the native node without manufacturing a page or a new capture. */
export function enrichRetainedPostingEvidence(job: NormalizedJob, evidence: Record<string, unknown>): NormalizedJob | null {
  if (evidence.pageUrl !== job.url || typeof evidence.htmlSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.htmlSha256) ||
    ![0, 1].includes(evidence.jobPostingCount as number) || evidence.employerFromJobPosting === true ||
    evidence.geographyConflict != null && typeof evidence.geographyConflict !== 'boolean') return null;
  const node = evidence.jobPosting;
  if (evidence.jobPostingCount === 0 && node != null) return null;
  if (evidence.jobPostingCount === 1) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    const posting = node as Record<string, unknown>;
    if (!(posting['@type'] === 'JobPosting' || Array.isArray(posting['@type']) && posting['@type'].includes('JobPosting'))) return null;
    if (posting.url != null) {
      try { if (typeof posting.url !== 'string' || new URL(posting.url).href !== job.url) return null; } catch { return null; }
    }
  }
  return applyPostingEvidence(job, readPostingNode(node as Record<string, unknown> | undefined,
    { pageUrl: job.url, htmlSha256: evidence.htmlSha256, jobPostingCount: evidence.jobPostingCount as number, jobPosting: node as Record<string, unknown> | null }), {});
}

function applyPostingEvidence(job: NormalizedJob, detail: ReturnType<typeof readPostingNode>, options: PostingEvidenceOptions): NormalizedJob {
  const employer = options.employerFromJobPosting && detail.hiringOrganization
    ? { company: detail.hiringOrganization.name, employerEvidence: { rawName: detail.hiringOrganization.name, path: 'jsonld.hiringOrganization.name', rule: 'EXPLICIT_JOBPOSTING_EMPLOYER' } }
    : {};
  const countryKey = (value: string) => normalizeCountry(value) ?? value.trim().toLowerCase();
  const geographyConflict = !!(job.country && detail.geography?.country && countryKey(job.country) !== countryKey(detail.geography.country)) ||
    !!(job.city && detail.geography?.city && job.city.trim().toLowerCase() !== detail.geography.city.trim().toLowerCase());
  // Do not assemble a country from one observation and an incompatible city
  // from another. Both original observations remain in the evidence.
  const geography = geographyConflict ? null : detail.geography;
  return { ...job, ...employer,
    country: job.country ?? geography?.country,
    city: job.city ?? geography?.city,
    region: job.region ?? geography?.region,
    postalCode: job.postalCode ?? geography?.postalCode,
    location: job.location ?? geography?.location,
    postedAt: job.postedAt ?? detail.postedAt,
    validThrough: job.validThrough ?? detail.validThrough,
    description: detail.description ?? job.description,
    raw: { ...(job.raw && typeof job.raw === 'object' ? job.raw : {}), postingEvidence: { ...detail.evidence, geographyConflict, hiringOrganization: detail.hiringOrganization, employerFromJobPosting: !!options.employerFromJobPosting } } };
}
