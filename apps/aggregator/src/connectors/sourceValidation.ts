import { Prisma, type PrismaClient } from '@prisma/client';
import type { ObjectStore } from '../retention/objectStore.js';
import { fetchAtsJobs } from '../ats/index.js';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { captureExtraction, replayExtraction } from '../capture/batch.js';
import { compareExtractionResult, readExtractionManifest } from '../capture/manifest.js';
import { captureReaderRevision } from '../capture/revision.js';
import { captureConfig } from '../capture/config.js';
import { readRawBlob } from '../capture/store.js';
import { recoverRetainedPublication } from '../publication/recovery.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { effectiveSourceConfig } from './sourceConfig.js';
import { lockSourceWrites } from '../lib/writeLocks.js';
import { withSourceBudget } from '../lib/sourceBudget.js';

import { SOURCE_VALIDATION_POLICY } from './sourceCertification.js';
type RevisionPayload = { version: number; key: string; kind: string; config: Record<string, unknown> };
export type SourceValidationReport = {
  replayExact: boolean;
  enumerationClaim: 'COMPLETE' | 'INCOMPLETE' | 'UNKNOWN';
  absenceAttestation: false;
  observed: number;
  qualified: number;
  held: number;
  rejected: number;
  inputRejected: number;
  nativeEmpty: boolean;
  reasons: Record<string, number>;
};

/** An empty collector result is never sufficient. Two narrowly qualified
 * protocols require their actual, single, complete native feed to declare zero:
 * Ashby's job board API and (lot F3b) a Teamtailor JSON Feed 1.1 without a next
 * page. Other protocols remain explicit qualification work. */
async function nativeEmptyFeed(db: PrismaClient, batchId: string, kind: string, store?: ObjectStore) {
  if (!['ashby', 'teamtailor'].includes(kind)) return false;
  const rows = await db.rawCapture.findMany({ where: { batchId }, take: 2 });
  if (rows.length !== 1 || rows[0].status !== 200 || !rows[0].complete || !rows[0].blobHash) return false;
  const value = JSON.parse((await readRawBlob(db, rows[0].blobHash, store)).toString('utf8'));
  if (kind === 'ashby') return value?.apiVersion === '1' && Array.isArray(value.jobs) && value.jobs.length === 0;
  return typeof value?.version === 'string' && /^https:\/\/jsonfeed\.org\/version\/1(?:\.1)?$/.test(value.version) &&
    Array.isArray(value.items) && value.items.length === 0 && value.next_url == null;
}

/** Validate a recorded collector with today's reader. No count supplied by an
 * operator can create a validation. The record is independent of activation;
 * a later configuration transition leaves it as historical evidence only. */
