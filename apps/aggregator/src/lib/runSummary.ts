import type { OrchestratorResult } from '../pipeline/ingestOrchestrator.js';
import { isProvenSourceIssue, NATIVE_RETENTION, type IngestionIssue } from './ingestionIssue.js';
import { isTeamDecisionRetention } from '../pipeline/publicationDisposition.js';

/**
 * Each failure line says whether it fails the RUN (D-453 §1). A source fails it unless every one of its issues
 * stands on its native proof — a retention decided on the publisher's evidence, or an archived 5xx.
 */
export function failureLine(key: string, issues: readonly IngestionIssue[], cause: string): string {
  if (!issues.length || issues.some(issue => !isProvenSourceIssue(issue))) return `${key} (bloquant : ${cause})`;
  const retained = issues.filter(issue => issue.code === NATIVE_RETENTION).reduce((total, issue) => total + issue.count, 0);
  const outages = issues.filter(issue => issue.code !== NATIVE_RETENTION).map(issue => issue.code);
  return `${key} (non bloquant : ${[retained ? `retenue sur preuve de la source, ${retained} ${retained > 1 ? 'offres' : 'offre'}` : '',
    outages.length ? `panne éditeur prouvée ${outages.join(', ')}` : ''].filter(Boolean).join(' · ')})`;
}

/** Sources and postings, never truncated, sorted by postings then key. */
function listing(entries: Iterable<[string, number]>) {
  const bySource = [...entries].filter(([, n]) => n > 0).sort(([a, n], [b, m]) => m - n || a.localeCompare(b));
  return { sources: bySource.length, postings: bySource.reduce((total, [, n]) => total + n, 0),
    bySource: bySource.map(([source, postings]) => ({ source, postings })) };
}

