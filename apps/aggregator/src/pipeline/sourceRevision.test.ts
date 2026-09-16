import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { captureExtraction } from '../capture/batch.js';
import { readCapturedPublication } from '../capture/publication.js';
import { loadActiveSources } from '../connectors/sourceStore.js';
import { effectiveSourceConfig } from '../connectors/sourceConfig.js';
import { requireCurrentCaptureRevision } from '../connectors/sourceRevision.js';
import { fetchJson } from '../lib/http.js';

const db = new PrismaClient();
const keys: string[] = [];
const config = { origin: 'https://revision.example', filter: { country: 'FR' } };
const create = async () => {
  const key = `revision-${randomUUID()}`; keys.push(key);
  return db.source.create({ data: { key, maison: 'Revision witness', kind: 'generic-listing', config,
    tier: 'EMPLOYER_DIRECT', tenantKey: key, status: 'ACTIVE' } });
};
const reader = async () => {
  const raw = await fetchJson<{ id: string }>('https://revision.example/jobs');
  return { jobs: [{ externalId: raw.id, title: 'Advisor', url: 'https://revision.example/jobs/1', raw }] };
};
const capture = (source: Awaited<ReturnType<typeof create>>, settings = config) =>
  captureExtraction(db, source.key, settings, undefined, reader, 'GENERIC_JSONLD', { revisionId: source.currentRevisionId, requireActive: true });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(async () => { await db.source.deleteMany({ where: { key: { in: keys } } }); await db.$disconnect(); });

