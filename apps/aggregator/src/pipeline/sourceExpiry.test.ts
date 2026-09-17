import '../test/setup-integration.js';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySourceExpiries, planSourceExpiries, type ExpiryBackfillPlan } from './sourceExpiry.js';
import { declaredExpiry, EXPIRY_READER_VERSION } from '../normalize/expiry.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { archiveAdapterObservation } from '../capture/observations.js';
import { randomUUID } from 'node:crypto';
import { captureExtraction } from '../capture/batch.js';
import { fetchJson } from '../lib/http.js';

const db = new PrismaClient();
const key = 'expiry-backfill-witness';
let auditBefore = 0;
const wipe = async () => {
  await db.jobSource.deleteMany(); await db.job.deleteMany();
  await db.company.deleteMany();
  await db.source.deleteMany({ where: { key } });
};
beforeEach(async () => {
  await wipe();
  auditBefore = await db.dataCorrection.count({ where: { finding: 'SOURCE_DECLARED_EXPIRY' } });
  await db.source.create({
    data: {
      key,
      tenantKey: key,
      maison: key,
      kind: 'workday',
      config: { origin: 'https://example.com', site: 'Fixture' },
      tier: 'ATS_OFFICIAL',
    },
  });
  await db.company.create({ data: { id: key, name: key, canonicalKey: key, fashionjobsUrl: `resolved:${key}` } });
});
afterAll(async () => {
  await wipe();
  await db.$disconnect();
});
async function source(id: string, raw: object) {
  return db.job.create({
    data: {
      id,
      companyId: key,
      externalId: id,
      source: 'WORKDAY',
      title: id,
      url: jobUrl(id),
      sources: {
        create: {
          id: `js-${id}`,
          sourceKey: key,
          sourceTier: 'ATS_OFFICIAL',
          externalId: id,
          url: jobUrl(id),
          raw,
        },
      },
    },
  });
}
const jobUrl = (id: string) => `https://example.com/Fixture/job/Paris/${id}`;
const payload = (id: string) => ({
  title: 'Client Advisor',
  externalPath: `/job/Paris/${id}`,
  detail: {
    jobPostingInfo: {
      endDate: '2026-09-30',
      externalUrl: jobUrl(id),
      jobDescription: '<p>Native responsibilities</p>',
      logoImage: { alt: 'Fixture Maison' },
    },
  },
});
describe('deadline backfill from original source payloads', () => {
  it('bounds pages and source scope, writes evidence once, and safely resumes', async () => {
    await source('a', payload('a'));
    await source('b', payload('b'));
    await source('c', { unrelated: { validThrough: '2020-01-01' } });
    const first = await planSourceExpiries(db, [key], undefined, 1);
    const second = await planSourceExpiries(db, [key], first.nextCursor, 1);
    expect(first.plan.entries.map((entry) => entry.id)).toEqual(['js-a']);
    expect(second.plan.entries.map((entry) => entry.id)).toEqual(['js-b']);
    expect((await planSourceExpiries(db, [])).scanned).toBe(0);
    const before = await db.jobSource.findUniqueOrThrow({ where: { id: 'js-b' } });
    expect(await applySourceExpiries(db, first.plan, first.plan.planHash)).toEqual({
      written: 1,
      alreadyApplied: false,
    });
    expect(await applySourceExpiries(db, first.plan, first.plan.planHash)).toEqual({
      written: 0,
      alreadyApplied: true,
    });
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: 'js-b' } })).toEqual(before);
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: 'js-a' } })).toMatchObject({
      expiresAt: new Date('2026-10-01T12:00:00Z'),
      expiryEvidence: { path: '$.detail.jobPostingInfo.endDate', value: '2026-09-30' },
    });
    expect(await db.dataCorrection.count({ where: { finding: 'SOURCE_DECLARED_EXPIRY' } })).toBe(auditBefore + 1);
    expect(
      await db.sourceObservation.findFirstOrThrow({
        where: {
          sourceKey: key,
          externalId: 'a',
          contentHash: first.plan.entries[0].rawHash,
          annotationHash: '',
        },
      }),
    ).toMatchObject({ raw: payload('a') });
    expect((await planSourceExpiries(db, [key])).plan.entries.map((entry) => entry.id)).toEqual(['js-b']);
  });

  it.each([
    'raw',
    'lastSeenAt',
    'firstSeenAt',
    'company',
    'kind',
    'config',
    'status',
    'activity',
    'cache',
    'url',
  ] as const)('refuses a changed %s before writing any row', async (field) => {
    await source('a', payload('a'));
    await source('b', payload('b'));
    const { plan } = await planSourceExpiries(db, [key]);
    if (field === 'url') await db.jobSource.update({ where: { id: 'js-b' }, data: { url: jobUrl('other') } });
    if (field === 'raw')
      await db.jobSource.update({ where: { id: 'js-b' }, data: { raw: { detailReadError: 'timeout' } } });
    if (field === 'lastSeenAt') await db.jobSource.update({ where: { id: 'js-b' }, data: { lastSeenAt: new Date(0) } });
    if (field === 'firstSeenAt')
      await db.jobSource.update({ where: { id: 'js-b' }, data: { firstSeenAt: new Date(0) } });
    if (field === 'activity') await db.jobSource.update({ where: { id: 'js-b' }, data: { isActive: false } });
    if (field === 'cache')
      await db.jobSource.update({ where: { id: 'js-b' }, data: { expiryEvidence: { changed: true } } });
    if (field === 'config') await db.source.update({ where: { key }, data: { config: { tenant: 'changed' } } });
    if (field === 'status') await db.source.update({ where: { key }, data: { status: 'RETIRED' } });
    if (field === 'kind') await db.source.update({ where: { key }, data: { kind: 'generic-listing' } });
    if (field === 'company') {
      await db.company.create({
        data: {
          id: `${key}-other`,
          name: 'Other',
          canonicalKey: `${key}-other`,
          fashionjobsUrl: `resolved:${key}-other`,
        },
      });
      await db.job.update({ where: { id: 'b' }, data: { companyId: `${key}-other` } });
    }
    await expect(applySourceExpiries(db, plan, plan.planHash)).rejects.toThrow('Stale or unsupported expiry evidence');
    expect(await db.jobSource.count({ where: { expiresAt: { not: null } } })).toBe(0);
    expect(await db.dataCorrection.count({ where: { finding: 'SOURCE_DECLARED_EXPIRY' } })).toBe(auditBefore);
  });

  it('refuses a modified payload or mismatched plan hash', async () => {
    await source('a', payload('a'));
    const { plan } = await planSourceExpiries(db, [key]);
    await expect(applySourceExpiries(db, plan, '0'.repeat(64))).rejects.toThrow('Invalid expiry plan');
    plan.entries[0].expiresAt = '2030-01-01T00:00:00Z';
    await expect(applySourceExpiries(db, plan, plan.planHash)).rejects.toThrow('Invalid expiry plan');
    expect(await db.jobSource.count({ where: { expiresAt: { not: null } } })).toBe(0);
  });
});

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const rehash = (plan: ExpiryBackfillPlan) => {
  const { planHash: _, ...body } = plan;
  return { ...body, planHash: evidenceHash(body) };
};
async function partialObservation(
  options: { observation?: boolean; future?: boolean; wrongId?: boolean; hold?: boolean; wrongDate?: boolean } = {},
) {
  const id = randomUUID(),
    raw = { ...payload(id), fixture: id };
  const fact = declaredExpiry('workday', raw)!;
  await source(id, { detailReadError: 'timeout' });
  const observedAt = new Date(options.future ? '2026-09-16T09:00:00Z' : '2026-09-14T09:00:00Z');
  await db.jobSource.update({
    where: { id: `js-${id}` },
    data: {
      lastSeenAt: new Date('2026-09-15T09:00:00Z'),
      expiresAt: options.wrongDate ? new Date('2026-09-01T00:00:00Z') : fact.expiresAt,
      expiryEvidence: asJson({ ...fact.evidence, readerVersion: 1 }),
    },
  });
  const observation =
    options.observation === false
      ? undefined
      : await db.sourceObservation.create({
          data: {
            sourceKey: key,
            externalId: options.wrongId ? `${id}-other` : id,
            contentHash: fact.evidence.rawHash,
            raw,
            pipelineVersion: 1,
            observedAt,
            publicationHold: options.hold ? 'PRIVATE' : undefined,
          },
        });
  return { id: `js-${id}`, observation, raw, observedAt };
}

