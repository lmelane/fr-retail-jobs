import { Prisma, type PrismaClient } from '@prisma/client';
import { PIPELINE_VERSION } from '../pipeline/version.js';
import { digestBytes } from './context.js';
import { storeRawBlob, readRawBlob, archiveRawBlob } from './store.js';
import { objectStoreConfigured, objectStoreFromEnv, type ObjectStore } from '../retention/objectStore.js';
import { evidenceHash } from '../lib/evidenceHash.js';

/** Adapter output is a derived observation. Commit it before the job transaction. */
export async function archiveAdapterOutput(db: Prisma.TransactionClient, input: {
  sourceKey: string; externalId: string; url?: string; raw?: unknown; captureBatchId?: string; captureOutputId?: string; publicationHold?: string;
}) {
  if (Boolean(input.captureBatchId) !== Boolean(input.captureOutputId)) throw new Error('Adapter output requires both batch and output provenance');
  if (input.captureBatchId) {
    const batch = await db.captureBatch.findUnique({ where: { id: input.captureBatchId }, include: { outcome: true } });
    if (!batch || batch.sourceKey !== input.sourceKey || batch.outcome?.status !== 'EXTRACTED') throw new Error('Adapter output refers to an invalid capture batch');
    const output = await db.sourceExtraction.findUnique({ where: { id: input.captureOutputId! } });
    if (!output || output.batchId !== batch.id || output.externalId !== input.externalId) throw new Error('Adapter output refers to another captured job');
    const captured = JSON.parse((await readRawBlob(db, output.outputHash,
      objectStoreConfigured() ? objectStoreFromEnv() : undefined)).toString('utf8')) as { raw?: unknown; url?: string };
    if (evidenceHash(captured.raw ?? null) !== evidenceHash(input.raw ?? null) || input.url !== undefined && input.url !== captured.url) {
      throw new Error('Adapter RAW or application URL differs from the captured output');
    }
  }
  if (input.raw === undefined || input.raw === null) return;
  const contentHash = digestBytes(JSON.stringify(input.raw));
  const annotationHash = input.publicationHold ? digestBytes(JSON.stringify({ publicationHold: input.publicationHold })) : '';
  await db.sourceObservation.createMany({
    data: [{ sourceKey: input.sourceKey, externalId: input.externalId, contentHash, raw: input.raw as Prisma.InputJsonValue,
      pipelineVersion: PIPELINE_VERSION, captureBatchId: input.captureBatchId, captureOutputId: input.captureOutputId,
      publicationHold: input.publicationHold, annotationHash }], skipDuplicates: true,
  });
}

/** Read an adapter observation through one path, whether its payload is inline or archived. */
export async function readAdapterObservation(db: PrismaClient, id: string, store?: ObjectStore) {
  const row = await db.sourceObservation.findUniqueOrThrow({ where: { id } });
  if (row.raw !== null) return row;
  if (!row.rawBlobHash) throw new Error('Observation payload is missing and has no archive pointer');
  return { ...row, raw: JSON.parse((await readRawBlob(db, row.rawBlobHash, store)).toString('utf8')) as Prisma.JsonValue };
}

/** Preserve observation identity and batch provenance; only move its payload. */
export async function archiveAdapterObservation(db: PrismaClient, id: string, store: ObjectStore, cutoff?: Date) {
  let row = await db.sourceObservation.findUniqueOrThrow({ where: { id } });
  if (!row.rawBlobHash) {
    if (row.raw === null) throw new Error('Historical observation has no recoverable payload');
    const rawBlobHash = await storeRawBlob(db, Buffer.from(JSON.stringify(row.raw)));
    // New evidence is durable before changing the older representation. A lost
    // remote upload leaves verified hot blob bytes available through the reader.
    await db.sourceObservation.updateMany({ where: { id, rawBlobHash: null, raw: { equals: row.raw as Prisma.InputJsonValue } },
      data: { rawBlobHash, raw: Prisma.DbNull } });
    row = await db.sourceObservation.findUniqueOrThrow({ where: { id } });
    if (row.rawBlobHash !== rawBlobHash) throw new Error('Observation changed during payload transfer');
  }
  return archiveRawBlob(db, row.rawBlobHash!, store, cutoff);
}
