import '../test/setup-integration.js';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { captureExtraction, replayExtraction } from '../capture/batch.js';
import { readRequestData } from '../capture/requestDataRead.js';
import { readRawBlob, archiveRawBlob, storeRawBlob } from '../capture/store.js';
import { describeRequest, requestFingerprint } from '../capture/context.js';
import { observedHop } from '../capture/requestData.js';
import { fetchJson } from '../lib/http.js';
import { planRetention, applyRetention } from '../retention/retention.js';
import { MemoryStore } from '../test/memoryObjectStore.js';
import { CRAWLER_IDENTITY } from '../lib/crawlerIdentity.js';

const db = new PrismaClient();
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => db.$disconnect());
async function capture() {
  const sourceKey = `request-data-${randomUUID()}`; const url = `https://request-data.example/${sourceKey}?token=private-fixture`;
  const fetch = vi.fn(async () => new Response('{"native":"unchanged"}')); vi.stubGlobal('fetch', fetch);
  const reader = () => fetchJson(url);
  const live = await captureExtraction(db, sourceKey, {}, undefined, async () => { await reader(); return { jobs: [] }; });
  const row = await db.rawCapture.findFirstOrThrow({ where: { batchId: live.captureBatchId } });
  return { row, reader, fetch, sourceKey };
}

it('stores the exact request in a private hash-verified blob and keeps public capture metadata redacted', async () => {
  const { row } = await capture();
  expect(row.requestDataHash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(row)).not.toContain('private-fixture');
  const request = await readRequestData(db, row);
  expect(request).toMatchObject({ origin: 'HTTP_TRANSPORT', hops: [{ status: 200, request: { userAgent: CRAWLER_IDENTITY } }] });
  expect(request!.logical.url).toContain('private-fixture');
  expect(JSON.parse((await readRawBlob(db, row.requestDataHash!)).toString())).toEqual(request);
});