describe('immutable source configuration transitions', () => {
  it('records the native JSON configuration and changes no revision for operational updates', async () => {
    const source = await create();
    const revision = await db.sourceRevision.findUniqueOrThrow({ where: { id: source.currentRevisionId } });
    expect(revision).toMatchObject({ sourceId: source.id, sourceKey: source.key, version: 1, payload: { config, jobUrlPattern: null } });
    const changed = await db.source.update({ where: { key: source.key }, data: { status: 'PAUSED', note: 'health changed', lastRunJobs: 7 } });
    expect(changed.currentRevisionId).toBe(source.currentRevisionId);
    expect(await db.sourceRevision.count({ where: { sourceId: source.id } })).toBe(1);
  });

  it('allocates fresh transitions on A to B to A and pauses a changed active source', async () => {
    const a = await create();
    const b = await db.source.update({ where: { key: a.key }, data: { config: { ...config, filter: { country: 'US' } } } });
    expect(b.status).toBe('PAUSED');
    const again = await db.source.update({ where: { key: a.key }, data: { config } });
    const revisions = await db.sourceRevision.findMany({ where: { sourceId: a.id }, orderBy: { version: 'asc' } });
    expect(revisions.map(row => row.version)).toEqual([1, 2, 3]);
    expect(new Set(revisions.map(row => row.id)).size).toBe(3);
    expect(revisions[0].payloadHash).toBe(revisions[2].payloadHash);
    expect(again.currentRevisionId).not.toBe(a.currentRevisionId);
  });

  it.each(['maison', 'kind', 'careersDomain', 'jobUrlPattern', 'tier', 'tenantKey'] as const)('versions the %s part of the collection perimeter', async field => {
    const source = await create();
    const changed = await db.source.update({ where: { key: source.key }, data: { [field]: `changed-${randomUUID()}` } });
    expect(changed.currentRevisionId).not.toBe(source.currentRevisionId);
    expect(changed.status).toBe('PAUSED');
  });

  it('preserves explicit retirement and refuses activation bundled with a config replacement', async () => {
    const source = await create();
    expect(await db.source.update({ where: { key: source.key }, data: { config: {}, status: 'RETIRED' } })).toMatchObject({ status: 'RETIRED' });
    const other = await create();
    await db.source.update({ where: { key: other.key }, data: { status: 'DRAFT' } });
    expect(await db.source.update({ where: { key: other.key }, data: { config: {}, status: 'ACTIVE' } })).toMatchObject({ status: 'PAUSED' });
  });

  it('refuses edits, deletion, pointer reassignment and registry identity reuse', async () => {
    const source = await create(), another = await create();
    await expect(db.sourceRevision.update({ where: { id: source.currentRevisionId }, data: { payload: {} } })).rejects.toThrow('immutable');
    await expect(db.sourceRevision.delete({ where: { id: source.currentRevisionId } })).rejects.toThrow('immutable');
    await expect(db.source.update({ where: { key: source.key }, data: { currentRevisionId: another.currentRevisionId } })).rejects.toThrow('managed');
    await expect(db.source.update({ where: { key: source.key }, data: { key: source.key + '-renamed' } })).rejects.toThrow('identity is immutable');
    await expect(db.source.update({ where: { key: source.key }, data: { id: randomUUID() } })).rejects.toThrow('identity is immutable');
    await db.source.delete({ where: { key: source.key } });
    expect(await db.sourceRevision.findUnique({ where: { id: source.currentRevisionId } })).not.toBeNull();
  });

  it('rejects invalid snapshot shapes and fingerprints at the database boundary', async () => {
    const source = await create();
    for (const payload of [{}, { version: 1, key: source.key, config: [] }, { version: 1, config }, { version: 2, key: source.key, config }]) {
      const document = JSON.stringify(payload);
      await expect(db.$executeRaw`INSERT INTO "SourceRevision" (id,"sourceId","sourceKey",version,payload,"payloadHash")
        VALUES (${randomUUID()},${source.id},${source.key},99,${document}::jsonb,
          encode(sha256(convert_to((${document}::jsonb)::text,'UTF8')),'hex'))`).rejects.toThrow('SourceRevision_shape');
    }
    await expect(db.sourceRevision.create({ data: { id: randomUUID(), sourceId: source.id, sourceKey: source.key,
      version: 99, payload: { version: 1, key: source.key, config }, payloadHash: 'invented' } })).rejects.toThrow('SourceRevision_shape');
  });

  it('keeps SQL-native decimal configuration in both the snapshot and runtime settings', async () => {
    const source = await create();
    await db.$executeRaw`UPDATE "Source" SET config='{"threshold":0.12345678912345678}'::jsonb WHERE key=${source.key}`;
    await db.source.update({ where: { key: source.key }, data: { status: 'ACTIVE' } });
    const [row] = await db.$queryRaw<{ config: string; payload: string }[]>`
      SELECT s.config::text AS config,r.payload::text AS payload FROM "Source" s JOIN "SourceRevision" r ON r.id=s."currentRevisionId" WHERE s.key=${source.key}`;
    expect(JSON.parse(row.payload).config).toEqual(JSON.parse(row.config));
    const loaded = (await loadActiveSources(db)).find(row => row.key === source.key)!;
    expect(loaded.config).toEqual({ threshold: 0.12345678912345678 });
    expect(loaded.revisionId).toBeTruthy();
  });

  it('serializes concurrent configuration updates into consecutive immutable versions', async () => {
    const source = await create();
    await Promise.all([1, 2, 3].map(index => db.source.update({ where: { key: source.key }, data: { config: { index } } })));
    const rows = await db.sourceRevision.findMany({ where: { sourceId: source.id }, orderBy: { version: 'asc' } });
    expect(rows.map(row => row.version)).toEqual([1, 2, 3, 4]);
    const current = await db.source.findUniqueOrThrow({ where: { key: source.key } });
    expect(current.currentRevisionId).toBe(rows[3].id);
  });
});

