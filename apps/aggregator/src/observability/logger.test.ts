import { describe, it, expect } from 'vitest';
import { OperationalLogger, ObservabilityUnavailableError, redact, type LogRecord } from './logger.js';

function harness(persist?: (record: LogRecord) => Promise<void>) {
  let time = 1_000;
  const records: LogRecord[] = [];
  const lines: Array<{ at: number; value: any }> = [];
  const logger = new OperationalLogger({ runId: 'test-run', production: true,
    persist: persist ?? (async record => { records.push(record); }),
    now: () => time, delay: async ms => { time += ms; },
    write: async line => { expect(line).not.toContain('\n'); lines.push({ at: time, value: JSON.parse(line) }); },
  });
  return { logger, records, lines };
}

describe('durable operational logging', () => {
  it('preserves every identical error, including occurrences beyond the former first-three cap', async () => {
    const { logger, records, lines } = harness();
    await logger.withContext({ sourceKey: 'source', connectorId: 'oracle' }, async () => {
      for (let i = 0; i < 8; i++) await logger.emit('error', 'job.write_failed', { jobId: String(i), error: 'constraint violated' });
    });
    await logger.flush();
    expect(records).toHaveLength(8);
    expect(new Set(records.map(r => r.id)).size).toBe(8);
    expect(records.map(r => r.jobId)).toEqual(['0','1','2','3','4','5','6','7']);
    expect(lines).toHaveLength(2);
    expect(lines[1].value).toMatchObject({ event: 'log.repeated', occurrences: 8, sourceKey: 'source', firstEventId: records[0].id, lastEventId: records[7].id });
  });
  it('does not label different failures as repetitions', async () => {
    const { logger, records, lines } = harness();
    await logger.emit('error', 'job.write_failed', { error: 'unique conflict' });
    await logger.emit('error', 'job.write_failed', { error: 'connection lost' });
    expect(records[0].fingerprint).not.toBe(records[1].fingerprint);
    expect(lines).toHaveLength(2);
  });
  it('paces concurrent output and isolates source context and HTTP counters', async () => {
    const { logger, lines, records } = harness();
    await Promise.all(['a', 'b', 'c'].map(sourceKey => logger.withContext({ sourceKey }, async () => {
      logger.count('http.attempts');
      await logger.emit('info', 'source.started', { sourceKey });
      logger.count('http.responses');
      await logger.emit('info', 'source.completed', { http: logger.counters(sourceKey) });
    })));
    expect(lines.every((line, i) => i === 0 || line.at - lines[i - 1].at >= 25)).toBe(true);
    expect(logger.metrics.counters).toEqual({ 'http.attempts': 3, 'http.responses': 3 });
    for (const key of ['a','b','c']) expect(records.filter(r => r.sourceKey === key)).toHaveLength(2);
  });
  it('keeps the full large payload durably and emits a bounded single-line pointer', async () => {
    const { logger, lines, records } = harness();
    const report = { details: 'é\n'.repeat(5000) };
    await logger.emit('info', 'health.report', report);
    expect(records[0].payload).toEqual(report);
    expect(lines).toHaveLength(1);
    expect(lines[0].value).toMatchObject({ detailsIn: 'PipelineEvent', eventId: records[0].id });
    expect(Buffer.byteLength(JSON.stringify(lines[0].value))).toBeLessThan(6000);
  });
  it('does not write stdout before durable acknowledgement', async () => {
    let release!: () => void;
    const { logger, lines } = harness(async () => new Promise<void>(resolve => { release = resolve; }));
    const pending = logger.emit('error', 'source.failed', { error: 'ATS unavailable' });
    expect(lines).toHaveLength(0);
    release(); await pending;
    expect(lines).toHaveLength(1);
  });
  it('reconstructs the rejected event through paced emergency chunks and stops new work', async () => {
    const { logger, lines } = harness(async () => { throw new Error('database unavailable'); });
    await expect(logger.emit('error', 'source.failed', { error: 'original failure\n'.repeat(800) })).rejects.toBeInstanceOf(ObservabilityUnavailableError);
    const decoded = JSON.parse(Buffer.from(lines.map(l => l.value.data).join(''), 'base64').toString());
    expect(decoded.record.payload.error).toBe('original failure\n'.repeat(800));
    expect(decoded.persistenceError.message).toBe('database unavailable');
    expect(lines.every(l => l.value.action === 'ABORT_WORKER')).toBe(true);
    expect(() => logger.assertHealthy()).toThrow(ObservabilityUnavailableError);
    await expect(logger.emit('info', 'source.started')).rejects.toBeInstanceOf(ObservabilityUnavailableError);
    expect(logger.metrics.recorded).toBe(0);
  });
  it('disables production debug while retaining warnings and complete error causes', async () => {
    const { logger, records } = harness();
    await logger.emit('debug', 'internal.trace', { detail: 'debug' });
    await logger.emit('warn', 'source.failed', { error: new Error('outer', { cause: new Error('inner') }) });
    expect(records).toHaveLength(1);
    expect(records[0].payload.error).toMatchObject({ message: 'outer', cause: { message: 'inner' } });
    expect(logger.metrics.debugDisabled).toBe(1);
  });
  it('redacts credentials in nested objects, errors, URLs and serialized JSON responses', () => {
    const result = JSON.stringify(redact({ accessToken: 'SECRET1', error: new Error('postgresql://user:SECRET2@host/db?token=SECRET3'),
      body: '{"access_token":"SECRET4","reason":"expired"}', message: 'apiKey=SECRET5 Bearer SECRET6' }));
    expect(result).not.toMatch(/SECRET[1-6]/);
    expect(result).toContain('expired');
  });
});
