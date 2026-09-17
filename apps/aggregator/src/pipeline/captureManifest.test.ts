import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { captureExtraction, replayExtraction } from '../capture/batch.js';
import { compareExtractionResult, readExtractionManifest } from '../capture/manifest.js';
import { archiveRawBlob, persistCapture, storeRawBlob } from '../capture/store.js';
import { describeRequest, requestFingerprint } from '../capture/context.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { fetchJson } from '../lib/http.js';
import { MemoryStore } from '../test/memoryObjectStore.js';
import { applyRetention, planRetention } from '../retention/retention.js';
import type { AdapterResult } from '../types.js';

const db = new PrismaClient();
const url = 'https://manifest.example.com/jobs';
const key = () => `manifest-${randomUUID()}`;
const result: AdapterResult = {
  jobs: [{ externalId: '1', title: 'Client Advisor', url: `${url}/1`, raw: { id: '1', native: 'first' } },
    { externalId: '2', title: 'Store Manager', url: `${url}/2`, raw: { id: '2', native: 'second' } }],
  complete: false, truncated: true, declaredTotal: 3,
  enumeration: { method: 'fixture', endpoint: url, pages: 1, rawCount: 3, termination: 'partial',
    scopes: [{ scope: 'FR', declaredTotal: 3, uniqueIds: 2, pages: 1, complete: false }], blockers: ['missing-page'] },
  rejectedRows: [{ reason: 'missing-id', raw: { native: 'third' } }],
};
const read = async (value = result) => { await fetchJson(url); return structuredClone(value); };
async function capture(value = result) {
  const native = JSON.stringify({ native: 'listing', unique: key() });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(native)));
  const sourceKey = key();
  const live = await captureExtraction(db, sourceKey, {}, undefined, () => read(value));
  const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey }, include: { outcome: true, captures: true } });
  return { live, batch };
}
async function openBatch(formatVersion = 2) {
  return db.captureBatch.create({ data: { sourceKey: key(), configHash: 'fixture', readerRevision: 'fixture', formatVersion } });
}
const receipt = (complete = true) => ({ sequence: 0, requestHash: requestFingerprint({ url, headers: { accept: 'application/json' }, format: 'HTTP_RESPONSE' }),
  requestUrl: url, method: 'GET', format: 'HTTP_RESPONSE' as const, status: 200, headers: {}, cookieNames: [],
  requestData: { version: 1 as const, logical: describeRequest({ url, headers: { accept: 'application/json' }, format: 'HTTP_RESPONSE' }), origin: 'UNOBSERVED_TRANSPORT' as const, hops: [] },
  complete, failure: complete ? null : 'interrupted', bytes: Buffer.from('{}') });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => db.$disconnect());