describe('capture revision binding', () => {
  it('binds settings, reader and loaded revision before transport and retains historical evidence after a change', async () => {
    const source = await create(); vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":"1"}')));
    const result = await capture(source); const job = result.jobs[0];
    const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: job.captureBatchId } });
    expect(batch.sourceRevisionId).toBe(source.currentRevisionId);
    await expect(readCapturedPublication(db, { ...job, sourceKey: source.key })).resolves.toBeDefined();
    for (const status of ['DRAFT', 'PAUSED', 'RETIRED'] as const) {
      await db.source.update({ where: { key: source.key }, data: { status } });
      await expect(requireCurrentCaptureRevision(db, batch)).rejects.toThrow('no longer current');
    }
    await db.source.update({ where: { key: source.key }, data: { status: 'ACTIVE' } });
    await db.source.update({ where: { key: source.key }, data: { config: { origin: 'https://changed.example' } } });
    await expect(readCapturedPublication(db, { ...job, sourceKey: source.key })).resolves.toBeDefined();
    await expect(requireCurrentCaptureRevision(db, batch)).rejects.toThrow('no longer current');
    expect((await db.captureOutcome.findUniqueOrThrow({ where: { batchId: batch.id } })).status).toBe('EXTRACTED');
  });

  it.each(['stale', 'paused', 'retired', 'config', 'kind', 'deleted'] as const)('refuses %s work before network or batch creation', async mode => {
    let source = await create(); const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    if (mode === 'stale') {
      await db.source.update({ where: { key: source.key }, data: { config: { origin: 'https://changed.example' } } });
      // Same settings again must not revive the old loaded revision.
      await db.source.update({ where: { key: source.key }, data: { config } });
      await db.source.update({ where: { key: source.key }, data: { status: 'ACTIVE' } });
    }
    if (mode === 'paused' || mode === 'retired') await db.source.update({ where: { key: source.key }, data: { status: mode === 'paused' ? 'PAUSED' : 'RETIRED' } });
    if (mode === 'deleted') await db.source.delete({ where: { key: source.key } });
    await expect(captureExtraction(db, source.key, mode === 'config' ? {} : config, undefined, reader,
      mode === 'kind' ? 'LEVER' : 'GENERIC_JSONLD', { revisionId: source.currentRevisionId, requireActive: true })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    expect(await db.captureBatch.count({ where: { sourceKey: source.key } })).toBe(0);
  });

  it('expands aliases through the same resolver and binds registered validation captures without requiring activation', async () => {
    let source = await create();
    source = await db.source.update({ where: { key: source.key }, data: { config: { careers_url: config.origin }, status: 'DRAFT' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":"1"}')));
    const result = await captureExtraction(db, source.key, effectiveSourceConfig({ careers_url: config.origin }), undefined, reader, 'GENERIC_JSONLD');
    expect((await db.captureBatch.findUniqueOrThrow({ where: { id: result.jobs[0].captureBatchId } })).sourceRevisionId).toBe(source.currentRevisionId);
    expect(effectiveSourceConfig({ url: config.origin })).toEqual({ origin: config.origin });
  });

  it('refuses attaching a stale or foreign revision directly to a new batch', async () => {
    const source = await create(), other = await create();
    const batch = { sourceKey: source.key, readerRevision: 'test', configHash: 'test' };
    await expect(db.captureBatch.create({ data: { ...batch, sourceRevisionId: other.currentRevisionId } })).rejects.toThrow('current source');
    await db.source.update({ where: { key: source.key }, data: { config: {} } });
    await expect(db.captureBatch.create({ data: { ...batch, sourceRevisionId: source.currentRevisionId } })).rejects.toThrow('current source');
  });

  it('holds a shared registry row lock until the publication transaction finishes', async () => {
    const source = await create();
    let unlock!: () => void; const barrier = new Promise<void>(resolve => { unlock = resolve; });
    let locked!: () => void; const ready = new Promise<void>(resolve => { locked = resolve; });
    const writing = db.$transaction(async tx => {
      await requireCurrentCaptureRevision(tx, { sourceKey: source.key, sourceRevisionId: source.currentRevisionId });
      locked(); await barrier;
    });
    await ready;
    try {
      await expect(db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout='100ms'");
        await tx.source.update({ where: { key: source.key }, data: { config: {} } });
      })).rejects.toThrow();
    } finally { unlock(); await writing; }
    await expect(db.source.update({ where: { key: source.key }, data: { config: {} } })).resolves.toMatchObject({ status: 'PAUSED' });
  });
});
