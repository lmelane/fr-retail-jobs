import { describe, it, expect } from 'vitest';
import { summarizeOrchestration } from './runSummary.js';

describe('completion signal', () => {
  const night = { total: 424, ok: 423, failed: 1, timedOut: 0,
    failures: ['native (failed)'], incidents: [], issues: [
      { source: 'native', origin: 'SOURCE' as const, code: 'HTTP_503', count: 1, captureBatchId: 'batch', rawCaptureId: 'raw' },
    ] };
  it('distinguishes the completed nightly run from a successful run', () => {
    expect(summarizeOrchestration(night)).toMatchObject({
      completed: true, ok: false, outcome: 'COMPLETED_WITH_ERRORS', sources: { processed: 424 },
    });
    expect(summarizeOrchestration({ ...night, ok: 420 })).toMatchObject({ completed: false, ok: false, outcome: 'FAILED', executionHealthy: false });
    expect(summarizeOrchestration({ ...night, ok: 424, failed: 0, failures: [], issues: [] })).toMatchObject({ completed: true, ok: true, executionHealthy: true });
  });
  it('blocks internal, unresolved, unclassified and unproven upstream errors', () => {
    for (const issues of [[], [{ source: 'source', origin: 'INTERNAL' as const, code: 'TypeError', count: 1 }],
      [{ source: 'source', origin: 'UNKNOWN' as const, code: 'EMPLOYER', count: 1 }],
      [{ source: 'source', origin: 'SOURCE' as const, code: 'HTTP_503', count: 1 }]]) {
      expect(summarizeOrchestration({ ...night, issues })).toMatchObject({ outcome: 'FAILED', executionHealthy: false });
    }
  });
  it('keeps every-source refusal major even when the source origin is proven', () => {
    expect(summarizeOrchestration({ ...night, total: 1, ok: 0 })).toMatchObject({ outcome: 'FAILED', blockingReasons: ['ALL_SOURCES_FAILED'] });
    expect(summarizeOrchestration({ ...night, total: 0, ok: 0, failed: 0, issues: [] })).toMatchObject({ outcome: 'FAILED', blockingReasons: ['NO_ACTIVE_SOURCE'] });
  });
  it('keeps an all-source failure summary on one bounded line without deleting DB evidence', () => {
    const failures = Array.from({ length: 424 }, () => 'bad source\n'.repeat(100));
    const incidents = Array.from({ length: 424 }, () => ({ source: 'source', status: 'BROKEN' as const, jobs: 0, previous: 100, note: 'x'.repeat(2000) }));
    const result = { total: 424, ok: 0, failed: 424, timedOut: 0, failures, incidents };
    const summary = summarizeOrchestration(result);
    const line = JSON.stringify(summary);
    expect(line.split('\n')).toHaveLength(1);
    expect(Buffer.byteLength(line)).toBeLessThan(8000);
    expect(summary.omittedFailures).toBe(404);
    expect(summary.incidents.broken).toBe(424);
    expect(result.incidents).toHaveLength(424);
  });
});
