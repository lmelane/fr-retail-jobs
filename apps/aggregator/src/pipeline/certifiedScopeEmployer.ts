import type { NormalizedJob } from '../types.js';

export const CERTIFIED_SCOPE_RULE = 'EMPLOYER_INFERRED_FROM_CERTIFIED_SINGLE_BRAND_PORTAL';
export const CERTIFIED_SCOPE_PATH = 'portal.certifiedScope';
/** Holds that mean "the page named no employer" — never a hold that means the page was unreadable. */
const EMPLOYER_ABSENT_HOLDS = new Set(['WORKDAY_EMPLOYER_ABSENT_IN_DETAIL']);

/**
 * A posting held because its native page names no employer may take the
 * portal owner as employer ONLY when the portal's perimeter is certified
 * SINGLE_BRAND for the current configuration (owner decision 2026-09-09). The
 * provenance is recorded apart from an explicit label, and a MULTI_BRAND or
 * unreviewed portal never gets it: the posting stays held.
 */
export function employerFromCertifiedScope(job: NormalizedJob, ownerLabel: string, scope: 'SINGLE_BRAND' | 'MULTI_BRAND' | null): NormalizedJob {
  if (!job.publicationHold || !EMPLOYER_ABSENT_HOLDS.has(job.publicationHold) || scope !== 'SINGLE_BRAND' || !ownerLabel.trim()) return job;
  const { publicationHold: _hold, ...rest } = job;
  return { ...rest, company: undefined, employerEvidence: { rawName: ownerLabel.trim(), path: CERTIFIED_SCOPE_PATH, rule: CERTIFIED_SCOPE_RULE } };
}
