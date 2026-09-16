import { Prisma, type PrismaClient, type SourceAccessDecision } from '@prisma/client';
import { captureReaderRevision } from '../capture/revision.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { OWNER_DECISION_AT, OWNER_DECISION_SCOPE } from '../lib/accessDecision.js';
import { lockSourceWrites } from '../lib/writeLocks.js';
import type { ObjectStore } from '../retention/objectStore.js';
import { readIdentitySource } from './sourceRegistryRead.js';
import { inspectSourceAccess, type AccessEvidenceReport } from './sourceAccessEvidence.js';
import { invalidAccess, parseAccessDocument, SourceAccessGateError, SOURCE_ACCESS_POLICY, type AccessDocument } from './accessScope.js';

type Subject = { key: string; currentRevisionId: string };
const observationKeys = ['ALLOWED', 'DISALLOWED', 'NO_ROBOTS', 'UNREACHABLE'] as const;
function observedCount(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4) return -1;
  const counts = observationKeys.map(key => (value as Record<string, unknown>)[key]);
  return counts.every(count => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
    ? (counts as number[]).reduce((sum, count) => sum + count, 0) : -1;
}
export function assertSourceAccess(source: Subject, decision: SourceAccessDecision | null, now = new Date()) {
  if (!decision) throw new SourceAccessGateError('ACCESS_MISSING', 'Current source access decision required');
  if (decision.sourceKey !== source.key || decision.sourceRevisionId !== source.currentRevisionId) throw new SourceAccessGateError('ACCESS_STALE', 'Access decision belongs to another source revision');
  if (decision.verdict !== 'ALLOWED') throw new SourceAccessGateError('ACCESS_DENIED', 'Latest access decision does not authorize collection');
  if (decision.sourceKey !== source.key || decision.sourceRevisionId !== source.currentRevisionId ||
    decision.policyVersion !== SOURCE_ACCESS_POLICY || decision.readerRevision !== captureReaderRevision() ||
    !decision.validUntil || decision.validUntil.getTime() < now.getTime()) throw new SourceAccessGateError('ACCESS_STALE', 'Access decision must be renewed for the current source revision, reader and evidence');
  const document = parseAccessDocument(decision.document, now);
  const report = decision.report as AccessEvidenceReport | null;
  if (decision.id !== `access-review:${evidenceHash(document)}` || decision.sequence <= 0n || document.sourceKey !== source.key ||
    document.sourceRevisionId !== source.currentRevisionId || document.verdict !== decision.verdict || document.captureBatchId !== decision.captureBatchId ||
    Date.parse(document.checkedAt) !== decision.checkedAt.getTime() || !report || report.policy !== decision.policyVersion ||
    report.readerRevision !== decision.readerRevision || report.sourceKey !== source.key || report.sourceRevisionId !== source.currentRevisionId ||
    report.captureBatchId !== decision.captureBatchId || report.validUntil !== decision.validUntil.toISOString() ||
    report.authorizationBasis !== 'OWNER_SECTOR_AUTHORIZATION' || report.ownerDecisionScope !== OWNER_DECISION_SCOPE || report.ownerDecisionAt !== OWNER_DECISION_AT ||
    !/^[a-f0-9]{64}$/.test(report.requestSetHash) || !Number.isSafeInteger(report.captureCount) || report.captureCount < 1 ||
    !Number.isSafeInteger(report.requestCount) || report.requestCount < report.captureCount || report.requestCount > 100_000 ||
    !Array.isArray(report.scopeCounts) || report.scopeCounts.length !== document.scopes.length || report.scopeCounts.some(count => !Number.isSafeInteger(count) || count < 1) ||
    report.scopeCounts.reduce((sum, count) => sum + count, 0) !== report.requestCount ||
    !Array.isArray(report.robots) || report.robots.length !== document.robotsCaptureIds.length ||
    observedCount(report.observations) !== report.requestCount ||
    new Set(report.robots.map(item => item?.origin)).size !== report.robots.length ||
    report.robots.some((item, i) => !item || item.captureBatchId !== document.robotsCaptureIds[i] || observedCount(item.observations) < 1) ||
    observationKeys.some(key => report.robots.reduce((sum, item) => sum + item.observations[key], 0) !== report.observations[key])) return invalidAccess('Stored access decision differs from its bound document and native projection');
  return { decision, document };
}

