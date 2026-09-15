import '../test/setup-integration.js';
import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';
import { captureExtraction } from '../capture/batch.js';
import { fetchJson } from '../lib/http.js';
import { normalizeGenericPosting } from '../ats/adapters/genericJsonLd.js';
import { applyPublicationGroups, planPublicationGroups, type GroupRepairPlan } from '../dedup/repair.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import type { NormalizedJob } from '../types.js';
import { canonicalJobId } from '@catwalks/db';

const db = new PrismaClient();
let companyId: string;
const application = 'https://jobaffinity.fr/apply/repair123456789';
beforeEach(async () => {
  await db.jobSource.deleteMany(); await db.job.deleteMany(); await db.company.deleteMany();
  const id = randomUUID(); companyId = (await db.company.create({ data: { name: 'Repair witness', canonicalKey: id, fashionjobsUrl: `repair:${id}` } })).id;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(async () => { await db.jobSource.deleteMany(); await db.job.deleteMany(); await db.company.deleteMany(); await db.$disconnect(); });

async function publication(options: { url?: string; title?: string; description?: string; country?: string; city?: string; tier?: string; jobId?: string; validThrough?: string; captureKind?: 'LEVER'; readerTitle?: string; readerHold?: string; readerCountry?: string; readerDescription?: string; nativeUrl?: string; omitNativeDescription?: boolean; latitude?: string } = {}) {
  const key = `repair-${randomUUID()}`, url = options.url ?? application;
  await db.source.create({ data: { key, maison: 'Repair witness', kind: 'generic-listing', config: {}, tier: options.tier ?? 'EMPLOYER_DIRECT', tenantKey: key, status: 'ACTIVE' } });
  const raw = { '@type': 'JobPosting', identifier: { '@type': 'PropertyValue', value: key }, url: options.nativeUrl ?? url, title: options.title ?? 'Client Advisor',
    ...(options.omitNativeDescription ? {} : { description: options.description ?? 'Own publication description' }),
    jobLocation: { '@type': 'Place', ...(options.latitude ? { geo: { latitude: options.latitude, longitude: '9.1' } } : {}), address: { '@type': 'PostalAddress', addressCountry: options.country, addressLocality: options.city } },
    ...(options.validThrough ? { validThrough: options.validThrough } : {}), board: { row: { attrs: { 'data-applyurl': url } } } };
  const externalId = createHash('sha1').update(url).digest('hex');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(raw))));
  const result = await captureExtraction(db, key, {}, undefined, async () => {
    const observed = await fetchJson<typeof raw>(`https://repair.example/${key}`);
    const parsed = normalizeGenericPosting(observed, url)!;
    // Deliberate old-reader mistakes remain inside the immutable extraction.
    const job: NormalizedJob = { ...parsed, externalId, url, ...(options.readerTitle ? { title: options.readerTitle } : {}), ...(options.readerHold ? { publicationHold: options.readerHold } : {}), ...(options.readerCountry ? { country: options.readerCountry } : {}), ...(options.readerDescription ? { description: options.readerDescription } : {}) };
    return { jobs: [job] };
  }, options.captureKind ?? 'GENERIC_JSONLD');
  const native = result.jobs[0];
  const parent = options.jobId ? await db.job.findUniqueOrThrow({ where: { id: options.jobId } }) : await db.job.create({ data: {
    companyId, externalId, source: 'GENERIC_JSONLD', title: native.title, description: native.description, url, fingerprint: key,
    canonicalSourceKey: key, canonicalExternalId: externalId, canonicalTier: options.tier ?? 'EMPLOYER_DIRECT',
  } });
  const source = await db.jobSource.create({ data: { jobId: parent.id, sourceKey: key, externalId, sourceTier: options.tier ?? 'EMPLOYER_DIRECT',
    url, title: native.title, raw: native.raw as any, captureBatchId: native.captureBatchId, captureOutputId: native.captureOutputId } });
  return { job: parent, source };
}
const apply = (plan: GroupRepairPlan) => applyPublicationGroups(db, plan, plan.planHash);
const mergePlan = (a: Awaited<ReturnType<typeof publication>>, b: Awaited<ReturnType<typeof publication>>) => planPublicationGroups(db, {
  jobIds: [a.job.id, b.job.id], groups: [{ jobId: a.job.id, sourceIds: [a.source.id, b.source.id] }], reason: 'Same qualified native application identity in both captured publications',
});

