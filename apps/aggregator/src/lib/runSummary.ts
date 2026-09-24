import type { OrchestratorResult } from '../pipeline/ingestOrchestrator.js';

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
  const nativeSources = new Set(issues.filter(i => i.origin === 'SOURCE' && i.captureBatchId && i.rawCaptureId).map(i => i.source));
  const invalidNativeProof = issues.some(i => i.origin === 'SOURCE' && (!i.captureBatchId || !i.rawCaptureId));
  const blockingReasons = [
    ...([result.total, result.ok, result.failed, result.timedOut].some(n => !Number.isInteger(n) || n < 0) ? ['INVALID_COUNTS'] : []),
    ...(!completed ? ['INCOMPLETE_RUN'] : []),
    ...(result.total === 0 ? ['NO_ACTIVE_SOURCE'] : []),
    ...(result.total > 0 && result.ok === 0 ? ['ALL_SOURCES_FAILED'] : []),
    ...(internalSources.size ? ['INTERNAL_FAILURE'] : []),
    ...(unknownSources.size || unclassifiedSources || invalidNativeProof ? ['UNRESOLVED_FAILURE'] : []),
  ];
  return {
    completed,
    ok: blockingReasons.length === 0 && sourceErrors === 0,
    outcome: blockingReasons.length ? 'FAILED' : sourceErrors ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
    executionHealthy: blockingReasons.length === 0,
    blockingReasons,
    attribution: { nativeSources: nativeSources.size, internalSources: internalSources.size,
      unknownSources: unknownSources.size + unclassifiedSources },
    sources: { total: result.total, processed, succeeded: result.ok, failed: result.failed, timedOut: result.timedOut },
    incidents: {
      total: result.incidents.length,
      broken: result.incidents.filter(i => i.status === 'BROKEN').length,
      degraded: result.incidents.filter(i => i.status === 'DEGRADED').length,
      evidence: 'SourceRun',
    },
    failures: result.failures.slice(0, 20).map(f => f.slice(0, 240)),
    omittedFailures: Math.max(0, result.failures.length - 20),
  };
}
