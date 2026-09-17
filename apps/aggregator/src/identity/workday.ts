import type { NormalizedJob } from '../types.js';

/** Workday emits a differently cased site segment on some native detail URLs
 * (Richemont and Theory, captured 2026-09-15). Only that ASCII segment may vary:
 * the native job path and tenant origin remain exact, without query/fragment.
 * Custom domains require exact URLs; this is not general URL case folding. */
export function workdayDetailMatchesListing(job: Pick<NormalizedJob, 'externalId' | 'url' | 'raw'>, detail: { jobPostingInfo?: { externalUrl?: unknown } }): boolean {
  try {
    const path = (job.raw as { externalPath?: unknown } | null)?.externalPath;
    const native = detail.jobPostingInfo?.externalUrl;
    if (typeof path !== 'string' || !/^\/job\/[^?#\\\s]+$/.test(path) ||
      /%(?:2f|5c|2e)/i.test(path)) return false;
    // Reject normalized traversal and empty path segments, including a trailing slash.
    if (path.slice(1).split('/').some(part => !part || part === '.' || part === '..') ||
      path.split('/').at(-1) !== job.externalId || typeof native !== 'string') return false;
    const listing = new URL(job.url), declared = new URL(native);
    if (![listing, declared].every(url => ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && !url.port) ||
      listing.origin !== declared.origin || !listing.pathname.endsWith(path)) return false;
    const prefix = listing.pathname.slice(0, -path.length);
    if (!/^\/[A-Za-z0-9_-]+$/.test(prefix)) return false;
    if (listing.href === declared.href) return true;
    if (listing.protocol !== 'https:' || !/^[a-z0-9-]+\.wd[0-9]+\.myworkdayjobs\.com$/.test(listing.hostname) || !declared.pathname.endsWith(path)) return false;
    const nativePrefix = declared.pathname.slice(0, -path.length);
    return /^\/[A-Za-z0-9_-]+$/.test(nativePrefix) && prefix.toLowerCase() === nativePrefix.toLowerCase();
  } catch { return false; }
}

/** A requisition may be published on several native career sites. Keep every
 * publication ID; use the employer tenant + declared requisition only after the
 * listing, detail URL, posting ID and posting site have all been bound together.
 * Never infer a requisition by stripping a slug or a numeric suffix. */
export function workdayRequisitionIdentity(publication: Pick<NormalizedJob, 'externalId' | 'url' | 'raw'>) {
  const raw = publication.raw;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const detail = (raw as Record<string, any>).detail;
  const info = detail?.jobPostingInfo;
  if (!info || !workdayDetailMatchesListing(publication, detail) ||
    typeof info.jobReqId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(info.jobReqId) ||
    info.jobPostingId !== publication.externalId || typeof info.jobPostingSiteId !== 'string') return;
  const url = new URL(info.externalUrl);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.wd[0-9]+\.myworkdayjobs\.com$/.test(url.hostname) ||
    url.pathname.split('/')[1] !== info.jobPostingSiteId) return;
  return { tenant: `workday:${url.hostname}`, requisition: info.jobReqId };
}