it('replays entirely cold request and response evidence without a portal request, and refuses corrupt request metadata', async () => {
  const { row, reader, fetch } = await capture(); const store = new MemoryStore();
  for (const hash of [row.blobHash!, row.requestDataHash!]) expect(await archiveRawBlob(db, hash, store)).toEqual({ purged: true });
  expect(await db.rawBlobBody.count({ where: { hash: { in: [row.blobHash!, row.requestDataHash!] } } })).toBe(0);
  fetch.mockImplementation(async () => { throw new Error('No portal requests allowed'); });
  expect(await replayExtraction(db, row.batchId, reader, store)).toEqual({ native: 'unchanged' });
  expect(fetch).toHaveBeenCalledTimes(1);
  const get = store.get.bind(store); const pointer = await db.rawBlobArchive.findUniqueOrThrow({ where: { hash: row.requestDataHash! } });
  vi.spyOn(store, 'get').mockImplementation(async key => key === pointer.objectKey ? Buffer.from('corrupt request provenance') : get(key));
  await expect(replayExtraction(db, row.batchId, reader, store)).rejects.toThrow('integrity mismatch');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['requestHash', 'requestUrl', 'method', 'format', 'status'] as const)('refuses provenance relabelled with another %s', async field => {
  const { row } = await capture();
  const changed = { ...row, [field]: field === 'status' ? 201 : field === 'method' ? 'POST' : field === 'format' ? 'BROWSER_RESPONSE' : 'different' };
  await expect(readRequestData(db, changed)).rejects.toThrow('differs from its capture');
});

it('leaves historical missing provenance unknown without consulting current identity or storage', async () => {
  const { row } = await capture();
  const spy = vi.spyOn(db.rawBlob, 'findUniqueOrThrow');
  expect(await readRequestData(db, { ...row, requestDataHash: null })).toBeNull(); expect(spy).not.toHaveBeenCalled();
});

async function oldCapture() {
  const sourceKey = `old-request-${randomUUID()}`; const old = new Date(Date.now() - 30 * 86_400_000);
  const batch = await db.captureBatch.create({ data: { sourceKey, configHash: 'fixture', readerRevision: 'fixture', startedAt: old } });
  const request = { url: `https://old-request.example/${sourceKey}`, format: 'HTTP_RESPONSE' as const };
  const description = describeRequest(request);
  const requestDataHash = await storeRawBlob(db, Buffer.from(JSON.stringify({ version: 1, logical: description, origin: 'HTTP_TRANSPORT', hops: [observedHop(description, new Response())] })));
  const row = await db.rawCapture.create({ data: { batchId: batch.id, sequence: 0, requestDataHash,
    requestHash: requestFingerprint(request), requestUrl: request.url, method: 'GET', format: 'HTTP_RESPONSE', status: 200,
    headers: {}, cookieNames: [], complete: false, failure: 'FixtureWithoutBody', capturedAt: old } });
  return { row, sourceKey };
}

it('enforces request provenance presence, foreign key, and immutability at the SQL boundary', async () => {
  const { row } = await oldCapture(); const { id: _id, ...rest } = row; const data = { ...rest, headers: row.headers as Prisma.InputJsonObject, cookieNames: row.cookieNames as Prisma.InputJsonArray };
  await expect(db.rawCapture.create({ data: { ...data, sequence: 1, requestDataHash: null } })).rejects.toThrow('requires native request data');
  await expect(db.rawCapture.create({ data: { ...data, sequence: 1, requestDataHash: 'f'.repeat(64) } })).rejects.toThrow('Foreign key');
  await expect(db.rawCapture.update({ where: { id: row.id }, data: { requestDataHash: null } })).rejects.toThrow('immutable');
  await expect(db.rawBlob.delete({ where: { hash: row.requestDataHash! } })).rejects.toThrow();
});

it('includes old private request blobs in scoped retention and can read them after cold transfer', async () => {
  const { row, sourceKey } = await oldCapture(); const store = new MemoryStore();
  const plan = await planRetention(db, [sourceKey]); expect(plan.blobs).toEqual([row.requestDataHash]);
  expect(await applyRetention(db, plan, plan.planHash, store)).toEqual({ observations: 0, purged: 1 });
  expect(await readRequestData(db, row, store)).toMatchObject({ origin: 'HTTP_TRANSPORT' });
});

it('protects a newly reused request envelope both during purge and when planning retention', async () => {
  const { row, sourceKey } = await oldCapture(); const store = new MemoryStore();
  const plan = await planRetention(db, [sourceKey]); expect(plan.blobs).toEqual([row.requestDataHash]);
  const { id: _id, capturedAt: _at, ...rest } = row; const data = { ...rest, headers: row.headers as Prisma.InputJsonObject, cookieNames: row.cookieNames as Prisma.InputJsonArray }; const get = store.get.bind(store);
  vi.spyOn(store, 'get').mockImplementation(async key => {
    await db.rawCapture.createMany({ data: [{ ...data, id: randomUUID(), sequence: 1 }], skipDuplicates: true });
    return get(key);
  });
  expect(await applyRetention(db, plan, plan.planHash, store)).toEqual({ observations: 0, purged: 0 });
  expect(await db.rawBlobBody.count({ where: { hash: row.requestDataHash! } })).toBe(1);
  expect((await planRetention(db, [sourceKey])).blobs).toEqual([]);
});

it('restores fresh identical bytes after their previous archive was made cold, without rewriting old attestations', async () => {
  const { row, reader, sourceKey } = await capture(); const store = new MemoryStore();
  for (const hash of [row.blobHash!, row.requestDataHash!]) await archiveRawBlob(db, hash, store);
  const before = await db.rawBlob.findMany({ where: { hash: { in: [row.blobHash!, row.requestDataHash!] } } });
  const recaptured = await captureExtraction(db, sourceKey, {}, undefined, async () => { await reader(); return { jobs: [] }; });
  const next = await db.rawCapture.findFirstOrThrow({ where: { batchId: recaptured.captureBatchId } });
  expect(next.id).not.toBe(row.id); expect(next.requestDataHash).toBe(row.requestDataHash); expect(next.blobHash).toBe(row.blobHash);
  expect(await db.rawBlob.findMany({ where: { hash: { in: [row.blobHash!, row.requestDataHash!] } } })).toEqual(before);
  expect(await db.rawCapture.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  expect(await db.rawBlobBody.count({ where: { hash: { in: [row.blobHash!, row.requestDataHash!] } } })).toBe(2);
  expect(await replayExtraction(db, next.batchId, reader)).toEqual({ native: 'unchanged' });
});
