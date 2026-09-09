import { describe, it, expect } from 'vitest';
import { summarizeOrchestration } from './runSummary.js';

describe('completion signal', () => {
  const night = { total: 424, ok: 423, failed: 1, timedOut: 0,
    failures: ['l-oreal-professionnel (ingest errors)'], incidents: [] };
  it('distinguishes the completed nightly run from a successful run', () => {
    expect(summarizeOrchestration(night)).toMatchObject({
      completed: true, ok: false, outcome: 'COMPLETED_WITH_ERRORS', sources: { processed: 424 },
    });
    expect(summarizeOrchestration({ ...night, ok: 420 })).toMatchObject({ completed: false, ok: false, outcome: 'INCOMPLETE' });
    expect(summarizeOrchestration({ ...night, ok: 424, failed: 0, failures: [] })).toMatchObject({ completed: true, ok: true });
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