export async function validateCapturedSource(db: PrismaClient, batchId: string, store?: ObjectStore) {
  const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: batchId }, include: { outcome: true } });
  if (batch.purpose !== 'JOBS' || !batch.sourceRevisionId || batch.formatVersion !== 2 || batch.outcome?.status !== 'EXTRACTED') {
    throw new Error('Source validation requires a completed registered native capture');
  }
  const [row] = await db.$queryRaw<{ payloadText: string; sourceKey: string }[]>`
    SELECT payload::text AS "payloadText", "sourceKey" FROM "SourceRevision" WHERE id=${batch.sourceRevisionId}`;
  if (!row || row.sourceKey !== batch.sourceKey) throw new Error('Capture source revision is invalid');
  const revision = JSON.parse(row.payloadText) as RevisionPayload;
  const config = captureConfig(effectiveSourceConfig(revision.config));
  const kind = KIND_TO_ATS[revision.kind];
  if (!kind || kind !== batch.sourceKind || evidenceHash(config) !== batch.configHash) throw new Error('Capture reader or settings differ from its registered revision');
  const report: SourceValidationReport = { replayExact: false, enumerationClaim: 'UNKNOWN', absenceAttestation: false, observed: batch.outcome.extractedCount,
    qualified: 0, held: 0, rejected: 0, inputRejected: 0, nativeEmpty: false, reasons: {} };
  const reason = (name: string) => { report.reasons[name] = (report.reasons[name] ?? 0) + 1; };
  const readerRevision = captureReaderRevision();
  // replayExtraction enforces every recorded request, response and output;
  // the normal transport cannot fall back to a live request on a missing page.
  try {
    await readExtractionManifest(db, batch.id, store);
    const replayed = await replayExtraction(db, batch.id, () => fetchAtsJobs(kind, config), store);
    report.replayExact = (await compareExtractionResult(db, batch.id, replayed, store)).exact;
    if (!report.replayExact) reason('REPLAY_RESULT_CHANGED');
    else {
      report.enumerationClaim = replayed.complete === true ? 'COMPLETE' : replayed.complete === false ? 'INCOMPLETE' : 'UNKNOWN';
      if (replayed.truncated || replayed.complete === false) reason('ENUMERATION_INCOMPLETE');
      if (new Set(replayed.jobs.map(job => job.externalId)).size !== replayed.jobs.length) reason('DUPLICATE_PUBLICATION_IDS');
      report.inputRejected = replayed.rejectedRows?.length ?? 0;
      if (report.inputRejected) report.reasons.REJECTED_NATIVE_ROWS = report.inputRejected;
      for (const job of replayed.jobs) {
        if (job.publicationHold || job.publicationWithdrawnAt) { report.held++; continue; }
        const recovery = recoverRetainedPublication(revision.kind, job.raw, {
          externalId: job.externalId, url: job.url, observedAt: batch.startedAt, config,
        });
        if (recovery.status === 'RECOVERABLE') report.qualified++;
        else { report.rejected++; reason(recovery.reason); }
      }
      if (!report.observed) {
        // A JSON Feed declares no total: a complete enumeration that read nothing is judged on its single archived response.
        report.nativeEmpty = replayed.complete === true && (replayed.declaredTotal === 0 || replayed.declaredTotal === undefined && replayed.jobs.length === 0) &&
          await nativeEmptyFeed(db, batch.id, revision.kind, store);
        if (!report.nativeEmpty) reason('EMPTY_FEED_NOT_NATIVELY_PROVEN');
      }
      if (report.observed && !report.qualified) reason('NO_QUALIFIED_PUBLICATION');
    }
  } catch {
    // Details remain in the capture. Do not copy exception messages containing
    // request credentials or source configuration into qualification reports.
    reason('REPLAY_OR_NATIVE_READING_FAILED');
  }
  const verdict = report.replayExact && report.rejected === 0 && Object.keys(report.reasons).length === 0 &&
    (report.qualified > 0 || report.nativeEmpty) ? 'VALIDATED' : 'REJECTED';
  return db.$transaction(async tx => {
    // Serialize completed decisions with promotion. The append sequence, not a
    // millisecond timestamp or UUID order, identifies the latest decision.
    await lockSourceWrites(tx, batch.sourceKey, true);
    await tx.$queryRaw`SELECT id FROM "Source" WHERE key=${batch.sourceKey} FOR UPDATE`;
    return tx.sourceValidation.create({ data: { sourceRevisionId: batch.sourceRevisionId!, captureBatchId: batch.id,
      readerRevision, policyVersion: SOURCE_VALIDATION_POLICY, verdict, report: report as unknown as Prisma.InputJsonValue } });
  });
}

/** Capture the currently registered settings, then validate their sealed native
 * journal offline. This records technical evidence without activating a source
 * or claiming identity, access authorization, or disappearance evidence. */
export async function captureSourceForValidation(db: PrismaClient, sourceKey: string, timeoutMs: number, store?: ObjectStore) {
  const [row] = await db.$queryRaw<{ key: string; kind: string; configText: string; currentRevisionId: string }[]>`
    SELECT key, kind, config::text AS "configText", "currentRevisionId" FROM "Source" WHERE key=${sourceKey}`;
  if (!row) throw new Error('Registered source required for native validation');
  const kind = KIND_TO_ATS[row.kind];
  if (!kind) throw new Error('Source has no supported collector');
  const config = effectiveSourceConfig(JSON.parse(row.configText));
  const result = await withSourceBudget(() => captureExtraction(db, row.key, config, undefined,
    settings => fetchAtsJobs(kind, settings), kind, { revisionId: row.currentRevisionId }), timeoutMs, row.key,
  { softTimeoutMs: Math.max(1, timeoutMs - Math.min(30_000, Math.floor(timeoutMs / 10))) });
  return validateCapturedSource(db, result.captureBatchId, store);
}
