import { Prisma } from '@prisma/client';
import { CaptureUnavailableError, OfflineReplayError, RecordedTransportError } from '../capture/context.js';
import { ObservabilityUnavailableError } from '../observability/logger.js';
import { SourceAccessGateError } from '../connectors/accessScope.js';
import { BlockedUrlError } from './ssrf.js';
import { transportIssueCode } from './transportFailure.js';
import { HttpStatusError } from './http.js';
import { isNativeEvidenceRetention } from '../pipeline/publicationDisposition.js';
import { NATIVE_RETENTION, isQueuedIdentityIssue, type IngestionIssue } from './issueRules.js';

export * from './issueRules.js';

const nativeFailures = new WeakMap<Error, IngestionIssue>();

/** Called only after the failed native response and outcome have been persisted. */
export function attestNativeFailure(error: Error, evidence: { captureBatchId: string; rawCaptureId: string; status: number }) {
  if (!Number.isInteger(evidence.status) || evidence.status < 500 || evidence.status > 599 || !evidence.captureBatchId || !evidence.rawCaptureId)
    throw new Error('Native failure requires a captured upstream server response');
  nativeFailures.set(error, { origin: 'SOURCE', code: `HTTP_${evidence.status}`, count: 1,
    captureBatchId: evidence.captureBatchId, rawCaptureId: evidence.rawCaptureId });
}

/** A failure raised by our database client: ours, whatever the step that met it. */
export function isDatabaseFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientInitializationError || error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientValidationError;
}

export function ingestionIssue(error: unknown): IngestionIssue {
  if (error instanceof Error && nativeFailures.has(error)) return { ...nativeFailures.get(error)! };
  if (isDatabaseFailure(error)) return { origin: 'INTERNAL', code: 'DATABASE_FAILURE', count: 1 };
  if (error instanceof CaptureUnavailableError || error instanceof OfflineReplayError || error instanceof ObservabilityUnavailableError)
    return { origin: 'INTERNAL', code: error.name, count: 1 };
  // D-453: undici raises every network/TLS failure as TypeError('fetch failed', { cause }). The class
  // alone proves nothing about our code; the cause code names the failure, which stays to be investigated.
  const transport = error instanceof RecordedTransportError
    ? (error.transportCode ? `TRANSPORT_${error.transportCode}` : null) : transportIssueCode(error);
  if (transport) return { origin: 'UNKNOWN', code: transport, count: 1 };
  // Our SSRF guard refusing the DNS answer is wrapped the same way: classify the refusal itself.
  if (error instanceof TypeError && error.message === 'fetch failed' && error.cause instanceof BlockedUrlError)
    return ingestionIssue(error.cause);
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError)
    return { origin: 'INTERNAL', code: error.name, count: 1 };
  // ACCESS_SCOPE: a request outside the scope our own qualification derived — our gate, not the publisher.
  if (error instanceof SourceAccessGateError && ['ACCESS_MISSING', 'ACCESS_STALE', 'ACCESS_SUPERSEDED', 'ACCESS_SCOPE'].includes(error.code))
    return { origin: 'INTERNAL', code: error.code, count: 1 };
  // HTTP 4xx, timeouts, parsing, attribution and admission refusals can come
  // from our request/config/reader. Their message alone does not prove blame.
  return { origin: 'UNKNOWN', code: error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(error.name)
    ? error.name : 'UNCLASSIFIED_FAILURE', count: 1, ...(error instanceof HttpStatusError ? { detail: `HTTP_${error.status}` } : {}) };
}

export function addIssue(target: { issues?: IngestionIssue[] }, issue: IngestionIssue) {
  target.issues ??= [];
  const existing = target.issues.find(i => i.origin === issue.origin && i.code === issue.code);
  if (existing) existing.count += issue.count;
  else target.issues.push({ ...issue });
}

type IssueStat = { source: string; errors: number; issues?: IngestionIssue[]; held?: number; heldReasons?: Record<string, number>;
  captureBatchId?: string; completionReportHash?: string };

/**
 * The issues of each source run: its classified errors, otherwise what its health incident says.
 *
 * An incident without any error is UNKNOWN, under the code the health pass names (`ENUMERATION_NOT_PROVEN`,
 * `ENUMERATION_REFUTED`, `NATIVE_RETENTION_JUMP`) or `SOURCE_HEALTH_REGRESSION` — except an incident that holds
 * ONLY to retentions that do not block the RUN:
 *   · the postings retained on the source's own evidence (D-453 §1, D-456 §1) are attributed to the source,
 *     `SOURCE` / `NATIVE_RETENTION`, with the sealed completion report as proof;
 *   · the postings the team excluded from the perimeter (D-456 §2) are no failure of anything: no issue. They
 *     stay visible through the incident — SourceRun, alert and bilan name them as a team decision.
 * A drop of more than half that the publisher confirms itself (D-484 §2, `confirmedDrop`, set by the health pass only
 * when nothing else is wrong) is no failure either: no issue of its own, visible through its incident. Nor is a drop
 * of more than half where fewer than ten postings disappear (D-491, `minorDrop`, same condition).
 */
export function issuesFromResult(stats: IssueStat[], incidents: readonly { source: string; nonBlockingRetentionOnly?: boolean; finding?: string;
  confirmedDrop?: object; minorDrop?: object; identityDefect?: string }[]): IngestionIssue[] {
  return stats.flatMap(stat => {
    const known = stat.issues ?? [];
    const missing = Math.max(0, stat.errors - known.reduce((sum, issue) => sum + issue.count, 0));
    const own: IngestionIssue[] = [...known, ...(missing ? [{ origin: 'UNKNOWN' as const, code: 'UNCLASSIFIED_INGEST_ERRORS', count: missing }] : [])];
    const incident = incidents.find(i => i.source === stat.source);
    // D-520 : un refus d'identité mis en file ne cache pas le reste de la collecte (troncature, liste, volume, champs) :
    // le défaut que la santé y trouve reste une issue, à côté du refus (`health.ts`, `identityDefect`).
    if (own.length && own.every(isQueuedIdentityIssue) && incident?.identityDefect)
      return [...own, { origin: 'UNKNOWN' as const, code: incident.identityDefect, count: 1 }];
    if (own.length) return own;
    if (!incident) return [];
    if (!incident.nonBlockingRetentionOnly && !incident.confirmedDrop && !incident.minorDrop) return [{ origin: 'UNKNOWN' as const, code: incident.finding ?? 'SOURCE_HEALTH_REGRESSION', count: 1 }];
    const native = Object.entries(stat.heldReasons ?? {}).filter(([reason]) => isNativeEvidenceRetention(reason)).reduce((sum, [, n]) => sum + n, 0);
    return native > 0 ? [{ origin: 'SOURCE' as const, code: NATIVE_RETENTION, count: native,
      ...(stat.captureBatchId ? { captureBatchId: stat.captureBatchId } : {}),
      ...(stat.completionReportHash ? { completionReportHash: stat.completionReportHash } : {}) }] : [];
  });
}
