import { Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { bindSourceRevision } from '../connectors/sourceRevision.js';
import { effectiveSourceConfig } from '../connectors/sourceConfig.js';
import { readIdentitySource } from '../connectors/sourceIdentity.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { assertSourceRunning, sourceSignal, sourceExecutionBudget, withSourceBudget } from '../lib/sourceBudget.js';
import { assertPublicUrl } from '../lib/ssrf.js';
import { CRAWLER_IDENTITY } from '../lib/crawlerIdentity.js';
import { fetchFollowingSafely, IncompleteBodyError, readBytesBounded } from '../lib/http.js';
import { auditUrl, assertCaptureHealthy, captureResponse, requestFingerprint, withCaptureContext } from './context.js';
import { captureConfig } from './config.js';
import { captureReaderRevision } from './revision.js';
import { persistCapture, readRawBlob, storeRawBlob } from './store.js';
import type { ObjectStore } from '../retention/objectStore.js';

export type SourceEvidencePurpose = 'SOURCE_IDENTITY' | 'SOURCE_ACCESS';
const ACCEPT = 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1';
const headers = { accept: ACCEPT, 'user-agent': CRAWLER_IDENTITY };
const selection = { id: true, sequence: true, requestHash: true, requestUrl: true, method: true, format: true,
  status: true, headers: true, cookieNames: true, complete: true, failure: true, blobHash: true } as const;
type EvidenceResponse = Prisma.RawCaptureGetPayload<{ select: typeof selection }>;
type EvidenceManifest = { version: 1; purpose: SourceEvidencePurpose; batchId: string; sourceRevisionId: string;
  configHash: string; initialUrl: string; responses: EvidenceResponse[] };

function evidenceUrl(value: string): string {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid source evidence URL');
  assertPublicUrl(value);
  const url = new URL(value); url.hash = '';
  return url.toString();
}

async function evidenceResponses(db: PrismaClient, batchId: string) {
  const rows = await db.rawCapture.findMany({ where: { batchId }, select: selection, orderBy: { sequence: 'asc' }, take: 7 });
  if (!rows.length || rows.length > 6 || rows.some((r, index) => r.sequence !== index || r.method !== 'GET' ||
    r.format !== 'HTTP_RESPONSE' || !r.complete || r.status === null || r.blobHash === null || r.failure !== null)) {
    throw new Error('Source evidence requires a complete ordered HTTP journal of at most six responses');
  }
  return rows;
}

/** Verify the whole immutable journal and each native body without any network
 * fallback. Redirect bodies are verified then released; only the final body is
 * returned to the caller that will evaluate ownership or access separately. */
export async function readSourceEvidence(db: PrismaClient, batchId: string, store?: ObjectStore) {
  const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: batchId }, include: { outcome: true } });
  if (!['SOURCE_IDENTITY', 'SOURCE_ACCESS'].includes(batch.purpose) || batch.formatVersion !== 3 ||
    !batch.sourceRevisionId || batch.attemptOrdinal !== null || batch.outcome?.status !== 'SOURCE_EVIDENCE' || !batch.outcome.manifestHash) {
    throw new Error('Completed source evidence capture required');
  }
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readRawBlob(db, batch.outcome.manifestHash, store))) as EvidenceManifest;
  const rows = await evidenceResponses(db, batchId);
  if (!manifest || manifest.version !== 1 || manifest.batchId !== batch.id || manifest.purpose !== batch.purpose ||
    manifest.sourceRevisionId !== batch.sourceRevisionId || manifest.configHash !== batch.configHash ||
    evidenceHash(manifest.responses) !== evidenceHash(rows)) throw new Error('Source evidence manifest differs from its immutable journal');
  let current = evidenceUrl(manifest.initialUrl); let body: Buffer = Buffer.alloc(0);
  for (const [index, row] of rows.entries()) {
    const request = { url: current, method: 'GET', headers, format: 'HTTP_RESPONSE' as const };
    if (row.requestUrl !== auditUrl(current) || row.requestHash !== requestFingerprint(request)) throw new Error('Source evidence redirect provenance differs');
    body = await readRawBlob(db, row.blobHash!, store);
    const location = (row.headers as Record<string, unknown>).location;
    const follows = row.status! >= 300 && row.status! < 400 && typeof location === 'string' && !!location;
    if (index < rows.length - 1) {
      if (!follows) throw new Error('Source evidence has responses outside its redirect chain');
      current = evidenceUrl(new URL(location as string, current).toString());
    } else if (follows) throw new Error('Source evidence redirect chain is incomplete');
  }
  return { batch, responses: rows, finalUrl: current, body };
}

