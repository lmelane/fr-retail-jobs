import { assertPipelineRunning } from '../lib/pipelinePause.js';
import type { PrismaClient, AtsType } from '@prisma/client';
import { bindSourceRevision, type SourceBinding } from '../connectors/sourceRevision.js';
import { randomUUID } from 'node:crypto';
import { evidenceHash } from '../lib/evidenceHash.js';
import type { AdapterResult } from '../types.js';
import type { ObjectStore } from '../retention/objectStore.js';
import { assertCaptureHealthy, withCaptureContext, OfflineReplayError, type CaptureContext, type WafBootstrapPolicy } from './context.js';
import { persistCapture, persistExtractionOutputs, readRawBlob } from './store.js';
import { MAX_MANIFEST_OUTPUTS, persistExtractionManifest } from './manifest.js';
import { captureConfig } from './config.js';
import { sourceExecutionBudget } from '../lib/sourceBudget.js';
import { captureReaderRevision } from './revision.js';
import { readRequestData } from './requestDataRead.js';
import { requireSourceAccess } from '../connectors/sourceAccess.js';
import { matchingAccessScope, SourceAccessGateError } from '../connectors/accessScope.js';
import { assertJournaledBootstrap, bootstrapAuthorizedFor, grantedAllow, observeModeAllow } from '../connectors/wafBootstrap.js';
import { offlineReplay } from './offlineReplay.js';
import { readExtractionManifest } from './manifest.js';
import { withIncrementalReading, withoutIncrementalReading } from '../lib/incrementalReading.js';
import { ingestionQualifications, SOURCE_ADMISSION_POLICY } from '../connectors/sourceAdmission.js';
import { lockSourceWrites, SOURCE_WRITE_TRANSACTION } from '../lib/writeLocks.js';
import { HttpStatusError } from '../lib/http.js';
import { attestNativeFailure } from '../lib/ingestionIssue.js';
import { captureFailureLabel } from '../lib/transportFailure.js';
import { auditUrl } from './context.js';

export async function captureExtraction(db: PrismaClient, sourceKey: string, config: Record<string, unknown>,
  runId: string | undefined, work: (config: Record<string, unknown>) => Promise<AdapterResult>, sourceKind?: AtsType, binding?: SourceBinding): Promise<AdapterResult & { captureBatchId: string }> {
  assertPipelineRunning();
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
    // `identityReviewId` est facultatif depuis F5 : l'identité vient du registre, et c'est la
    // révision de la source — portée par le lot lui-même — qui détecte un changement en cours de collecte.
    if (qualifications) await tx.sourceIngestionAdmission.create({ data: { batchId: batch.id,
      identityReviewId: null, sourceValidationId: qualifications.validation.id,
      policyVersion: SOURCE_ADMISSION_POLICY } });
    return { batch, access };
  }, SOURCE_WRITE_TRANSACTION);
  const context: CaptureContext = { sequence: 0, observedAt: batch.startedAt, write: record => persistCapture(db, batch.id, record),
    requestAccess: access ? request => {
      if (Date.now() > access.decision.validUntil!.getTime()) throw new SourceAccessGateError('ACCESS_STALE', 'Access evidence expired during collection');
      matchingAccessScope(access.document.scopes, request);
    } : undefined,
    wafBootstrap: wafBootstrapPolicy(sourceKey, access) };
  return withCaptureContext(context, async () => {
    try {
      const result = await work(settings);
      assertCaptureHealthy();
      if (context.wafBootstrapped) {
        try { assertJournaledBootstrap(sourceKey, access ? access.document.bootstraps ?? [] : null, context.wafJournal?.challenges ?? [], context.wafJournal?.bootstrap ?? []); }
        catch (error) { throw new SourceAccessGateError('ACCESS_SCOPE', error instanceof Error ? error.message : String(error)); }
      }
      const evidence = await db.rawCapture.count({ where: { batchId: batch.id, complete: true, blobHash: { not: null } } });
      if (!evidence) throw new Error('Extraction has no captured native response');
      if (result.jobs.length > MAX_MANIFEST_OUTPUTS) throw new Error('Extraction exceeds its output count budget');
      const outputIds = await persistExtractionOutputs(db, batch.id, result.jobs);
      const manifestHash = await persistExtractionManifest(db, batch.id, result);
      await db.captureOutcome.create({ data: { batchId: batch.id, manifestHash, status: 'EXTRACTED', extractedCount: result.jobs.length,
        transportCoverage: context.unsupportedTransport ? 'UNSUPPORTED_TRANSPORT' : context.wafBootstrapped ? 'HTTP_WITH_WAF_BOOTSTRAP' : 'HTTP_ONLY',
        outputHash: evidenceHash(result.jobs) } });
      return { ...result, captureBatchId: batch.id, jobs: result.jobs.map((job, index) => ({ ...job, captureBatchId: batch.id, captureOutputId: outputIds[index] })) };
    } catch (error) {
      // Native inputs were committed before parsing and survive this failure.
      await db.captureOutcome.create({ data: { batchId: batch.id, status: 'FAILED', extractedCount: 0,
        failure: captureFailureLabel(error, 'UnknownError') } });
      // A server refusal is accepted only with an archived response to this
      // exact GET request. No classification from an error message or a 4xx.
      if (access && error instanceof HttpStatusError && error.status >= 500 && error.status <= 599) {
        const row = await db.rawCapture.findFirst({ where: { batchId: batch.id, requestUrl: auditUrl(error.url),
          status: error.status, method: 'GET', complete: true, blobHash: { not: null }, failure: null }, orderBy: { sequence: 'desc' } });
        if (row) {
          const request = await readRequestData(db, row);
          if (request?.origin === 'HTTP_TRANSPORT' && request.hops.some(hop =>
            hop.request.url === error.url && hop.request.method === 'GET' && hop.status === error.status))
            attestNativeFailure(error, { captureBatchId: batch.id, rawCaptureId: row.id, status: error.status });
        }
      }
      throw error;
    }
  });
}

