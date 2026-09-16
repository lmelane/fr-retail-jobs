import type { PrismaClient } from '@prisma/client';
import type { AdapterResult } from '../types.js';
import type { ObjectStore } from '../retention/objectStore.js';
import { digestBytes } from './context.js';
import { readRawBlob, storeRawBlob } from './store.js';
import { evidenceHash } from '../lib/evidenceHash.js';

export const MAX_MANIFEST_OUTPUTS = 100_000;
const selection = { ordinal: true, externalId: true, outputHash: true } as const;
type Output = { ordinal: number; externalId: string | null; outputHash: string };
type Manifest = { version: 1; batchId: string; metadata: Omit<AdapterResult, 'jobs'>; outputs: Output[] };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

async function orderedOutputs(db: PrismaClient, batchId: string) {
  const rows = await db.sourceExtraction.findMany({ where: { batchId }, select: selection,
    orderBy: { ordinal: 'asc' }, take: MAX_MANIFEST_OUTPUTS + 1 });
  if (rows.length > MAX_MANIFEST_OUTPUTS || rows.some((row, index) => row.ordinal !== index)) throw new Error('Extraction outputs exceed their budget or are not contiguous');
  return rows;
}

/** Enumeration, scope, native counts, warnings and future metadata survive even
 * an empty result. Job bodies stay in their individually bounded output blobs. */
export async function persistExtractionManifest(db: PrismaClient, batchId: string, result: AdapterResult): Promise<string> {
  const { jobs, ...metadata } = result;
  const outputs = await orderedOutputs(db, batchId);
  if (outputs.length !== jobs.length) throw new Error('Extraction manifest does not cover every produced job');
  const manifest: Manifest = { version: 1, batchId, metadata, outputs };
  return storeRawBlob(db, Buffer.from(JSON.stringify(manifest)));
}

/** The manifest is evidence of the recorded adapter result, not a certification
 * that the publisher enumeration or parsed publications were correct. */
export async function readExtractionManifest(db: PrismaClient, batchId: string, store?: ObjectStore): Promise<Manifest> {
  const outcome = await db.captureOutcome.findUniqueOrThrow({ where: { batchId } });
  if (outcome.status !== 'EXTRACTED' || !outcome.manifestHash) throw new Error('Completed extraction result manifest unavailable; no completeness certificate can be inferred');
  const value: unknown = JSON.parse((await readRawBlob(db, outcome.manifestHash, store)).toString('utf8'));
  if (!object(value) || value.version !== 1 || value.batchId !== batchId || !object(value.metadata) ||
    Object.hasOwn(value.metadata, 'jobs') || !Array.isArray(value.outputs) || value.outputs.length > MAX_MANIFEST_OUTPUTS) {
    throw new Error('Invalid extraction result manifest');
  }
  const outputs = await orderedOutputs(db, batchId);
  if (outputs.length !== outcome.extractedCount || evidenceHash(value.outputs) !== evidenceHash(outputs)) throw new Error('Extraction manifest differs from its immutable output journal');
  return value as Manifest;
}

/** Compare all produced content and all result metadata; a matching job count
 * alone cannot certify a changed scope, truncation signal or enumeration. */
export async function compareExtractionResult(db: PrismaClient, batchId: string, result: AdapterResult, store?: ObjectStore) {
  const manifest = await readExtractionManifest(db, batchId, store);
  // captureBatchId is a capture receipt added after sealing, including for an
  // empty result; it is not metadata emitted by the adapter.
  const { jobs, captureBatchId: _batchId, ...metadata } = result as AdapterResult & { captureBatchId?: string };
  const matchesRecordedOutput = jobs.length === manifest.outputs.length && jobs.every((job, index) => {
    const { captureBatchId: _batch, captureOutputId: _output, ...content } = job;
    const expected = manifest.outputs[index];
    return expected.externalId === (content.externalId ?? null) && expected.outputHash === digestBytes(JSON.stringify(content));
  });
  const matchesRecordedMetadata = evidenceHash(metadata) === evidenceHash(manifest.metadata);
  return { matchesRecordedOutput, matchesRecordedMetadata, exact: matchesRecordedOutput && matchesRecordedMetadata };
}
