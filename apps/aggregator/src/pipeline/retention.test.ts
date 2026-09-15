import '../test/setup-integration.js';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { archiveAdapterOutput, readAdapterObservation } from '../capture/observations.js';
import { planRetention, applyRetention } from '../retention/retention.js';
import { storeRawBlob } from '../capture/store.js';
import { MemoryStore } from '../test/memoryObjectStore.js';

const db = new PrismaClient();
afterAll(() => db.$disconnect());
afterEach(() => vi.restoreAllMocks());
async function oldObservation() {
  const sourceKey = `retention-${randomUUID()}`;
  const raw = { title: 'Client Advisor', unknownField: randomUUID(), locations: ['Paris', 'Lyon'] };
  await archiveAdapterOutput(db, { sourceKey, externalId: '1', raw });
  const row = await db.sourceObservation.findFirstOrThrow({ where: { sourceKey } });
  await db.sourceObservation.update({ where: { id: row.id }, data: { observedAt: new Date(Date.now() - 30 * 86_400_000) } });
  return { sourceKey, raw, row };
}

it('keeps identity and exact adapter output after transfer and resumes without deleting a second time', async () => {
  const { sourceKey, raw, row } = await oldObservation(); const store = new MemoryStore();
  const plan = await planRetention(db, [sourceKey]);
  expect(plan.observations.map(entry => entry.id)).toEqual([row.id]);
  expect(await applyRetention(db, plan, plan.planHash, store)).toEqual({ observations: 1, purged: 1 });
  expect(await applyRetention(db, plan, plan.planHash, store)).toEqual({ observations: 1, purged: 0 });
  const archived = await db.sourceObservation.findUniqueOrThrow({ where: { id: row.id } });
  expect(archived).toMatchObject({ sourceKey, contentHash: row.contentHash, raw: null, captureBatchId: null });
  expect(archived.rawBlobHash).toMatch(/^[a-f0-9]{64}$/);
  expect((await readAdapterObservation(db, row.id, store)).raw).toEqual(raw);
});

it('keeps recoverable hot bytes when remote storage fails after an observation is transferred', async () => {
  const { sourceKey, raw, row } = await oldObservation(); const store = new MemoryStore();
  const plan = await planRetention(db, [sourceKey]);
  vi.spyOn(store, 'put').mockRejectedValue(new Error('Remote archive unavailable'));
  await expect(applyRetention(db, plan, plan.planHash, store)).rejects.toThrow('unavailable');
  expect((await readAdapterObservation(db, row.id)).raw).toEqual(raw);
  const saved = await db.sourceObservation.findUniqueOrThrow({ where: { id: row.id } });
  expect(await db.rawBlobBody.count({ where: { hash: saved.rawBlobHash! } })).toBe(1);
  expect(await db.rawBlobArchive.count({ where: { hash: saved.rawBlobHash! } })).toBe(0);
});

it('treats an empty scope as a no-op and refuses a modified plan', async () => {
  const { sourceKey } = await oldObservation(); const store = new MemoryStore();
  const empty = await planRetention(db, []);
  expect(await applyRetention(db, empty, empty.planHash, store)).toEqual({ observations: 0, purged: 0 });
  const plan = await planRetention(db, [sourceKey]); plan.observations[0].contentHash = 'changed';
  await expect(applyRetention(db, plan, plan.planHash, store)).rejects.toThrow('Invalid retention plan');
});

it('does not remove a body referenced by a more recent observation', async () => {
  const { sourceKey, row } = await oldObservation(); const store = new MemoryStore();
  const plan = await planRetention(db, [sourceKey]);
  // Pause on the remote verification to create a new reference before the purge lock.
  const get = store.get.bind(store);
  vi.spyOn(store, 'get').mockImplementation(async key => {
    const current = await db.sourceObservation.findUniqueOrThrow({ where: { id: row.id } });
    await db.sourceObservation.createMany({ data: [{ sourceKey, externalId: 'fresh-reference',
      contentHash: row.contentHash, rawBlobHash: current.rawBlobHash, pipelineVersion: 1 }], skipDuplicates: true });
    return get(key);
  });
  expect(await applyRetention(db, plan, plan.planHash, store)).toEqual({ observations: 1, purged: 0 });
  const current = await db.sourceObservation.findUniqueOrThrow({ where: { id: row.id } });
  expect(await db.rawBlobBody.count({ where: { hash: current.rawBlobHash! } })).toBe(1);
});

it('retains an old extraction output in scope and protects a newly added output reference during transfer', async () => {
  const sourceKey = `retention-output-${randomUUID()}`;
  const old = new Date(Date.now() - 30 * 86_400_000);
  const batch = await db.captureBatch.create({ data: { sourceKey, configHash: 'test', readerRevision: 'test', startedAt: old } });
  const hash = await storeRawBlob(db, Buffer.from(JSON.stringify({ output: randomUUID() })));
  await db.sourceExtraction.create({ data: { batchId: batch.id, ordinal: 0, outputHash: hash, capturedAt: old } });
  const plan = await planRetention(db, [sourceKey]); expect(plan.blobs).toEqual([hash]);
  const store = new MemoryStore(); const get = store.get.bind(store);
  vi.spyOn(store, 'get').mockImplementation(async key => {
    await db.sourceExtraction.createMany({ data: [{ batchId: batch.id, ordinal: 1, outputHash: hash }], skipDuplicates: true });
    return get(key);
  });
  expect(await applyRetention(db, plan, plan.planHash, store)).toEqual({ observations: 0, purged: 0 });
  expect(await db.rawBlobBody.count({ where: { hash } })).toBe(1);
  expect((await planRetention(db, [sourceKey])).blobs).toEqual([]);
});
