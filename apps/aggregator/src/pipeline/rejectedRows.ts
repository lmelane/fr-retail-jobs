import type { AdapterResult } from '../types.js';

/**
 * A rejected row is not always an error. An adapter that read every listed page
 * rejects, with a reason, what it could not turn into a posting:
 *
 *  - EXPLAINED rejections — the page exists but carries no posting (an expired
 *    page still listed in a sitemap), a Workday row without an externalPath, a
 *    cross-page repeat. They are witnesses of the enumeration, not failures.
 *  - FAILURES — a page or detail the adapter could not read or parse. Those are
 *    collection errors: the posting may exist and was not collected.
 *
 * Counting explained rejections as errors made a complete source DEGRADED and
 * withheld its right to attest absence (Alberto: 6 postings, 74 expired sitemap
 * pages, purge refused, 2026-09-09).
 */
const FAILURE_REASON = /FETCH_FAILED|UNPARSED|MALFORMED|TIMEOUT|HTTP_ERROR|UNREACHABLE/i;

export function isRejectionFailure(reason: string): boolean {
  return FAILURE_REASON.test(reason);
}

export function splitRejectedRows(rows: NonNullable<AdapterResult['rejectedRows']> | undefined) {
  const failures = (rows ?? []).filter(r => isRejectionFailure(r.reason));
  const explained = (rows ?? []).filter(r => !isRejectionFailure(r.reason));
  const reasons: Record<string, number> = {};
  for (const r of rows ?? []) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  return { failures, explained, reasons };
}