describe('complete extraction result evidence', () => {
  it('preserves result metadata and unknown future fields without duplicating job bodies', async () => {
    const value = { ...result, futureEvidence: { nativeScopes: ['FR', 'US'], uncertainty: null } };
    const { live, batch } = await capture(value);
    expect(batch.formatVersion).toBe(2);
    const manifest = await readExtractionManifest(db, batch.id);
    const { jobs, ...metadata } = value;
    expect(manifest.metadata).toEqual(metadata);
    expect(manifest.outputs.map(row => row.externalId)).toEqual(['1', '2']);
    expect(JSON.stringify(manifest)).not.toContain('Client Advisor');
    expect(await compareExtractionResult(db, batch.id, live)).toEqual({ matchesRecordedOutput: true, matchesRecordedMetadata: true, exact: true });
    const network = vi.fn(async () => { throw new Error('Offline only'); }); vi.stubGlobal('fetch', network);
    const replayed = await replayExtraction(db, batch.id, () => read(value));
    expect((await compareExtractionResult(db, batch.id, replayed)).exact).toBe(true);
    expect(network).not.toHaveBeenCalled();
  });

  it('keeps explicit complete zero distinct from unknown empty and truncated empty', async () => {
    const value = { jobs: [], complete: true, declaredTotal: 0, enumeration: {
      method: 'fixture', endpoint: url, pages: 1, rawCount: 0, termination: 'exhausted' } };
    const { batch, live } = await capture(value);
    expect(live.captureBatchId).toBe(batch.id);
    expect((await readExtractionManifest(db, batch.id)).metadata).not.toHaveProperty('captureBatchId');
    expect((await compareExtractionResult(db, batch.id, live)).exact).toBe(true);
    expect((await readExtractionManifest(db, batch.id)).outputs).toEqual([]);
    expect((await compareExtractionResult(db, batch.id, value)).exact).toBe(true);
    for (const changed of [{ jobs: [] }, { ...value, complete: false, truncated: true }]) {
      expect(await compareExtractionResult(db, batch.id, changed)).toEqual({ matchesRecordedOutput: true, matchesRecordedMetadata: false, exact: false });
    }
  });

  it.each(['complete', 'declaredTotal', 'scope', 'rejectedRows', 'body', 'order', 'count'])(
    'rejects a changed %s even if the collector consumed the same native response', async field => {
      const { batch } = await capture(); const changed = structuredClone(result);
      if (field === 'complete') changed.complete = true;
      if (field === 'declaredTotal') changed.declaredTotal = 2;
      if (field === 'scope') changed.enumeration!.scopes![0].scope = 'US';
      if (field === 'rejectedRows') changed.rejectedRows = [];
      if (field === 'body') changed.jobs[0].raw = { id: '1', native: 'altered' };
      if (field === 'order') changed.jobs.reverse();
      if (field === 'count') changed.jobs.pop();
      const replayed = await replayExtraction(db, batch.id, () => read(changed));
      expect((await compareExtractionResult(db, batch.id, replayed)).exact).toBe(false);
    });

  it('rejects skipped pages and swallowed requests that were never recorded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    const sourceKey = key();
    await captureExtraction(db, sourceKey, {}, undefined, async () => {
      await fetchJson(url); await fetchJson(`${url}?page=2`); return result;
    });
    const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey } });
    await expect(replayExtraction(db, batch.id, () => read())).rejects.toThrow('unconsumed');
    await expect(replayExtraction(db, batch.id, async () => {
      await fetchJson(url); await fetchJson(`${url}?page=2`);
      try { await fetchJson(`${url}?page=3`); } catch { /* Deliberately swallowed by a reader. */ }
      return result;
    })).rejects.toThrow('absent');
  });

  it('rejects swallowed incomplete and corrupt archived responses', async () => {
    const incomplete = await openBatch();
    await persistCapture(db, incomplete.id, receipt(false));
    const swallowed = async () => { try { await fetchJson(url); } catch { /* Deliberate. */ } return result; };
    await expect(replayExtraction(db, incomplete.id, swallowed)).rejects.toThrow('incomplete');
    const { batch } = await capture(); const store = new MemoryStore();
    await archiveRawBlob(db, batch.captures[0].blobHash!, store);
    vi.spyOn(store, 'get').mockResolvedValue(Buffer.from('corrupt'));
    await expect(replayExtraction(db, batch.id, swallowed, store)).rejects.toThrow('could not be verified');
  });

  it('seals both input and output journals on success or failure', async () => {
    const { batch } = await capture();
    const failed = await openBatch();
    await db.captureOutcome.create({ data: { batchId: failed.id, status: 'FAILED', extractedCount: 0, failure: 'fixture' } });
    const hash = await storeRawBlob(db, Buffer.from('{}'));
    for (const batchId of [batch.id, failed.id]) {
      await expect(persistCapture(db, batchId, { ...receipt(), sequence: 10 })).rejects.toThrow('sealed');
      await expect(db.sourceExtraction.create({ data: { batchId, ordinal: 10, outputHash: hash } })).rejects.toThrow('sealed');
    }
    await expect(db.captureOutcome.update({ where: { batchId: batch.id }, data: { manifestHash: null } })).rejects.toThrow('immutable');
  });

  it('refuses a success without a manifest, with a missing output, or with an ordinal gap', async () => {
    const batch = await openBatch();
    const hash = await storeRawBlob(db, Buffer.from('{}'));
    const data = { batchId: batch.id, status: 'EXTRACTED', extractedCount: 0, outputHash: evidenceHash([]) };
    await expect(db.captureOutcome.create({ data })).rejects.toThrow('requires its result manifest');
    await expect(db.captureOutcome.create({ data: { ...data, manifestHash: hash, extractedCount: 1 } })).rejects.toThrow('ordered outputs');
    await db.sourceExtraction.create({ data: { batchId: batch.id, ordinal: 1, outputHash: hash } });
    await expect(db.captureOutcome.create({ data: { ...data, manifestHash: hash, extractedCount: 1 } })).rejects.toThrow('ordered outputs');
  });

  it('keeps historical native bytes readable without inventing result metadata for format 1', async () => {
    const batch = await openBatch(1); await persistCapture(db, batch.id, receipt());
    await db.captureOutcome.create({ data: { batchId: batch.id, status: 'EXTRACTED', extractedCount: 0 } });
    expect(await replayExtraction(db, batch.id, () => fetchJson(url))).toEqual({});
    await expect(readExtractionManifest(db, batch.id)).rejects.toThrow('manifest unavailable');
  });

  it('waits for an in-flight output before validating and sealing the batch', async () => {
    const batch = await openBatch(); const hash = await storeRawBlob(db, Buffer.from('{}'));
    let inserted!: () => void; const ready = new Promise<void>(resolve => { inserted = resolve; });
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    const append = db.$transaction(async tx => {
      await tx.sourceExtraction.create({ data: { batchId: batch.id, ordinal: 0, outputHash: hash } });
      inserted(); await held;
    });
    await ready;
    try {
      await expect(db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '200ms'");
        await tx.captureOutcome.create({ data: { batchId: batch.id, status: 'EXTRACTED', extractedCount: 0,
          manifestHash: hash, outputHash: evidenceHash([]) } });
      })).rejects.toThrow('lock timeout');
    } finally { release(); await append; }
    await expect(db.captureOutcome.create({ data: { batchId: batch.id, status: 'EXTRACTED', extractedCount: 0,
      manifestHash: hash, outputHash: evidenceHash([]) } })).rejects.toThrow('ordered outputs');
    await db.captureOutcome.create({ data: { batchId: batch.id, status: 'EXTRACTED', extractedCount: 1,
      manifestHash: hash, outputHash: evidenceHash([]) } });
    await expect(db.sourceExtraction.create({ data: { batchId: batch.id, ordinal: 1, outputHash: hash } })).rejects.toThrow('sealed');
  });

  it.each(['append', 'seal'])('rejects a repeatable-read %s whose snapshot predates the other operation', async operation => {
    const batch = await openBatch(); const hash = await storeRawBlob(db, Buffer.from('{}'));
    let ready!: () => void; const snapshot = new Promise<void>(resolve => { ready = resolve; });
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    const outcome = { batchId: batch.id, status: 'EXTRACTED', extractedCount: 0, manifestHash: hash, outputHash: evidenceHash([]) };
    const output = { batchId: batch.id, ordinal: 0, outputHash: hash };
    const append = db.$transaction(async tx => {
      await tx.captureBatch.findUniqueOrThrow({ where: { id: batch.id } });
      ready(); await held;
      if (operation === 'append') await tx.sourceExtraction.create({ data: output });
      else await tx.captureOutcome.create({ data: outcome });
    }, { isolationLevel: 'RepeatableRead' }).then(() => 'COMMITTED', error => error.code);
    await snapshot;
    try {
      if (operation === 'append') await db.captureOutcome.create({ data: outcome });
      else await db.sourceExtraction.create({ data: output });
    } finally { release(); }
    expect(await append).toBe('P2034');
    expect(await db.sourceExtraction.count({ where: { batchId: batch.id } })).toBe(operation === 'append' ? 0 : 1);
    await expect(db.captureBatch.update({ where: { id: batch.id }, data: { readerRevision: 'altered' } })).rejects.toThrow('immutable');
  });

  it('verifies cold result manifests and refuses a corrupt archived manifest', async () => {
    const { live, batch } = await capture(); const store = new MemoryStore();
    expect(await archiveRawBlob(db, batch.outcome!.manifestHash!, store)).toEqual({ purged: true });
    expect((await compareExtractionResult(db, batch.id, live, store)).exact).toBe(true);
    vi.spyOn(store, 'get').mockResolvedValue(Buffer.from('corrupt manifest'));
    await expect(compareExtractionResult(db, batch.id, live, store)).rejects.toThrow('integrity mismatch');
  });

  it('includes old manifests in retention scope and protects fresh manifest references during transfer', async () => {
    const old = new Date(Date.now() - 30 * 86_400_000); const batch = await openBatch();
    const manifestHash = await storeRawBlob(db, Buffer.from(JSON.stringify({ unique: key() })));
    await db.captureOutcome.create({ data: { batchId: batch.id, status: 'EXTRACTED', extractedCount: 0,
      manifestHash, outputHash: evidenceHash([]), completedAt: old } });
    const plan = await planRetention(db, [batch.sourceKey]); expect(plan.blobs).toEqual([manifestHash]);
    expect((await planRetention(db, [key()])).blobs).toEqual([]);
    const store = new MemoryStore(); const get = store.get.bind(store);
    vi.spyOn(store, 'get').mockImplementation(async objectKey => {
      const fresh = await openBatch();
      await db.captureOutcome.create({ data: { batchId: fresh.id, status: 'EXTRACTED', extractedCount: 0,
        manifestHash, outputHash: evidenceHash([]) } });
      return get(objectKey);
    });
    expect(await applyRetention(db, plan, plan.planHash, store)).toEqual({ observations: 0, purged: 0 });
    expect((await planRetention(db, [batch.sourceKey])).blobs).toEqual([]);
    expect(await db.rawBlobBody.count({ where: { hash: manifestHash } })).toBe(1);
  });
});