describe('expiry evidence reconciliation', () => {
  it('serializes two concurrent applications into a single audited change', async () => {
    await source('a', payload('a'));
    const { plan } = await planSourceExpiries(db, [key]);
    const results = await Promise.all([
      applySourceExpiries(db, plan, plan.planHash),
      applySourceExpiries(db, plan, plan.planHash),
    ]);
    expect(results.reduce((total, result) => total + result.written, 0)).toBe(1);
    expect(results.filter((result) => result.alreadyApplied)).toHaveLength(1);
    expect(await db.dataCorrection.count({ where: { finding: 'SOURCE_DECLARED_EXPIRY' } })).toBe(auditBefore + 1);
  });

  it('resumes when another worker commits after the initial idempotency read', async () => {
    await source('a', payload('a'));
    const { plan } = await planSourceExpiries(db, [key]);
    let release!: () => void, reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const initialRead = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const original = db.dataCorrection.findMany.bind(db.dataCorrection);
    const spy = vi.spyOn(db.dataCorrection, 'findMany').mockImplementationOnce((args) => {
      const pending = (async () => {
        const rows = await original(args);
        reached();
        await gate;
        return rows;
      })();
      return {
        [Symbol.toStringTag]: 'PrismaPromise' as const,
        then: pending.then.bind(pending),
        catch: pending.catch.bind(pending),
        finally: pending.finally.bind(pending),
      };
    });
    const delayed = applySourceExpiries(db, plan, plan.planHash);
    try {
      await initialRead;
      expect(await applySourceExpiries(db, plan, plan.planHash)).toEqual({ written: 1, alreadyApplied: false });
    } finally {
      release();
      spy.mockRestore();
    }
    await expect(delayed).resolves.toEqual({ written: 0, alreadyApplied: true });
  });

  it.each([
    ['flatchr', '$.vacancy.end_date', 2, 'FLATCHR_CONTRACT_END'],
    ['volcanic', '$.end_date', 3, 'VOLCANIC_UNQUALIFIED_LIST_END'],
  ] as const)(
    'removes only the disproved %s mapping without reactivating or refreshing a publication',
    async (kind, path, readerVersion, rule) => {
      await db.source.update({ where: { key }, data: { kind } });
      await source('retired', { end_date: '2024-01-01', vacancy: { end_date: '2024-01-01' } });
      await db.job.update({
        where: { id: 'retired' },
        data: { isActive: false, closedAt: new Date('2024-01-02T00:00:00Z') },
      });
      await db.jobSource.update({
        where: { id: 'js-retired' },
        data: {
          isActive: false,
          expiresAt: new Date('2024-01-02T12:00:00Z'),
          expiryEvidence: { readerVersion, path, value: '2024-01-01' },
        },
      });
      const before = await db.jobSource.findUniqueOrThrow({ where: { id: 'js-retired' } });
      const job = await db.job.findUniqueOrThrow({ where: { id: 'retired' } });
      const { plan } = await planSourceExpiries(db, [key]);
      expect(plan.entries[0]).toMatchObject({
        expiresAt: null,
        evidence: null,
        proof: { origin: 'RETIRED_RULE', rule },
      });
      await applySourceExpiries(db, plan, plan.planHash);
      const after = await db.jobSource.findUniqueOrThrow({ where: { id: 'js-retired' } });
      expect(after).toEqual({ ...before, expiresAt: null, expiryEvidence: null });
      expect(await db.job.findUniqueOrThrow({ where: { id: 'retired' } })).toEqual(job);
      const journal = await db.dataCorrection.findFirstOrThrow({
        where: { batchId: `source-expiry:${plan.planHash}` },
      });
      expect(journal.before).toEqual(asJson({ expiresAt: before.expiresAt, expiryEvidence: before.expiryEvidence }));
    },
  );

  it('preserves a proven deadline after a partial capture and records the original observation clock', async () => {
    const fixture = await partialObservation();
    const before = await db.jobSource.findUniqueOrThrow({ where: { id: fixture.id } });
    const { plan } = await planSourceExpiries(db, [key]);
    expect(plan.reviews).toEqual([]);
    expect(plan.entries[0]).toMatchObject({
      expiresAt: before.expiresAt!.toISOString(),
      evidence: { readerVersion: EXPIRY_READER_VERSION },
      proof: {
        origin: 'PREVIOUS_OBSERVATION',
        observationId: fixture.observation!.id,
        observedAt: fixture.observedAt.toISOString(),
      },
    });
    await applySourceExpiries(db, plan, plan.planHash);
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: fixture.id } })).toEqual({
      ...before,
      expiryEvidence: asJson(plan.entries[0].evidence),
    });
    expect(await db.maintenancePlan.findUniqueOrThrow({ where: { id: plan.planHash } })).toMatchObject({
      version: 3,
      revision: plan.revision,
      body: asJson(plan),
    });
    const witness = await db.sourceObservation.findFirstOrThrow({
      where: {
        sourceKey: key,
        externalId: before.externalId,
        contentHash: plan.entries[0].evidence!.rawHash,
        annotationHash: '',
      },
    });
    expect(witness.observedAt).toEqual(fixture.observedAt);
    expect((await planSourceExpiries(db, [key])).plan).toMatchObject({ entries: [], reviews: [] });
  });

  it.each([{ observation: false }, { future: true }, { wrongId: true }, { hold: true }, { wrongDate: true }])(
    'leaves an uncorroborated cached deadline for review: %j',
    async (options) => {
      const fixture = await partialObservation(options);
      await source('valid', payload('valid'));
      const before = await db.jobSource.findUniqueOrThrow({ where: { id: fixture.id } });
      const { plan } = await planSourceExpiries(db, [key]);
      expect(plan.reviews).toHaveLength(1);
      expect(plan.entries).toHaveLength(1);
      await expect(applySourceExpiries(db, plan, plan.planHash)).rejects.toThrow('unresolved evidence reviews');
      expect(await db.jobSource.findUniqueOrThrow({ where: { id: fixture.id } })).toEqual(before);
      expect(await db.dataCorrection.count({ where: { finding: 'SOURCE_DECLARED_EXPIRY' } })).toBe(auditBefore);
    },
  );

  it('reads the same immutable witness hot or cold, and resumes after the archive becomes unavailable', async () => {
    const { MemoryStore } = await import('../test/memoryObjectStore.js');
    const store = new MemoryStore();
    const fixture = await partialObservation();
    const hot = await planSourceExpiries(db, [key]);
    await archiveAdapterObservation(db, fixture.observation!.id, store);
    const cold = await planSourceExpiries(db, [key], undefined, 250, store);
    expect(cold.plan).toEqual(hot.plan);
    expect((await planSourceExpiries(db, [key])).plan.reviews).toMatchObject([
      { reason: 'PREVIOUS_DEADLINE_ARCHIVE_UNAVAILABLE' },
    ]);
    expect(await applySourceExpiries(db, cold.plan, cold.plan.planHash, store)).toEqual({
      written: 1,
      alreadyApplied: false,
    });
    store.objects.clear();
    expect(await applySourceExpiries(db, cold.plan, cold.plan.planHash)).toEqual({ written: 0, alreadyApplied: true });
  });

  it('rejects a corrupted cold witness before writing or reattesting anything', async () => {
    const { MemoryStore } = await import('../test/memoryObjectStore.js');
    const store = new MemoryStore();
    const fixture = await partialObservation();
    const { plan } = await planSourceExpiries(db, [key]);
    await archiveAdapterObservation(db, fixture.observation!.id, store);
    for (const objectKey of store.objects.keys()) store.objects.set(objectKey, new Uint8Array([0, 1, 2]));
    await expect(applySourceExpiries(db, plan, plan.planHash, store)).rejects.toThrow('integrity mismatch');
    expect(await db.dataCorrection.count({ where: { finding: 'SOURCE_DECLARED_EXPIRY' } })).toBe(auditBefore);
  });

  it.each(['unproved', 'unrecognized path', 'future reader'] as const)(
    'does not clear a deadline with %s',
    async (kind) => {
      await db.source.update({ where: { key }, data: { kind: 'flatchr' } });
      await source('unknown', {});
      const evidence =
        kind === 'unproved'
          ? {}
          : {
              readerVersion: kind === 'future reader' ? 999 : 1,
              path: kind === 'unrecognized path' ? '$.something' : '$.vacancy.end_date',
            };
      await db.jobSource.update({
        where: { id: 'js-unknown' },
        data: { expiresAt: new Date('2026-09-01T00:00:00Z'), expiryEvidence: evidence },
      });
      const { plan } = await planSourceExpiries(db, [key]);
      expect(plan.entries).toEqual([]);
      expect(plan.reviews).toMatchObject([{ reason: 'STORED_DEADLINE_WITHOUT_USABLE_PROOF' }]);
    },
  );

  it.each(['revision', 'duplicate', 'scope', 'extra field', 'after', 'proof'] as const)(
    'rejects a rehashed plan with modified %s',
    async (change) => {
      await source('a', payload('a'));
      let { plan } = await planSourceExpiries(db, [key]);
      if (change === 'revision') plan.revision = 'local-sha256:' + '0'.repeat(64);
      if (change === 'duplicate') plan.entries.push(plan.entries[0]);
      if (change === 'scope') plan.allowedKeys = [];
      if (change === 'extra field') Object.assign(plan, { unsafe: true });
      if (change === 'after') plan.entries[0].expiresAt = '2030-01-01T00:00:00Z';
      if (change === 'proof') Object.assign(plan.entries[0].proof, { inputHash: '0'.repeat(64) });
      plan = rehash(plan);
      await expect(applySourceExpiries(db, plan, plan.planHash)).rejects.toThrow();
      expect(await db.jobSource.count({ where: { expiresAt: { not: null } } })).toBe(0);
      expect(await db.dataCorrection.count({ where: { finding: 'SOURCE_DECLARED_EXPIRY' } })).toBe(auditBefore);
    },
  );

  it('bounds scope and validates the last page without an unnecessary extra scan', async () => {
    await source('a', payload('a'));
    await source('b', payload('b'));
    const first = await planSourceExpiries(db, [key], undefined, 1);
    const last = await planSourceExpiries(db, [key], first.nextCursor, 1);
    expect(first.nextCursor).toBe('js-a');
    expect(last.nextCursor).toBeUndefined();
    for (const limit of [0, 1001, 1.5])
      await expect(planSourceExpiries(db, [key], undefined, limit)).rejects.toThrow('page size');
    await expect(planSourceExpiries(db, [' '])).rejects.toThrow('explicit source keys');
    await expect(planSourceExpiries(db, ['unknown'])).rejects.toThrow('Unknown source');
    expect(
      await applySourceExpiries(
        db,
        (await planSourceExpiries(db, [])).plan,
        (await planSourceExpiries(db, [])).plan.planHash,
      ),
    ).toEqual({ written: 0, alreadyApplied: false });
  });

  it('checks current JSON sizes before materializing payloads', async () => {
    await source('large', { body: 'x'.repeat(32_000_001) });
    const read = vi.spyOn(db.jobSource, 'findMany');
    try {
      await expect(planSourceExpiries(db, [key])).rejects.toThrow('bounded page size');
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it('refuses a capture pointer changed after preview even when its RAW is identical', async () => {
    await source('a', payload('a'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(payload('a')))),
    );
    try {
      const capture = async () =>
        (
          await captureExtraction(
            db,
            key,
            { origin: 'https://example.com', site: 'Fixture' },
            undefined,
            async () => ({
              jobs: [
                {
                  externalId: 'a',
                  title: 'a',
                  url: jobUrl('a'),
                  raw: await fetchJson(jobUrl('a')),
                },
              ],
            }),
            'WORKDAY',
          )
        ).jobs[0];
      const first = await capture();
      await db.jobSource.update({
        where: { id: 'js-a' },
        data: { captureBatchId: first.captureBatchId, captureOutputId: first.captureOutputId },
      });
      const { plan } = await planSourceExpiries(db, [key]);
      const second = await capture();
      await db.jobSource.update({
        where: { id: 'js-a' },
        data: { captureBatchId: second.captureBatchId, captureOutputId: second.captureOutputId },
      });
      await expect(applySourceExpiries(db, plan, plan.planHash)).rejects.toThrow(
        'Stale or unsupported expiry evidence',
      );
      expect(await db.dataCorrection.count({ where: { finding: 'SOURCE_DECLARED_EXPIRY' } })).toBe(auditBefore);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('checks previous JSON sizes before materializing or reading archives', async () => {
    const id = randomUUID(),
      raw = { ...payload(id), fixture: id, body: 'x'.repeat(32_000_001) };
    await source(id, {});
    const fact = declaredExpiry('workday', raw)!;
    await db.jobSource.update({
      where: { id: `js-${id}` },
      data: {
        expiresAt: fact.expiresAt,
        expiryEvidence: asJson(fact.evidence),
        lastSeenAt: new Date('2026-09-15T00:00:00Z'),
      },
    });
    await db.sourceObservation.create({
      data: {
        sourceKey: key,
        externalId: id,
        contentHash: fact.evidence.rawHash,
        raw,
        pipelineVersion: 1,
        observedAt: new Date('2026-09-14T00:00:00Z'),
      },
    });
    const read = vi.spyOn(db.sourceObservation, 'findUniqueOrThrow');
    try {
      await expect(planSourceExpiries(db, [key])).rejects.toThrow('bounded page size');
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });
});

describe('expiry belongs to its native publication', () => {
  it.each(['native ID', 'detail URL', 'employer', 'missing native ID'] as const)(
    'blocks a declared date with invalid %s evidence',
    async (kind) => {
      const raw = payload('a');
      if (kind === 'native ID') raw.externalPath = '/job/Paris/another';
      if (kind === 'detail URL') raw.detail.jobPostingInfo.externalUrl = jobUrl('another');
      if (kind === 'employer') raw.detail.jobPostingInfo.logoImage.alt = '';
      if (kind === 'missing native ID') raw.externalPath = '';
      await source('a', raw);
      const { plan } = await planSourceExpiries(db, [key]);
      expect(plan.entries).toEqual([]);
      expect(plan.reviews).toHaveLength(1);
      await expect(applySourceExpiries(db, plan, plan.planHash)).rejects.toThrow('unresolved evidence reviews');
      expect(await db.jobSource.count({ where: { expiresAt: { not: null } } })).toBe(0);
    },
  );

  it('allows an identity-bound deadline even when its native description is missing', async () => {
    const raw = payload('a');
    raw.detail.jobPostingInfo.jobDescription = '';
    await source('a', raw);
    const { plan } = await planSourceExpiries(db, [key]);
    expect(plan.reviews).toEqual([]);
    expect(plan.entries[0].publicationProof).toMatchObject({ origin: 'RETAINED_RAW' });
    expect(await applySourceExpiries(db, plan, plan.planHash)).toEqual({ written: 1, alreadyApplied: false });
  });

  it('audits the identity even when an existing cache already matches the current date reader', async () => {
    const raw = payload('another');
    await source('a', raw);
    const stored = await db.jobSource.findUniqueOrThrow({ where: { id: 'js-a' } });
    const expiry = declaredExpiry('workday', stored.raw)!;
    await db.jobSource.update({
      where: { id: 'js-a' },
      data: { expiresAt: expiry.expiresAt, expiryEvidence: asJson(expiry.evidence) },
    });
    const { plan } = await planSourceExpiries(db, [key]);
    expect(plan.entries).toEqual([]);
    expect(plan.reviews).toHaveLength(1);
  });

  it('rejects a replaced publication proof even when the modified plan is rehashed', async () => {
    await source('a', payload('a'));
    const { plan: original } = await planSourceExpiries(db, [key]);
    original.entries[0].publicationProof = { origin: 'RETAINED_RAW', rawHash: '0'.repeat(64) };
    const plan = rehash(original);
    await expect(applySourceExpiries(db, plan, plan.planHash)).rejects.toThrow('Stale or unsupported expiry evidence');
    expect(await db.dataCorrection.count({ where: { finding: 'SOURCE_DECLARED_EXPIRY' } })).toBe(auditBefore);
  });

  async function captured(mode = 'valid', padding = 0) {
    const id = randomUUID(),
      raw = { ...payload(id), ...(padding ? { padding: 'x'.repeat(padding) } : {}) };
    if (mode === 'native-id') raw.externalPath = '/job/Paris/another';
    await source(id, raw);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(raw))),
    );
    try {
      // Record a historical reader transition; current captures now reject a mismatched reader before transport.
      if (mode === 'kind') await db.source.update({ where: { key }, data: { kind: 'lever' } });
      const result = await captureExtraction(
        db,
        mode === 'source' ? key + '-other' : key,
        { origin: 'https://example.com', site: 'Fixture' },
        undefined,
        async () => {
          const observedRaw = await fetchJson(jobUrl(id));
          return {
            jobs: [
              {
                externalId: mode === 'id' ? id + '-other' : id,
                title: 'Client Advisor',
                url: mode === 'url' ? jobUrl('another') : jobUrl(id),
                raw: mode === 'raw' ? payload('another') : observedRaw,
                ...(mode === 'held' ? { publicationHold: 'PRIVATE' } : {}),
              },
            ],
          };
        },
        mode === 'kind' ? 'LEVER' : 'WORKDAY',
      );
      if (mode === 'kind') await db.source.update({ where: { key }, data: { kind: 'workday' } });
      const job = result.jobs[0];
      await db.jobSource.update({
        where: { id: 'js-' + id },
        data: { captureBatchId: job.captureBatchId, captureOutputId: job.captureOutputId },
      });
      return { id: 'js-' + id, job };
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it('bounds the combined source RAW and immutable capture before loading its output', async () => {
    await captured('valid', 16_000_050);
    await expect(planSourceExpiries(db, [key])).rejects.toThrow('bounded page size');
  });

  it('does not inherit a captured reader error when the archived RAW carries another native ID', async () => {
    await captured('native-id');
    const { plan } = await planSourceExpiries(db, [key]);
    expect(plan.entries).toEqual([]);
    expect(plan.reviews).toMatchObject([{ reason: 'EXPIRY_PUBLICATION_DETAIL_IDENTITY_MISMATCH' }]);
  });

  it.each(['id', 'url', 'raw', 'held', 'source', 'kind'])(
    'does not fall back to retained RAW after a bad capture %s',
    async (mode) => {
      await captured(mode);
      const { plan } = await planSourceExpiries(db, [key]);
      expect(plan.entries).toEqual([]);
      expect(plan.reviews).toMatchObject([{ reason: 'EXPIRY_CAPTURE_PUBLICATION_MISMATCH' }]);
    },
  );

  it('returns the completed result when an in-flight archive read fails after another worker succeeds', async () => {
    const { MemoryStore } = await import('../test/memoryObjectStore.js');
    const { archiveRawBlob } = await import('../capture/store.js');
    const store = new MemoryStore(),
      fixture = await captured();
    const { plan } = await planSourceExpiries(db, [key]);
    const output = await db.sourceExtraction.findUniqueOrThrow({ where: { id: fixture.job.captureOutputId } });
    await archiveRawBlob(db, output.outputHash, store);
    let release!: () => void, reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const get = vi.spyOn(store, 'get').mockImplementationOnce(async () => {
      reached();
      await gate;
      throw Error('Transient archive outage');
    });
    const delayed = applySourceExpiries(db, plan, plan.planHash, store);
    try {
      await started;
      expect(await applySourceExpiries(db, plan, plan.planHash, store)).toEqual({ written: 1, alreadyApplied: false });
    } finally {
      release();
    }
    await expect(delayed).resolves.toEqual({ written: 0, alreadyApplied: true });
    get.mockRestore();
    expect(await db.dataCorrection.count({ where: { finding: 'SOURCE_DECLARED_EXPIRY' } })).toBe(auditBefore + 1);
  });

  it('verifies native output hot or cold before locking, records its provenance and resumes without archive access', async () => {
    const { MemoryStore } = await import('../test/memoryObjectStore.js');
    const { archiveRawBlob } = await import('../capture/store.js');
    const store = new MemoryStore(),
      fixture = await captured();
    const { plan: hot } = await planSourceExpiries(db, [key]);
    const output = await db.sourceExtraction.findUniqueOrThrow({ where: { id: fixture.job.captureOutputId } });
    expect(hot.entries[0].publicationProof).toEqual({
      origin: 'NATIVE_CAPTURE',
      batchId: fixture.job.captureBatchId,
      outputId: fixture.job.captureOutputId,
      outputHash: output.outputHash,
    });
    await archiveRawBlob(db, output.outputHash, store);
    expect((await planSourceExpiries(db, [key])).plan.reviews).toMatchObject([
      { reason: 'EXPIRY_CAPTURE_ARCHIVE_UNAVAILABLE' },
    ]);
    const { plan: cold } = await planSourceExpiries(db, [key], undefined, 250, store);
    expect(cold).toEqual(hot);
    const get = vi.spyOn(store, 'get');
    expect(await applySourceExpiries(db, cold, cold.planHash, store)).toEqual({ written: 1, alreadyApplied: false });
    expect(get).toHaveBeenCalledTimes(1);
    store.objects.clear();
    get.mockClear();
    expect(await applySourceExpiries(db, cold, cold.planHash)).toEqual({ written: 0, alreadyApplied: true });
    expect(get).not.toHaveBeenCalled();
    const journal = await db.dataCorrection.findFirstOrThrow({ where: { batchId: 'source-expiry:' + cold.planHash } });
    expect(journal.evidence).toMatchObject({ publicationProof: cold.entries[0].publicationProof });
  });
});
