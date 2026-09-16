import { gzip as gzipCallback, gunzip as gunzipCallback } from 'node:zlib';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { NormalizedJob } from '../types.js';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { ObjectStore } from '../retention/objectStore.js';
import { digestBytes, type CaptureRecord } from './context.js';
import { validateRequestData } from './requestData.js';

const gzip = promisify(gzipCallback), gunzip = promisify(gunzipCallback);
export const MAX_CAPTURE_BYTES = 20_000_000;

export async function storeRawBlob(db: PrismaClient, bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > MAX_CAPTURE_BYTES) throw new Error('Capture exceeds the bounded body size');
  const hash = digestBytes(bytes);
  const payload = await gzip(bytes, { level: 6 });
  await db.$transaction(tx => ensureBlob(tx, hash, bytes.byteLength, payload));
  return hash;
}

async function ensureBlob(tx: Prisma.TransactionClient, hash: string, byteLength: number, payload: Buffer) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`raw-blob:${hash}`}, 0))`;
  const existing = await tx.rawBlob.findUnique({ where: { hash }, select: { byteLength: true, gzipHash: true, gzipLength: true, body: { select: { hash: true } } } });
  if (!existing) {
    await tx.rawBlob.create({ data: { hash, byteLength, gzipHash: digestBytes(payload), gzipLength: payload.byteLength,
      body: { create: { gzip: new Uint8Array(payload) } } } });
  } else {
    if (existing.byteLength !== byteLength) throw new Error('Raw blob identity conflict');
    // Freshly observed identical content becomes hot again; never rely on a
    // previous capture's optional archive client or replace its immutable codec identity.
    if (!existing.body) {
      if (existing.gzipLength !== payload.byteLength || existing.gzipHash !== digestBytes(payload)) throw new Error('Recaptured raw blob compression identity differs');
      await tx.rawBlobBody.create({ data: { hash, gzip: new Uint8Array(payload) } });
    }
  }
}

export async function persistCapture(db: PrismaClient, batchId: string, record: CaptureRecord): Promise<void> {
  const { bytes, requestData, ...metadata } = record;
  validateRequestData(requestData);
  const requestBytes = Buffer.from(JSON.stringify(requestData));
  const requestDataHash = digestBytes(requestBytes);
  const hash = bytes === null ? null : digestBytes(bytes);
  if (bytes && bytes.byteLength > MAX_CAPTURE_BYTES) throw new Error('Capture exceeds the bounded body size');
  const blobs = await Promise.all([requestBytes, ...(bytes !== null ? [bytes] : [])].map(async value =>
    ({ hash: digestBytes(value), length: value.byteLength, payload: await gzip(value, { level: 6 }) })));
  await db.$transaction(async tx => {
    for (const blob of [...new Map(blobs.map(blob => [blob.hash, blob])).values()].sort((a, b) => a.hash.localeCompare(b.hash))) {
      await ensureBlob(tx, blob.hash, blob.length, blob.payload);
    }
    await tx.rawCapture.create({ data: { ...metadata, batchId, blobHash: hash, requestDataHash,
      headers: metadata.headers as Prisma.InputJsonObject, cookieNames: metadata.cookieNames } });
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function readRawBlob(db: Pick<Prisma.TransactionClient, 'rawBlob'>, hash: string, store?: ObjectStore): Promise<Buffer> {
  const blob = await db.rawBlob.findUniqueOrThrow({ where: { hash }, include: { body: true, archive: true } });
  let compressed: Uint8Array;
  if (blob.body) compressed = blob.body.gzip;
  else {
    if (!blob.archive || !store || store.uri(blob.archive.objectKey) !== blob.archive.uri) throw new Error('Verified raw archive location unavailable');
    compressed = await store.get(blob.archive.objectKey);
  }
  if (compressed.byteLength !== blob.gzipLength || digestBytes(compressed) !== blob.gzipHash) throw new Error('Raw archive compressed integrity mismatch');
  const bytes = await gunzip(compressed, { maxOutputLength: MAX_CAPTURE_BYTES });
  if (bytes.byteLength !== blob.byteLength || digestBytes(bytes) !== hash) throw new Error('Raw archive content integrity mismatch');
  return bytes;
}

/** Save bounded batches in a consistent lock order; identical outputs share bytes, never attestations. */
export async function persistExtractionOutputs(db: PrismaClient, batchId: string, jobs: NormalizedJob[]): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; offset < jobs.length; offset += 25) {
    const rows = await Promise.all(jobs.slice(offset, offset + 25).map(async (job, index) => {
      const { captureBatchId: _batch, captureOutputId: _output, ...output } = job;
      const bytes = Buffer.from(JSON.stringify(output));
      if (bytes.byteLength > MAX_CAPTURE_BYTES) throw new Error('Extraction output exceeds the bounded size');
      return { id: randomUUID(), batchId, ordinal: offset + index, externalId: job.externalId ?? null,
        hash: digestBytes(bytes), byteLength: bytes.byteLength, payload: await gzip(bytes, { level: 6 }) };
    }));
    await db.$transaction(async tx => {
      for (const row of [...new Map(rows.map(row => [row.hash, row])).values()].sort((a, b) => a.hash.localeCompare(b.hash))) {
        await ensureBlob(tx, row.hash, row.byteLength, row.payload);
      }
      await tx.sourceExtraction.createMany({ data: rows.map(({ id, batchId, ordinal, externalId, hash }) =>
        ({ id, batchId, ordinal, externalId, outputHash: hash })) });
    }, { maxWait: 10_000, timeout: 30_000 });
    ids.push(...rows.map(row => row.id));
  }
  return ids;
}

/** Upload, read back and verify every byte before recording the immutable pointer and removing hot bytes. */
export async function archiveRawBlob(db: PrismaClient, hash: string, store: ObjectStore, cutoff?: Date): Promise<{ purged: boolean }> {
  const blob = await db.rawBlob.findUniqueOrThrow({ where: { hash }, include: { body: true, archive: true } });
  if (!blob.body) { await readRawBlob(db, hash, store); return { purged: false }; }
  await readRawBlob(db, hash);
  const objectKey = `raw/v1/sha256/${hash.slice(0, 2)}/${hash}.gz`;
  const uri = store.uri(objectKey);
  if (blob.archive && (blob.archive.objectKey !== objectKey || blob.archive.uri !== uri)) throw new Error('Raw archive destination differs from its recorded location');
  await store.put(objectKey, blob.body.gzip, 'application/gzip');
  const restored = await store.get(objectKey);
  if (restored.byteLength !== blob.gzipLength || digestBytes(restored) !== blob.gzipHash) throw new Error('Remote raw archive verification failed');
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`raw-blob:${hash}`}, 0))`;
    if (cutoff) {
      const recent = await tx.rawBlob.count({ where: { hash, OR: [
        { captures: { some: { capturedAt: { gte: cutoff } } } },
        { requestCaptures: { some: { capturedAt: { gte: cutoff } } } },
        { observations: { some: { observedAt: { gte: cutoff } } } },
        { extractions: { some: { capturedAt: { gte: cutoff } } } },
        { manifests: { some: { completedAt: { gte: cutoff } } } },
      ] } });
      if (recent) return { purged: false };
    }
    await tx.rawBlobArchive.createMany({ data: [{ hash, objectKey, uri, gzipHash: blob.gzipHash }], skipDuplicates: true });
    const pointer = await tx.rawBlobArchive.findUniqueOrThrow({ where: { hash } });
    if (pointer.uri !== uri || pointer.gzipHash !== blob.gzipHash || pointer.objectKey !== objectKey) throw new Error('Raw archive pointer mismatch');
    return { purged: (await tx.rawBlobBody.deleteMany({ where: { hash } })).count === 1 };
  });
}