/** Bounded completion log; full per-source evidence remains in SourceRun. */
export function summarizeOrchestration(result: OrchestratorResult) {
  const processed = result.ok + result.failed + result.timedOut;
  const completed = processed === result.total;
  const sourceErrors = result.failed + result.timedOut;
  const issues = result.issues ?? [];
  const internalSources = new Set(issues.filter(i => i.origin === 'INTERNAL').map(i => i.source));
  const unknownSources = new Set(issues.filter(i => i.origin === 'UNKNOWN').map(i => i.source));
  const classifiedSources = new Set(issues.map(i => i.source));
  const unclassifiedSources = Math.max(0, sourceErrors - classifiedSources.size);
  const proven = issues.filter(isProvenSourceIssue);
  const nativeSources = new Set(proven.map(i => i.source));
  const retentions = proven.filter(i => i.code === NATIVE_RETENTION);
  const retainedSources = new Set(retentions.map(i => i.source));
  // An upstream outage proven by its archived 5xx response is not a retention: the bilan names them apart (D-453 §1).
  const nativeFailureSources = new Set(proven.filter(i => i.code !== NATIVE_RETENTION).map(i => i.source));
  const invalidNativeProof = issues.some(i => i.origin === 'SOURCE' && !isProvenSourceIssue(i));
  const blockingSources = new Set(issues.filter(i => !isProvenSourceIssue(i)).map(i => i.source));
  /**
   * A source whose only issue is a proven native retention collected and published: it did not fail. Counting it
   * among the failed ones made a targeted RUN of such sources end in ALL_SOURCES_FAILED.
   */
  const retentionOnlySources = [...retainedSources].filter(source => !blockingSources.has(source) && !nativeFailureSources.has(source)).length;
  const blockingReasons = [
    ...([result.total, result.ok, result.failed, result.timedOut].some(n => !Number.isInteger(n) || n < 0) ? ['INVALID_COUNTS'] : []),
    ...(!completed ? ['INCOMPLETE_RUN'] : []),
    ...(result.total === 0 ? ['NO_ACTIVE_SOURCE'] : []),
    ...(result.total > 0 && result.ok + retentionOnlySources === 0 ? ['ALL_SOURCES_FAILED'] : []),
    ...(internalSources.size ? ['INTERNAL_FAILURE'] : []),
    ...(unknownSources.size || unclassifiedSources || invalidNativeProof ? ['UNRESOLVED_FAILURE'] : []),
  ];
  const retainedPostings = new Map<string, number>();
  for (const issue of retentions) retainedPostings.set(issue.source, (retainedPostings.get(issue.source) ?? 0) + issue.count);
  // What the incidents say: team exclusions (no issue at all, D-456 §2), the guard without reference, and every
  // retention of a blocking source — visible even when a write error is what blocks it.
  const nonBlockingIncidents = result.incidents.filter(incident => incident.blocking === false);
  const teamExcluded = nonBlockingIncidents.map(incident => [incident.source, Object.entries(incident.retention?.byReason ?? {})
    .filter(([reason]) => isTeamDecisionRetention(reason)).reduce((total, [, n]) => total + n, 0)] as [string, number]);
  const retainedOnBlocking = result.incidents.filter(incident => incident.blocking !== false)
    .map(incident => [incident.source, incident.retained ?? 0] as [string, number]);
  // A retention keeps THIS RUN from publishing; an earlier publication stays online unless its reason withdraws it.
  const stillOnline = result.incidents.map(incident => [incident.source,
    Object.values(incident.retention?.online ?? {}).reduce((total, n) => total + n, 0)] as [string, number]);
  // A failure line is non-blocking only when every issue of its source stands on its native proof.
  const nonBlocking = (line: string) => { const key = line.split(' (', 1)[0]!; return nativeSources.has(key) && !blockingSources.has(key); };
  const failures = [...result.failures.filter(line => !nonBlocking(line)), ...result.failures.filter(nonBlocking)];
  return {
    completed,
    ok: blockingReasons.length === 0 && sourceErrors === 0,
    outcome: blockingReasons.length ? 'FAILED' : sourceErrors ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
    executionHealthy: blockingReasons.length === 0,
    blockingReasons,
    /**
     * What the NON-blocking source errors are, so that COMPLETED_WITH_ERRORS says whether a source retained
     * postings on its own evidence or went down with a proven 5xx. Empty when every source error blocks.
     */
    nonBlockingCauses: [...(retainedSources.size ? ['NATIVE_RETENTION'] : []), ...(nativeFailureSources.size ? ['NATIVE_HTTP_5XX'] : [])],
    attribution: { nativeSources: nativeSources.size, internalSources: internalSources.size,
      unknownSources: unknownSources.size + unclassifiedSources, nativeRetentionSources: retainedSources.size,
      nativeFailureSources: nativeFailureSources.size },
    /** Every retention on the source's own evidence that does not block, never truncated, with its total (D-453 §1, D-456 §1). */
    nativeRetentions: listing(retainedPostings),
    /** Postings excluded by the TEAM's perimeter review: a Catwalks decision, not a source's proof (D-456 §2). */
    teamExclusions: listing(teamExcluded),
    /** Sources whose negative-proof guard had no complete RUN of reference: not blocking, said (D-453 §1). */
    guardWithoutReference: nonBlockingIncidents.filter(incident => incident.guardWithoutReference).map(incident => incident.source).sort(),
    /** Retained postings of the sources that DO block the RUN, whatever blocks them. */
    retainedOnBlockingSources: listing(retainedOnBlocking),
    /** Retained postings, blocking or not, still online from an earlier collection once the RUN archived its holds. */
    retainedStillOnline: listing(stillOnline),
    sources: { total: result.total, processed, succeeded: result.ok, failed: result.failed, timedOut: result.timedOut },
    incidents: {
      total: result.incidents.length,
      broken: result.incidents.filter(i => i.status === 'BROKEN').length,
      degraded: result.incidents.filter(i => i.status === 'DEGRADED').length,
      evidence: 'SourceRun',
    },
    /** Blocking lines first; each line says whether it blocks. The native retentions are all listed above. */
    failures: failures.slice(0, 20).map(f => f.slice(0, 240)),
    omittedFailures: Math.max(0, failures.length - 20),
  };
}