/** Archive an official-page or access-policy request. This never emits job
 * outputs, technical source qualification, identity approval or access approval. */
export async function captureSourceEvidence(db: PrismaClient, sourceKey: string, options: {
  revisionId: string; purpose: SourceEvidencePurpose; url: string; deadlineMs: number;
}, store?: ObjectStore) {
  options = Object.freeze({ ...options });
  if (!['SOURCE_IDENTITY', 'SOURCE_ACCESS'].includes(options.purpose) || !options.revisionId ||
    !Number.isSafeInteger(options.deadlineMs) || options.deadlineMs < 1 || options.deadlineMs > 2_147_483_647) throw new Error('Invalid source evidence capture request');
  const initialUrl = evidenceUrl(options.url);
  const source = await readIdentitySource(db, sourceKey);
  if (!source) throw new Error('Registered source required for evidence capture');
  const kind = KIND_TO_ATS[source.kind];
  const config = captureConfig(effectiveSourceConfig(source.config as Record<string, unknown>));
  const batch = await withSourceBudget(async () => {
    const batch = await db.$transaction(async tx => {
      const sourceRevisionId = await bindSourceRevision(tx, sourceKey, config, kind, { revisionId: options.revisionId });
      return tx.captureBatch.create({ data: { id: randomUUID(), purpose: options.purpose, sourceKey, sourceRevisionId,
        sourceKind: kind, configHash: evidenceHash(config), executionBudget: sourceExecutionBudget(),
        readerRevision: captureReaderRevision(), formatVersion: 3 } });
    });
    return withCaptureContext({ sequence: 0, observedAt: batch.startedAt, captureRedirectLocations: true,
      write: record => persistCapture(db, batch.id, record) }, async () => {
      try {
        const response = await fetchFollowingSafely(initialUrl, { method: 'GET', headers }, sourceSignal()!, async (url, response, failure) => {
          url = evidenceUrl(url);
          const request = { url, method: 'GET', headers, format: 'HTTP_RESPONSE' as const };
          if (!response) {
            await captureResponse(request, { bytes: null, complete: false, failure: failure instanceof Error ? failure.name : 'NetworkFailure' });
            return;
          }
          let bytes: Buffer;
          try { bytes = await readBytesBounded(response.clone(), url); }
          catch (error) {
            await captureResponse(request, { status: response.status, headers: response.headers,
              bytes: error instanceof IncompleteBodyError ? error.prefix : null, complete: false,
              failure: error instanceof Error ? error.name : 'BodyReadFailure' });
            throw error;
          }
          await captureResponse(request, { status: response.status, headers: response.headers, bytes, complete: true });
        });
        await response.body?.cancel();
        assertCaptureHealthy(); assertSourceRunning();
        const responses = await evidenceResponses(db, batch.id);
        const manifest: EvidenceManifest = { version: 1, purpose: options.purpose, batchId: batch.id,
          sourceRevisionId: batch.sourceRevisionId!, configHash: batch.configHash, initialUrl, responses };
        const manifestHash = await storeRawBlob(db, Buffer.from(JSON.stringify(manifest)));
        assertSourceRunning();
        await db.captureOutcome.create({ data: { batchId: batch.id, status: 'SOURCE_EVIDENCE', extractedCount: 0, manifestHash } });
        return batch;
      } catch (error) {
        // If the connection failed after committing the success receipt, its
        // immutable outcome wins; never attempt to replace it with a failure.
        await db.captureOutcome.createMany({ data: [{ batchId: batch.id, status: 'FAILED', extractedCount: 0,
          failure: error instanceof Error ? error.name : 'UnknownError' }], skipDuplicates: true });
        throw error;
      }
    });
  }, options.deadlineMs, `${sourceKey}:evidence`);
  const read = await readSourceEvidence(db, batch.id, store);
  const last = read.responses.at(-1)!;
  return { captureBatchId: batch.id, sourceRevisionId: batch.sourceRevisionId, purpose: batch.purpose,
    responseCount: read.responses.length, lastStatus: last.status, finalCaptureId: last.id };
}
