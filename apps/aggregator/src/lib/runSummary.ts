import type { OrchestratorResult } from '../pipeline/ingestOrchestrator.js';

/** Bounded completion log; full per-source evidence remains in SourceRun. */
export function summarizeOrchestration(result: OrchestratorResult) {
  const processed = result.ok + result.failed + result.timedOut;
  const completed = processed === result.total;
  const sourceErrors = result.failed + result.timedOut;
  return {
    completed,
    ok: completed && sourceErrors === 0,
    outcome: !completed ? 'INCOMPLETE' : sourceErrors ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
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
