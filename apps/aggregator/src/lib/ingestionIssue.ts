import { Prisma } from '@prisma/client';
import { CaptureUnavailableError, OfflineReplayError } from '../capture/context.js';
import { ObservabilityUnavailableError } from '../observability/logger.js';
import { SourceAccessGateError } from '../connectors/accessScope.js';

/** Attribution is independent of impact. Unknown is never accepted as upstream. */
export type IngestionIssue = {
  origin: 'SOURCE' | 'INTERNAL' | 'UNKNOWN';
  code: string;
  count: number;
  captureBatchId?: string;
  rawCaptureId?: string;
};
const nativeFailures = new WeakMap<Error, IngestionIssue>();

/** Called only after the failed native response and outcome have been persisted. */
export function attestNativeFailure(error: Error, evidence: { captureBatchId: string; rawCaptureId: string; status: number }) {
  if (!Number.isInteger(evidence.status) || evidence.status < 500 || evidence.status > 599 || !evidence.captureBatchId || !evidence.rawCaptureId)
    throw new Error('Native failure requires a captured upstream server response');
  nativeFailures.set(error, { origin: 'SOURCE', code: `HTTP_${evidence.status}`, count: 1,
    captureBatchId: evidence.captureBatchId, rawCaptureId: evidence.rawCaptureId });
}

export function ingestionIssue(error: unknown): IngestionIssue {
  if (error instanceof Error && nativeFailures.has(error)) return { ...nativeFailures.get(error)! };
  if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientInitializationError || error instanceof Prisma.PrismaClientRustPanicError ||
      error instanceof Prisma.PrismaClientValidationError)
    return { origin: 'INTERNAL', code: 'DATABASE_FAILURE', count: 1 };
  if (error instanceof CaptureUnavailableError || error instanceof OfflineReplayError || error instanceof ObservabilityUnavailableError)
    return { origin: 'INTERNAL', code: error.name, count: 1 };
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError)
    return { origin: 'INTERNAL', code: error.name, count: 1 };
  if (error instanceof SourceAccessGateError && ['ACCESS_MISSING', 'ACCESS_STALE', 'ACCESS_SUPERSEDED'].includes(error.code))
    return { origin: 'INTERNAL', code: error.code, count: 1 };
  // HTTP 4xx, timeouts, parsing, attribution and admission refusals can come
  // from our request/config/reader. Their message alone does not prove blame.
  return { origin: 'UNKNOWN', code: error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(error.name)
    ? error.name : 'UNCLASSIFIED_FAILURE', count: 1 };
}

export function addIssue(target: { issues?: IngestionIssue[] }, issue: IngestionIssue) {
  target.issues ??= [];
  const existing = target.issues.find(i => i.origin === issue.origin && i.code === issue.code);
  if (existing) existing.count += issue.count;
  else target.issues.push({ ...issue });
}

export function issuesFromResult(stats: { errors: number; issues?: IngestionIssue[] }[], healthIncidents: number): IngestionIssue[] {
  const issues = stats.flatMap(stat => {
    const known = stat.issues ?? [];
    const missing = Math.max(0, stat.errors - known.reduce((sum, issue) => sum + issue.count, 0));
    return [...known, ...(missing ? [{ origin: 'UNKNOWN' as const, code: 'UNCLASSIFIED_INGEST_ERRORS', count: missing }] : [])];
  });
  if (healthIncidents && !issues.length) issues.push({ origin: 'UNKNOWN', code: 'SOURCE_HEALTH_REGRESSION', count: 1 });
  return issues;
}
