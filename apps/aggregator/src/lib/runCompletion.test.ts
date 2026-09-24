import { describe, it, expect } from 'vitest';
import { isRunCompletion, workerOutcome, type RunCompletion } from './runCompletion.js';
import { ingestionIssue, attestNativeFailure } from './ingestionIssue.js';
import { HttpStatusError } from './http.js';
import { SourceAccessGateError } from '../connectors/accessScope.js';

const receipt: RunCompletion = { event: 'pipeline.finalized', runId: '8b13d1f0-ced1-4380-8ad5-89e33a74587d', command: 'ingest-all', status: 'COMPLETED_WITH_ERRORS' };
describe('durable completion and source attribution', () => {
  it('keeps native incidents visible while allowing a technically completed process', () => {
    expect(workerOutcome(0, receipt)).toEqual({ exitCode: 0, state: 'COMPLETED_WITH_ERRORS' });
  });
  it('never turns an interrupted child, absent terminal proof or fatal result green', () => {
    expect(workerOutcome(143, receipt)).toEqual({ exitCode: 143, state: 'FAILED' });
    expect(workerOutcome(0)).toEqual({ exitCode: 1, state: 'FAILED' });
    expect(workerOutcome(0, { ...receipt, status: 'FAILED' })).toEqual({ exitCode: 1, state: 'FAILED' });
    expect(isRunCompletion(receipt, 'ingest')).toBe(false);
    expect(isRunCompletion(receipt, 'ingest-all', 'wrong-run')).toBe(false);
    expect(isRunCompletion(receipt, 'ingest-all', receipt.runId)).toBe(true);
  });
  it('requires archived evidence instead of an HTTP label to accept upstream blame', () => {
    const error = new HttpStatusError(503, 'https://example.com/jobs');
    expect(ingestionIssue(error).origin).toBe('UNKNOWN');
    attestNativeFailure(error, { status: 503, captureBatchId: 'batch', rawCaptureId: 'raw' });
    expect(ingestionIssue(error)).toMatchObject({ origin: 'SOURCE', code: 'HTTP_503', rawCaptureId: 'raw' });
    expect(ingestionIssue(new HttpStatusError(403, 'https://example.com/jobs')).origin).toBe('UNKNOWN');
    expect(ingestionIssue(new Error('HTTP 503')).origin).toBe('UNKNOWN');
    expect(ingestionIssue(new SyntaxError('invalid native JSON')).origin).toBe('UNKNOWN');
  });
  it('blocks our code failures and a prerequisite our worker failed to maintain', () => {
    expect(ingestionIssue(new TypeError('missing field')).origin).toBe('INTERNAL');
    expect(ingestionIssue(new SourceAccessGateError('ACCESS_STALE', 'stale')).origin).toBe('INTERNAL');
    expect(ingestionIssue(new SourceAccessGateError('ACCESS_DENIED', 'refused')).origin).toBe('UNKNOWN');
  });
});