/**
 * D-483 — qui peut amorcer un défi AWS dans cette collecte. Une source hors de la liste nommée : personne (le défi
 * n'est pas amorcé, la collecte échoue sur `WafChallengeError`, sans navigateur — y compris en qualification, où
 * l'amorçage partait jusqu'ici hors journal). Sans décision d'accès (collecte de qualification) : l'adresse défiée et
 * l'infrastructure du défi, que la dérivation observera. Sous décision (RUN) : la décision doit déclarer l'amorçage
 * de cette origine, et le navigateur ne joint que les hôtes du défi qu'elle nomme — sinon la collecte s'arrête.
 */
export function wafBootstrapPolicy(sourceKey: string, access: Awaited<ReturnType<typeof requireSourceAccess>> | null): WafBootstrapPolicy {
  return url => {
    const origin = new URL(url).origin;
    if (!bootstrapAuthorizedFor(sourceKey, origin)) return null;
    if (!access) return { allow: observeModeAllow(url) };
    if (Date.now() > access.decision.validUntil!.getTime()) throw new SourceAccessGateError('ACCESS_STALE', 'Access evidence expired during collection');
    const grant = access.document.bootstraps?.find(item => item.origin === origin);
    if (!grant) throw new SourceAccessGateError('ACCESS_SCOPE', 'WAF bootstrap is outside the reviewed access decision');
    return { allow: grantedAllow(url, grant) };
  };
}

/** Run the same collector offline against the exact recorded native entities. */
export async function replayExtraction<T>(db: PrismaClient, batchId: string, work: () => Promise<T>, store?: ObjectStore): Promise<T> {
  const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: batchId }, include: { outcome: true } });
  if (batch.purpose !== 'JOBS') throw new Error('Source evidence is not a replayable job extraction');
  const captures = await db.rawCapture.findMany({ where: { batchId }, orderBy: { sequence: 'asc' } });
  if (!captures.length) throw new Error('Capture batch has no recorded responses');
  const rows = [];
  for (const row of captures) rows.push({ ...row, data: await readRequestData(db, row, store) });
  // Historical extractions whose bootstrap was never journaled keep the historical archive token (D-483).
  const legacyBootstrap = batch.outcome?.transportCoverage === 'UNSUPPORTED_TRANSPORT' ||
    (batch.outcome?.status === 'EXTRACTED' && batch.outcome.transportCoverage === null);
  const { context, left } = offlineReplay(rows, async row => ({ ...row, bytes: row.blobHash ? await readRawBlob(db, row.blobHash, store) : null,
    headers: row.headers as Record<string, string>, cookieNames: row.cookieNames as string[] }), { observedAt: batch.startedAt, legacyBootstrap });
  /**
   * D-517 : une lecture incrémentale a décidé, publication par publication, de ne pas lire ce qui était déjà connu. Le
   * rejeu rétablit l'ensemble que son manifeste scellé nomme (`knownSkipped`) et refait donc les mêmes choix ; toute
   * autre capture est rejouée SANS lecture incrémentale, même appelée depuis une lecture en cours.
   */
  const sealed = batch.outcome?.status === 'EXTRACTED' && batch.outcome.manifestHash
    ? (await readExtractionManifest(db, batchId, store)).metadata.incremental : undefined;
  const replay = () => withCaptureContext(context, async () => {
    const result = await work();
    assertCaptureHealthy();
    if (left()) throw new OfflineReplayError('Offline replay left recorded responses unconsumed');
    return result;
  });
  if (sealed === undefined || sealed === null) return withoutIncrementalReading(replay);
  if (!Array.isArray(sealed.knownSkipped) || sealed.knownSkipped.some(id => typeof id !== 'string' || !id))
    throw new OfflineReplayError('Incremental reading without a readable sealed known set');
  return withIncrementalReading(sealed.knownSkipped, replay);
}