describe('reviewed publication partitions', () => {
  it('preserves numeric RAW-derived facts, presentation and audit values through application', async () => {
    const a = await publication({ latitude: '48.775130000000004', country: 'DE', city: 'Stuttgart' });
    const plan = await planPublicationGroups(db, { jobIds: [a.job.id], groups: [{ jobId: a.job.id, sourceIds: [a.source.id] }], reason: 'Preserve exact native coordinates through the reviewed maintenance plan' });
    const expected = plan.groups[0].presentations[0];
    expect(expected.cache).toMatchObject({ values: { latitude: 48.775130000000004 } });
    await apply(plan);
    const source = await db.jobSource.findUniqueOrThrow({ where: { id: a.source.id } });
    const [coordinates] = await db.$queryRaw<Array<{ latitude: string }>>`SELECT latitude::text AS latitude FROM "Job" WHERE id=${a.job.id}`;
    expect(Number(coordinates.latitude)).toBe(48.775130000000004);
    expect((await db.job.findUniqueOrThrow({ where: { id: a.job.id } })).raw).toEqual(a.source.raw);
    expect(source.sourceFacts).toEqual(expected.facts);
    expect(source.presentation).toEqual(expected.cache);
    const audit = await db.dataCorrection.findFirstOrThrow({ where: { entityId: plan.planHash } });
    expect((audit.after as any[])[0].sources[0].presentation).toEqual(expected.cache);
    expect(await apply(plan)).toMatchObject({ alreadyApplied: true });
  });

  it('rebuilds captured content with the current RAW reader instead of repeating an old reader error', async () => {
    const a = await publication({ title: 'Native title', country: 'FR', readerTitle: 'Wrong old title', readerCountry: 'US' });
    const request = { jobIds: [a.job.id], groups: [{ jobId: a.job.id, sourceIds: [a.source.id] }], reason: 'Rebuild the captured publication from its own native input' };
    const plan = await planPublicationGroups(db, request);
    const output = await db.sourceExtraction.findUniqueOrThrow({ where: { id: a.source.captureOutputId! } });
    expect(plan.groups[0].patch).toMatchObject({ title: 'Native title', countryCode: 'FR' });
    expect(plan.groups[0].presentations[0].proof).toMatchObject({ origin: 'NATIVE_CAPTURE', captureOutputHash: output.outputHash });
    expect(plan.groups[0].presentations[0].outputHash).not.toBe(output.outputHash);
    const captures = await db.captureBatch.count();
    await apply(plan);
    expect(await db.job.findUniqueOrThrow({ where: { id: a.job.id } })).toMatchObject({ title: 'Native title', countryCode: 'FR' });
    const source = await db.jobSource.findUniqueOrThrow({ where: { id: a.source.id } });
    expect(source).toMatchObject({ raw: a.source.raw, lastSeenAt: a.source.lastSeenAt, captureOutputId: a.source.captureOutputId });
    expect(await db.captureBatch.count()).toBe(captures);
    const audit = await db.dataCorrection.findFirstOrThrow({ where: { entityId: plan.planHash } });
    expect(audit.evidence).toMatchObject({ outputs: [expect.objectContaining({ captureOutputHash: output.outputHash, outputHash: plan.groups[0].outputHash })] });
  });

  it.each([
    { nativeUrl: 'https://example.com/another-native-publication' },
    { omitNativeDescription: true, readerDescription: 'Content invented by the old reader' },
  ])('does not let an archived output bypass native identity or missing content (%s)', async invalid => {
      const a = await publication(invalid);
      await expect(planPublicationGroups(db, { jobIds: [a.job.id], groups: [{ jobId: a.job.id, sourceIds: [a.source.id] }], reason: 'Verify native evidence even for immutable captured outputs' })).rejects.toThrow('PUBLICATION_RECOVERY_REQUIRED');
  });

  it('keeps a captured hold and rejects a substituted adapter even when the current RAW is readable', async () => {
    const held = await publication({ readerHold: 'CAPTURED_IDENTITY_HOLD' });
    const request = (a: typeof held) => ({ jobIds: [a.job.id], groups: [{ jobId: a.job.id, sourceIds: [a.source.id] }], reason: 'Verify original capture state and adapter independently of the current RAW reader' });
    await expect(planPublicationGroups(db, request(held))).rejects.toThrow('Captured publication is held');
    const changed = await publication({ captureKind: 'LEVER' });
    await expect(planPublicationGroups(db, request(changed))).rejects.toThrow('Captured adapter type differs');
  });

  it('prefetches the original archive hash while recording a distinct rebuilt output hash', async () => {
    const { MemoryStore } = await import('../test/memoryObjectStore.js');
    const { archiveRawBlob } = await import('../capture/store.js');
    const store = new MemoryStore(), a = await publication({ readerTitle: 'Old incorrect title' });
    const request = { jobIds: [a.job.id], groups: [{ jobId: a.job.id, sourceIds: [a.source.id] }], reason: 'Rebuild from cold evidence before acquiring the write locks' };
    const hot = await planPublicationGroups(db, request);
    const output = await db.sourceExtraction.findUniqueOrThrow({ where: { id: a.source.captureOutputId! } });
    await archiveRawBlob(db, output.outputHash, store);
    const cold = await planPublicationGroups(db, request, store);
    expect(cold).toEqual(hot);
    const get = vi.spyOn(store, 'get');
    await expect(applyPublicationGroups(db, cold, cold.planHash, store)).resolves.toMatchObject({ alreadyApplied: false });
    expect(get).toHaveBeenCalledTimes(1);
    store.objects.clear();get.mockClear();
    expect(await applyPublicationGroups(db, cold, cold.planHash)).toMatchObject({ alreadyApplied: true });
    expect(get).not.toHaveBeenCalled();
  });

  it('recognizes a concurrent completion when its own prefetch subsequently fails', async () => {
    const { MemoryStore } = await import('../test/memoryObjectStore.js');
    const { archiveRawBlob } = await import('../capture/store.js');
    const store = new MemoryStore(), a = await publication();
    const plan = await planPublicationGroups(db, { jobIds: [a.job.id], groups: [{ jobId: a.job.id, sourceIds: [a.source.id] }], reason: 'Resume an exact plan after a concurrent application completes' });
    const output = await db.sourceExtraction.findUniqueOrThrow({ where: { id: a.source.captureOutputId! } });
    await archiveRawBlob(db, output.outputHash, store);
    vi.spyOn(store, 'get').mockImplementationOnce(async () => {
      expect(await applyPublicationGroups(db, plan, plan.planHash, store)).toMatchObject({ alreadyApplied: false });
      throw Error('Late archive read failure');
    });
    await expect(applyPublicationGroups(db, plan, plan.planHash, store)).resolves.toMatchObject({ alreadyApplied: true });
    expect(await db.dataCorrection.count({ where: { entityId: plan.planHash } })).toBe(1);
  });

  it('merges only proven publications, replaces the complete presentation from its owner, and replays once', async () => {
    const a = await publication({ tier: 'SPECIALIST_JOBBOARD', title: 'Paris board title', city: 'Paris', country: 'FR', description: 'Board description' });
    const b = await publication({ url: `${application}?employer=1`, title: 'New York title', city: 'New York', country: 'US', description: 'Employer description' });
    await db.job.update({ where: { id: a.job.id }, data: { city: 'Paris', countryCode: 'FR', inseeCode: '75056', adminArea2: 'Paris' } });
    const beforeSources = await db.jobSource.findMany({ orderBy: { id: 'asc' } });
    const plan = await mergePlan(a, b);
    expect(await apply(plan)).toMatchObject({ alreadyApplied: false, groups: 1, redirects: 1 });
    expect(await db.job.findUniqueOrThrow({ where: { id: a.job.id } })).toMatchObject({ title: 'New York title', description: 'Employer description',
      city: 'New York', countryCode: 'US', inseeCode: null, adminArea2: null, canonicalSourceKey: b.source.sourceKey });
    expect(await db.job.findUniqueOrThrow({ where: { id: b.job.id } })).toMatchObject({ mergedIntoId: a.job.id, isActive: false });
    const afterSources = await db.jobSource.findMany({ orderBy: { id: 'asc' } });
    expect(afterSources.map(({ jobId: _job, sourceFacts: _facts, presentation: _presentation, ...source }) => source)).toEqual(beforeSources.map(({ jobId: _job, sourceFacts: _facts, presentation: _presentation, ...source }) => source));
    expect(afterSources.every(source => source.presentation !== null)).toBe(true);
    expect(await db.publicationIdentityDecision.count({ where: { fromJobId: b.job.id, toJobId: a.job.id, action: 'MOVED' } })).toBe(1);
    expect(await apply(plan)).toMatchObject({ alreadyApplied: true });
    expect(await db.dataCorrection.count({ where: { entityId: plan.planHash } })).toBe(1);
  });

  it('separates an unproven historical group without copying another publication content', async () => {
    const a = await publication({ title: 'Paris', description: 'Paris own description', city: 'Paris', country: 'FR' });
    const b = await publication({ jobId: a.job.id, url: 'https://example.com/jobs/distinct', title: 'Tokyo', description: 'Tokyo own description', city: 'Tokyo', country: 'JP' });
    const plan = await planPublicationGroups(db, { jobIds: [a.job.id], groups: [{ jobId: a.job.id, sourceIds: [a.source.id] }, { sourceIds: [b.source.id] }], reason: 'No shared native identity; preserve both distinct publications' });
    await apply(plan);
    const moved = await db.jobSource.findUniqueOrThrow({ where: { id: b.source.id }, include: { job: true } });
    expect(moved.jobId).not.toBe(a.job.id);
    expect(moved.job).toMatchObject({ title: 'Tokyo', description: 'Tokyo own description', countryCode: 'JP', city: 'Tokyo', salaryMin: null });
    expect(await db.job.findUniqueOrThrow({ where: { id: a.job.id } })).toMatchObject({ title: 'Paris', description: 'Paris own description', countryCode: 'FR' });
    expect(await db.publicationIdentityDecision.count({ where: { sourceId: b.source.id, action: 'SEPARATED' } })).toBe(1);
  });

  it('restores an absorbed Job ID, preserves its merge history and permits a later reviewed merge', async () => {
    const a = await publication({ tier: 'SPECIALIST_JOBBOARD', description: 'Board own text' });
    const b = await publication({ description: 'Employer own text' });
    await apply(await mergePlan(a, b));
    expect(await canonicalJobId(db, b.job.id)).toBe(a.job.id);
    await expect(db.job.update({ where: { id: b.job.id }, data: { mergedIntoId: null } })).rejects.toThrow('compensating');
    const restore = await planPublicationGroups(db, { jobIds: [a.job.id, b.job.id], groups: [
      { jobId: a.job.id, sourceIds: [a.source.id] }, { jobId: b.job.id, sourceIds: [b.source.id] },
    ], reason: 'Reviewed restoration of each original native publication and URL' });
    await apply(restore);
    expect(await canonicalJobId(db, b.job.id)).toBe(b.job.id);
    expect(await db.job.findUniqueOrThrow({ where: { id: b.job.id } })).toMatchObject({ mergedIntoId: null, isActive: true, description: 'Employer own text' });
    expect(await db.jobEvent.count({ where: { jobId: b.job.id, type: 'MERGED' } })).toBe(1);
    expect(await db.publicationIdentityDecision.count({ where: { toJobId: b.job.id, action: 'RESTORED' } })).toBe(1);
    await apply(await mergePlan(a, b));
    expect(await db.jobEvent.count({ where: { jobId: b.job.id, type: 'MERGED' } })).toBe(2);
    // A committed restoration decision cannot authorize another transaction.
    await expect(db.job.update({ where: { id: b.job.id }, data: { mergedIntoId: null } })).rejects.toThrow('compensating');
  });

  it('refuses an unproven merge, a partial partition and duplicate membership', async () => {
    const a = await publication(), b = await publication({ url: 'https://example.com/different' });
    await expect(mergePlan(a, b)).rejects.toThrow('pairwise');
    await expect(planPublicationGroups(db, { jobIds: [a.job.id, b.job.id], groups: [{ jobId: a.job.id, sourceIds: [a.source.id] }], reason: 'Partial group must fail' })).rejects.toThrow('Every current publication');
    await expect(planPublicationGroups(db, { jobIds: [a.job.id], groups: [{ jobId: a.job.id, sourceIds: [a.source.id, a.source.id] }], reason: 'Duplicate group must fail' })).rejects.toThrow('exactly once');
  });

  it('serializes two applications of the same plan without duplicate decisions', async () => {
    const a = await publication(), b = await publication(); const plan = await mergePlan(a, b);
    const results = await Promise.all([apply(plan), apply(plan)]);
    expect(results.map(result => result.alreadyApplied).sort()).toEqual([false, true]);
    expect(await db.publicationIdentityDecision.count({ where: { fromJobId: b.job.id, toJobId: a.job.id } })).toBe(1);
  });

  it('does not combine differing publisher opportunity classifications', async () => {
    const a = await publication(), b = await publication();
    await db.job.update({ where: { id: a.job.id }, data: { opportunityType: 'OPEN_APPLICATION' } });
    await db.job.update({ where: { id: b.job.id }, data: { opportunityType: 'JOB_OPENING' } });
    await expect(mergePlan(a, b)).rejects.toThrow('Conflicting opportunity types');
  });

  it('bounds native payload size before loading a repair component', async () => {
    const a = await publication(), b = await publication();
    await db.job.update({ where: { id: a.job.id }, data: { description: 'x'.repeat(32_000_001) } });
    await expect(mergePlan(a, b)).rejects.toThrow('input budget');
  });

  it.each(['raw', 'configuration', 'owner'] as const)('refuses changed %s after preview without moving publications', async field => {
    const a = await publication(), b = await publication(); const plan = await mergePlan(a, b);
    if (field === 'raw') await db.jobSource.update({ where: { id: b.source.id }, data: { raw: { changed: true } } });
    if (field === 'configuration') await db.source.update({ where: { key: b.source.sourceKey }, data: { config: { changed: true } } });
    if (field === 'owner') await db.job.update({ where: { id: a.job.id }, data: { canonicalSourceKey: 'changed' } });
    await expect(apply(plan)).rejects.toThrow();
    expect((await db.jobSource.findUniqueOrThrow({ where: { id: b.source.id } })).jobId).toBe(b.job.id);
    expect(await db.dataCorrection.count({ where: { entityId: plan.planHash } })).toBe(0);
  });

  it('requires a qualified publication input and rejects a forged reviewed patch', async () => {
    const a = await publication(), b = await publication({ tier: 'SPECIALIST_JOBBOARD' });
    const plan = await mergePlan(a, b);
    const body = { ...plan }; delete (body as Partial<GroupRepairPlan>).planHash;
    (body.groups[0].patch as Record<string, unknown>).description = 'Invented content';
    const forged = { ...body, planHash: evidenceHash(body) };
    await expect(apply(forged)).rejects.toThrow('changed');
    await db.jobSource.update({ where: { id: a.source.id }, data: { captureBatchId: null, captureOutputId: null, raw: { '@type': 'JobPosting', title: 'Unbound native publication', board: { row: { attrs: { 'data-applyurl': application } } } } } });
    await expect(mergePlan(a, b)).rejects.toThrow('PUBLICATION_RECOVERY_REQUIRED');
  });

  it('rolls back presentation, membership and journal together when the transfer fails', async () => {
    const a = await publication(), b = await publication(); const plan = await mergePlan(a, b);
    await db.$executeRawUnsafe(`CREATE FUNCTION test_reject_publication_move() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test transfer interruption'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_reject_publication_move BEFORE UPDATE OF "jobId" ON "JobSource" FOR EACH ROW EXECUTE FUNCTION test_reject_publication_move()`);
    try {
      await expect(apply(plan)).rejects.toThrow('test transfer interruption');
      expect((await db.jobSource.findUniqueOrThrow({ where: { id: b.source.id } })).jobId).toBe(b.job.id);
      expect(await db.publicationIdentityDecision.count({ where: { fromJobId: b.job.id } })).toBe(0);
      expect(await db.dataCorrection.count({ where: { entityId: plan.planHash } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER test_reject_publication_move ON "JobSource"');
      await db.$executeRawUnsafe('DROP FUNCTION test_reject_publication_move()');
    }
  });

  it('refuses an availability transition between preview and apply', async () => {
    const a = await publication(), b = await publication();
    const deadline = new Date(Date.now() + 60_000);
    await db.jobSource.updateMany({ where: { id: { in: [a.source.id, b.source.id] } }, data: { expiresAt: deadline } });
    const plan = await mergePlan(a, b);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(deadline.getTime() + 1));
    await expect(apply(plan)).rejects.toThrow('changed');
  });

  it.each(['retired', 'unverified', 'expired', 'unproven-expiry'] as const)('preserves the %s disposition of a separated publication', async disposition => {
    const deadline = new Date(Date.now() - 1000);
    const a = await publication(), b = await publication({ jobId: a.job.id, url: 'https://example.com/separate-inactive',
      ...(disposition === 'expired' ? { validThrough: deadline.toISOString() } : {}) });
    await db.jobSource.update({ where: { id: b.source.id }, data: { isActive: false,
      ...(disposition === 'expired' || disposition === 'unproven-expiry' ? { expiresAt: deadline } : {}) } });
    if (disposition === 'retired') await db.source.update({ where: { key: b.source.sourceKey }, data: { status: 'RETIRED' } });
    const plan = await planPublicationGroups(db, { jobIds: [a.job.id], groups: [{ jobId: a.job.id, sourceIds: [a.source.id] }, { sourceIds: [b.source.id] }],
      reason: 'Separate the inactive publication while preserving its actual disposition' });
    await apply(plan);
    const row = await db.jobSource.findUniqueOrThrow({ where: { id: b.source.id }, include: { job: true } });
    expect(row.isActive).toBe(false); expect(row.job.isActive).toBe(false);
    expect(row.job).toMatchObject(disposition === 'expired'
      ? { closedAt: expect.any(Date), withdrawnAt: null, withdrawalReason: null }
      : { closedAt: null, withdrawnAt: expect.any(Date), withdrawalReason: disposition === 'retired' ? 'SOURCE_RETIRED' : 'ATTESTATION_MISSING' });
    expect((await db.job.findUniqueOrThrow({ where: { id: a.job.id } })).isActive).toBe(true);
  });

  it('refuses to restore an unrelated historical URL without its original publication anchor', async () => {
    const a = await publication();
    const old = await db.job.create({ data: { companyId, externalId: 'unrelated', fingerprint: 'unrelated', source: 'GENERIC_JSONLD', title: 'Unrelated old job', url: 'https://example.com/unrelated',
      isActive: false, mergedIntoId: a.job.id, canonicalSourceKey: 'unrelated', canonicalExternalId: 'unrelated',
      events: { create: { type: 'MERGED', field: 'mergedInto', after: a.job.id } } } });
    await expect(planPublicationGroups(db, { jobIds: [a.job.id, old.id], groups: [{ jobId: old.id, sourceIds: [a.source.id] }], reason: 'Attempt to reassign an unrelated historical URL' })).rejects.toThrow('original native publication anchor');
  });
});