/** The latest decision wins, including a denial; never search for an older grant. */
export async function requireSourceAccess(db: Prisma.TransactionClient, source: Subject, now = new Date()) {
  const decision = await db.sourceAccessDecision.findFirst({ where: { sourceKey: source.key }, orderBy: { sequence: 'desc' } });
  return assertSourceAccess(source, decision, now);
}

/** DISTINCT ON executes in PostgreSQL: reports never load the full decision
 * history into the application just to discard earlier reviews. */
export async function readLatestSourceAccess(db: Prisma.TransactionClient, sourceKeys: string[]) {
  if (!sourceKeys.length) return new Map<string, SourceAccessDecision>();
  const rows = await db.$queryRaw<SourceAccessDecision[]>`
    SELECT DISTINCT ON ("sourceKey") * FROM "SourceAccessDecision"
    WHERE "sourceKey"=ANY(${sourceKeys}::text[]) ORDER BY "sourceKey",sequence DESC`;
  return new Map(rows.map(row => [row.sourceKey, row]));
}

export function accessStatus(source: Subject, decision: SourceAccessDecision | null) {
  try {
    const valid = assertSourceAccess(source, decision);
    const report = valid.decision.report as AccessEvidenceReport;
    return { passed: true, code: null as string | null, decisionId: decision!.id, revisionBound: true,
      validUntil: decision!.validUntil, observations: report.observations };
  } catch (error) {
    if (!(error instanceof SourceAccessGateError)) throw error;
    return { passed: false, code: error.code as string | null, decisionId: decision?.id ?? null, revisionBound: true,
      validUntil: decision?.validUntil ?? null, observations: null };
  }
}

/** Native inspection outside registry locks; the exact source revision is checked
 * again when appending. A retry cannot jump ahead of an intervening denial. */
export async function recordSourceAccessDecision(db: PrismaClient, input: unknown, apply = false, store?: ObjectStore) {
  const document = parseAccessDocument(input);
  const source = await readIdentitySource(db, document.sourceKey);
  if (!source || source.currentRevisionId !== document.sourceRevisionId) return invalidAccess('Access review requires the current registered source revision');
  const report = document.verdict === 'ALLOWED' ? await inspectSourceAccess(db, document, store) : null;
  const id = `access-review:${evidenceHash(document)}`;
  return db.$transaction(async tx => {
    await lockSourceWrites(tx, document.sourceKey, true);
    const current = await readIdentitySource(tx, document.sourceKey, true);
    if (!current || current.currentRevisionId !== document.sourceRevisionId) return invalidAccess('Source changed while access evidence was inspected');
    const data = { id, sourceKey: document.sourceKey, sourceRevisionId: document.sourceRevisionId, captureBatchId: document.captureBatchId,
      verdict: document.verdict, policyVersion: SOURCE_ACCESS_POLICY, readerRevision: captureReaderRevision(),
      document: document as unknown as Prisma.InputJsonValue, report: report ? report as unknown as Prisma.InputJsonValue : Prisma.DbNull,
      checkedAt: new Date(document.checkedAt), validUntil: report ? new Date(report.validUntil) : null };
    let written = 0;
    if (apply && !await tx.sourceAccessDecision.findUnique({ where: { id }, select: { id: true } })) {
      await tx.sourceAccessDecision.create({ data }); written = 1;
    }
    const latest = apply ? await tx.sourceAccessDecision.findFirst({ where: { sourceKey: current.key }, orderBy: { sequence: 'desc' }, select: { id: true } }) : null;
    return { sourceKey: current.key, sourceRevisionId: current.currentRevisionId, decisionId: id, verdict: document.verdict,
      captureBatchId: document.captureBatchId, requestCount: report?.requestCount ?? 0, observations: report?.observations ?? null,
      validUntil: report?.validUntil ?? null, written, isLatestDecision: apply ? latest?.id === id : null };
  });
}
