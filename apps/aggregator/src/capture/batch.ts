import type { PrismaClient, AtsType } from '@prisma/client';
import { bindSourceRevision, type SourceBinding } from '../connectors/sourceRevision.js';
import { randomUUID } from 'node:crypto';
import { evidenceHash } from '../lib/evidenceHash.js';
import type { AdapterResult } from '../types.js';
import type { ObjectStore } from '../retention/objectStore.js';
import { assertCaptureHealthy, withCaptureContext, OfflineReplayError, type CaptureContext } from './context.js';
import { persistCapture, persistExtractionOutputs, readRawBlob } from './store.js';
import { MAX_MANIFEST_OUTPUTS, persistExtractionManifest } from './manifest.js';
import { captureConfig } from './config.js';
import { sourceExecutionBudget } from '../lib/sourceBudget.js';
import { captureReaderRevision } from './revision.js';
import { readRequestData } from './requestDataRead.js';
import { requireSourceAccess } from '../connectors/sourceAccess.js';
import { matchingAccessScope, SourceAccessGateError } from '../connectors/accessScope.js';
import { ingestionQualifications, SOURCE_ADMISSION_POLICY } from '../connectors/sourceAdmission.js';
import { lockSourceWrites } from '../lib/writeLocks.js';

export async function captureExtraction(db: PrismaClient, sourceKey: string, config: Record<string, unknown>,
  runId: string | undefined, work: (config: Record<string, unknown>) => Promise<AdapterResult>, sourceKind?: AtsType, binding?: SourceBinding): Promise<AdapterResult & { captureBatchId: string }> {
  const settings = captureConfig(config);
  const expected = binding ? Object.freeze({ ...binding }) : undefined;
  const { batch, access } = await db.$transaction(async tx => {
    // Admission writers serialize before taking the row lock. The lock is
    // released before transport; two starts cannot borrow the same validation.
    if (expected?.requireActive) {
      await lockSourceWrites(tx, sourceKey, true);
      await tx.$queryRaw`SELECT id FROM "Source" WHERE key=${sourceKey} FOR UPDATE`;
    }
    const sourceRevisionId = await bindSourceRevision(tx, sourceKey, settings, sourceKind, expected);
    const access = expected?.requireActive && sourceRevisionId
      ? await requireSourceAccess(tx, { key: sourceKey, currentRevisionId: sourceRevisionId }) : null;
    const qualifications = access ? await ingestionQualifications(tx, sourceKey) : null;
    const batch = await tx.captureBatch.create({ data: { id: randomUUID(), sourceKey, runId, sourceRevisionId, accessDecisionId: access?.decision.id,
      configHash: evidenceHash(settings), executionBudget: sourceExecutionBudget(), sourceKind, formatVersion: 2, readerRevision: captureReaderRevision() } });
    if (qualifications) await tx.sourceIngestionAdmission.create({ data: { batchId: batch.id,
      identityReviewId: qualifications.identity.id, sourceValidationId: qualifications.validation.id,
      policyVersion: SOURCE_ADMISSION_POLICY } });
    return { batch, access };
  });
  const context: CaptureContext = { sequence: 0, observedAt: batch.startedAt, write: record => persistCapture(db, batch.id, record),
    requestAccess: access ? request => {
      if (Date.now() > access.decision.validUntil!.getTime()) throw new SourceAccessGateError('ACCESS_STALE', 'Access evidence expired during collection');
      matchingAccessScope(access.document.scopes, request);
    } : undefined };
  return withCaptureContext(context, async () => {
    try {
      const result = await work(settings);
      assertCaptureHealthy();
      const evidence = await db.rawCapture.count({ where: { batchId: batch.id, complete: true, blobHash: { not: null } } });
      if (!evidence) throw new Error('Extraction has no captured native response');
      if (result.jobs.length > MAX_MANIFEST_OUTPUTS) throw new Error('Extraction exceeds its output count budget');
      const outputIds = await persistExtractionOutputs(db, batch.id, result.jobs);
      const manifestHash = await persistExtractionManifest(db, batch.id, result);
      await db.captureOutcome.create({ data: { batchId: batch.id, manifestHash, status: 'EXTRACTED', extractedCount: result.jobs.length,
        transportCoverage: context.unsupportedTransport ? 'UNSUPPORTED_TRANSPORT' : 'HTTP_ONLY',
        outputHash: evidenceHash(result.jobs) } });
      return { ...result, captureBatchId: batch.id, jobs: result.jobs.map((job, index) => ({ ...job, captureBatchId: batch.id, captureOutputId: outputIds[index] })) };
    } catch (error) {
      // Native inputs were committed before parsing and survive this failure.
      await db.captureOutcome.create({ data: { batchId: batch.id, status: 'FAILED', extractedCount: 0,
        failure: error instanceof Error ? error.name : 'UnknownError' } });
      throw error;
    }
  });
}

/** Run the same collector offline against the exact recorded native entities. */
export async function replayExtraction<T>(db: PrismaClient, batchId: string, work: () => Promise<T>, store?: ObjectStore): Promise<T> {
  const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.purpose !== 'JOBS') throw new Error('Source evidence is not a replayable job extraction');
  const captures = await db.rawCapture.findMany({ where: { batchId }, orderBy: { sequence: 'asc' } });
  if (!captures.length) throw new Error('Capture batch has no recorded responses');
  const queues = new Map<string, typeof captures>();
  for (const row of captures) {
    await readRequestData(db, row, store);
    if (!queues.has(row.requestHash)) queues.set(row.requestHash, []);
    queues.get(row.requestHash)!.push(row);
  }
  return withCaptureContext({ sequence: 0, observedAt: batch.startedAt, replay: async hash => {
    const row = queues.get(hash)?.shift();
    if (!row) throw new OfflineReplayError('Offline replay request is absent from the capture batch');
    return { ...row, bytes: row.blobHash ? await readRawBlob(db, row.blobHash, store) : null,
      headers: row.headers as Record<string, string>, cookieNames: row.cookieNames as string[] };
  } }, async () => {
    const result = await work();
    assertCaptureHealthy();
    if ([...queues.values()].some(queue => queue.length > 0)) throw new OfflineReplayError('Offline replay left recorded responses unconsumed');
    return result;
  });
}
