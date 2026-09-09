import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

export type Level = 'debug' | 'info' | 'warn' | 'error';
export type Context = { sourceKey?: string; connectorId?: string; jobId?: string };
export type LogRecord = Context & { id: string; runId: string; at: Date; level: Level; event: string; fingerprint: string; payload: Record<string, unknown> };
export class ObservabilityUnavailableError extends Error {
  constructor(cause: unknown) { super('Durable diagnostic journal unavailable; worker must stop', { cause }); this.name = 'ObservabilityUnavailableError'; }
}
export function redact(value: unknown, seen = new Set<object>()): unknown {
  if (typeof value === 'string' && /^[\s]*[\[{]/.test(value)) {
    try { return JSON.stringify(redact(JSON.parse(value), seen)); } catch { /* Not JSON; apply text redaction below. */ }
  }
  if (typeof value === 'string') return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:[^=&\s]*(?:token|secret|password|signature|api[_-]?key|authorization)[^=&\s]*)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\b((?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret)\s*[=:]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return { serializationNotice: 'circular reference' };
  seen.add(value);
  const input = value instanceof Error ? { ...value, name: value.name, message: value.message, stack: value.stack, cause: value.cause } : value;
  const output = Array.isArray(input) ? input.map(v => redact(v, seen)) : Object.fromEntries(Object.entries(input).map(([key, v]) => [key,
    /password|secret|authorization|cookie|private.?key|credentials|access.?token|refresh.?token|api.?key/i.test(key) ? '[REDACTED]' : redact(v, seen)]));
  seen.delete(value);
  return output;
}

type Group = { count: number; firstId: string; lastId: string; context: Context; event: string; level: Level };
export type LoggerOptions = {
  runId: string;
  persist?: (record: LogRecord) => Promise<void>;
  write?: (line: string) => Promise<void>;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
  production?: boolean;
  intervalMs?: number;
};

/** Persist each occurrence BEFORE aggregating console output. No lossy log queue. */
export class OperationalLogger {
  private contexts = new AsyncLocalStorage<Context>();
  private groups = new Map<string, Group>();
  private printing: Promise<void> = Promise.resolve();
  private lastPrinted = -Infinity;
  private failure?: ObservabilityUnavailableError;
  private now: () => number;
  private delay: (ms: number) => Promise<void>;
  private writer: (line: string) => Promise<void>;
  private interval: number;
  readonly metrics = { recorded: 0, printed: 0, repeated: 0, debugDisabled: 0, persistenceFailures: 0, byEvent: {} as Record<string, number>, counters: {} as Record<string, number> };
  private sourceCounters = new Map<string, Record<string, number>>();
  constructor(readonly options: LoggerOptions) {
    this.now = options.now ?? Date.now;
    this.delay = options.delay ?? (ms => sleep(ms));
    this.interval = options.intervalMs ?? 25;
    if (!Number.isFinite(this.interval) || this.interval < 25) throw new Error('Log spacing must be at least 25ms');
    this.writer = options.write ?? (line => new Promise<void>((resolve, reject) => process.stdout.write(line + '\n', error => error ? reject(error) : resolve())));
  }
  context() { return this.contexts.getStore() ?? {}; }
  count(name: 'http.attempts' | 'http.retries' | 'http.responses' | 'http.redirects') {
    this.metrics.counters[name] = (this.metrics.counters[name] ?? 0) + 1;
    const key = this.context().sourceKey;
    if (!key) return;
    const counters = this.sourceCounters.get(key) ?? {};
    counters[name] = (counters[name] ?? 0) + 1;
    this.sourceCounters.set(key, counters);
  }
  counters(sourceKey: string) { return { ...this.sourceCounters.get(sourceKey) }; }
  async withContext<T>(context: Context, work: () => Promise<T>): Promise<T> {
    return this.contexts.run({ ...this.context(), ...context }, work);
  }
  assertHealthy() { if (this.failure) throw this.failure; }
  private print(data: Record<string, unknown>) {
    const next = this.printing.then(async () => {
      const wait = this.lastPrinted + this.interval - this.now();
      if (wait > 0) await this.delay(wait);
      this.lastPrinted = this.now();
      await this.writer(JSON.stringify({ ...data, emittedAt: new Date(this.now()).toISOString() }));
      this.metrics.printed++;
    });
    this.printing = next;
    return next;
  }
  async emit(level: Level, event: string, ...args: unknown[]) {
    this.assertHealthy();
    if (level === 'debug' && this.options.production) { this.metrics.debugDisabled++; return; }
    if (!/^[a-z][a-z0-9_.-]+$/.test(event)) throw new Error(`Invalid log event name: ${event}`);
    const payload = redact(args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof Error)
      ? args[0] : { message: args[0], details: args.slice(1) }) as Record<string, unknown>;
    const context = { ...this.context(), ...(['sourceKey', 'connectorId', 'jobId'] as const).reduce((o, key) => {
      if (typeof payload[key] === 'string') o[key] = payload[key] as string;
      return o;
    }, {} as Context) };
    // Group only identical diagnostics. Never collapse distinct causes merely
    // because the emitter/source is the same. Job identity stays on each event.
    const { jobId: _jobId, ...diagnostic } = payload;
    const fingerprint = createHash('sha256').update(JSON.stringify({ event, level, ...context, jobId: undefined, diagnostic })).digest('hex');
    const record: LogRecord = { id: randomUUID(), runId: this.options.runId, at: new Date(this.now()), level, event, ...context, fingerprint, payload };
    try { if (this.options.persist) await this.options.persist(record); }
    catch (error) {
      this.metrics.persistenceFailures++;
      this.failure = new ObservabilityUnavailableError(error);
      // Emergency transport is explicit and paced. Preserve the rejected event
      // in reconstructible chunks, then stop; never continue unobserved.
      const encoded = Buffer.from(JSON.stringify({ record, persistenceError: redact(error) })).toString('base64');
      const chunks = Math.ceil(encoded.length / 4000);
      for (let i = 0; i < chunks; i++) await this.print({ level: 'error', message: 'observability.persistence_failed', event: 'observability.persistence_failed', runId: record.runId, eventId: record.id, chunk: i, chunks, encoding: 'base64-json', data: encoded.slice(i * 4000, (i + 1) * 4000), action: 'ABORT_WORKER' });
      throw this.failure;
    }
    this.metrics.recorded++;
    this.metrics.byEvent[event] = (this.metrics.byEvent[event] ?? 0) + 1;
    if (this.options.persist && (level === 'warn' || level === 'error')) {
      const previous = this.groups.get(fingerprint);
      if (previous) { previous.count++; previous.lastId = record.id; this.metrics.repeated++; return record.id; }
      if (this.groups.size >= 256) await this.flush(); // bounded cardinality, all occurrences remain durable
      this.groups.set(fingerprint, { count: 1, firstId: record.id, lastId: record.id, context, event, level });
    }
    const envelope = { level, event, message: event, runId: record.runId, eventId: record.id, ...context, durable: Boolean(this.options.persist) };
    const full = { ...envelope, data: payload };
    // Large summaries are queryable by eventId; stdout never prints a giant JSON document.
    if (Buffer.byteLength(JSON.stringify(full)) <= 6000) await this.print(full);
    else if (this.options.persist) await this.print({ ...envelope, payloadBytes: Buffer.byteLength(JSON.stringify(payload)), detailsIn: 'PipelineEvent', preview: JSON.stringify(payload).slice(0, 1000) });
    else {
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      const chunks = Math.ceil(encoded.length / 4000);
      for (let i = 0; i < chunks; i++) await this.print({ ...envelope, encoding: 'base64-json', chunk: i, chunks, data: encoded.slice(i * 4000, (i + 1) * 4000) });
    }
    return record.id;
  }
  async flush(sourceKey?: string) {
    for (const [key, group] of this.groups) {
      if (sourceKey !== undefined && group.context.sourceKey !== sourceKey) continue;
      this.groups.delete(key);
      if (group.count > 1) await this.print({ level: group.level, message: 'log.repeated', event: 'log.repeated', runId: this.options.runId, ...group.context, repeatedEvent: group.event, occurrences: group.count, firstEventId: group.firstId, lastEventId: group.lastId, detailsIn: 'PipelineEvent' });
    }
    await this.printing;
  }
}

let current = new OperationalLogger({ runId: `local-${randomUUID()}`, production: process.env.NODE_ENV === 'production' });
export function installLogger(logger: OperationalLogger) { current = logger; }
export const log = {
  debug: (event: string, ...args: unknown[]) => current.emit('debug', event, ...args),
  info: (event: string, ...args: unknown[]) => current.emit('info', event, ...args),
  warn: (event: string, ...args: unknown[]) => current.emit('warn', event, ...args),
  error: (event: string, ...args: unknown[]) => current.emit('error', event, ...args),
  withContext: <T>(context: Context, work: () => Promise<T>) => current.withContext(context, work),
  context: () => current.context(),
  count: (name: Parameters<OperationalLogger['count']>[0]) => current.count(name),
  counters: (sourceKey: string) => current.counters(sourceKey),
  runId: () => current.options.persist ? current.options.runId : undefined,
  assertHealthy: () => current.assertHealthy(),
  flush: (sourceKey?: string) => current.flush(sourceKey),
};
