import { admissionFixture } from '../test/sourceAdmissionFixture.js';
import { fetchAtsJobs } from '../ats/index.js';
import { validateCapturedSource } from '../connectors/sourceValidation.js';
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
  await db.companyAlias.deleteMany(); await db.jobSource.deleteMany(); await db.job.deleteMany(); await db.company.deleteMany();
  const id = randomUUID(); companyId = (await db.company.create({ data: { name: 'Repair witness', canonicalKey: id, fashionjobsUrl: `repair:${id}` } })).id;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(async () => { await db.$executeRaw`TRUNCATE "SourceIngestionAdmission", "SourceIdentityReview"`; await db.companyAlias.deleteMany(); await db.jobSource.deleteMany(); await db.job.deleteMany(); await db.company.deleteMany(); await db.$disconnect(); });

async function publication(options: { ashby?: boolean; url?: string; title?: string; description?: string; country?: string; city?: string; tier?: string; jobId?: string; validThrough?: string; captureKind?: 'LEVER'; readerTitle?: string; readerHold?: string; readerCountry?: string; readerDescription?: string; nativeUrl?: string; omitNativeDescription?: boolean; latitude?: string } = {}) {
  const key = `repair-${randomUUID()}`, url = options.url ?? application;
  await db.source.create({ data: { key, maison: 'Repair witness', kind: options.ashby ? 'ashby' : options.captureKind ? 'lever' : 'generic-listing', config: options.ashby ? { board: 'repair' } : {}, tier: options.tier ?? 'EMPLOYER_DIRECT', tenantKey: key, status: 'ACTIVE' } });
  const raw = { '@type': 'JobPosting', identifier: { '@type': 'PropertyValue', value: key }, url: options.nativeUrl ?? url, title: options.title ?? 'Client Advisor',
    ...(options.omitNativeDescription ? {} : { description: options.description ?? 'Own publication description' }),
    jobLocation: { '@type': 'Place', ...(options.latitude ? { geo: { latitude: options.latitude, longitude: '9.1' } } : {}), address: { '@type': 'PostalAddress', addressCountry: options.country, addressLocality: options.city } },
    ...(options.validThrough ? { validThrough: options.validThrough } : {}), board: { row: { attrs: { 'data-applyurl': url } } } };
  const externalId = createHash('sha1').update(url).digest('hex');
  if (options.ashby) Object.assign(raw, { id: externalId, jobUrl: url, isListed: true,
    ...(options.omitNativeDescription ? {} : { descriptionPlain: raw.description }) });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(raw))));
  const result = await captureExtraction(db, key, options.ashby ? { board: 'repair' } : {}, undefined, async () => {
    const observed = await fetchJson<typeof raw>(`https://repair.example/${key}`);
    const parsed = normalizeGenericPosting(observed, url)!;
    // Deliberate old-reader mistakes remain inside the immutable extraction.
    const job: NormalizedJob = { ...parsed, externalId, url, ...(options.readerTitle ? { title: options.readerTitle } : {}), ...(options.readerHold ? { publicationHold: options.readerHold } : {}), ...(options.readerCountry ? { country: options.readerCountry } : {}), ...(options.readerDescription ? { description: options.readerDescription } : {}) };
    return { jobs: [job] };
  }, options.ashby ? 'ASHBY' : options.captureKind ?? 'GENERIC_JSONLD');
  if (options.captureKind) await db.source.update({ where: { key }, data: { kind: 'generic-listing' } });
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
    expect(row.isActive).toBe(false); expect(row.job!.isActive).toBe(false);
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

describe('native publications without public presentation', () => {
  async function mixed() {
    const good = await publication({ title: 'Qualified content' });
    const held = await publication({ ashby: true, jobId: good.job.id, omitNativeDescription: true, readerDescription: 'Legacy invented description', tier: 'SPECIALIST_JOBBOARD' });
    const request = { jobIds: [good.job.id], groups: [{ jobId: good.job.id, sourceIds: [good.source.id] }],
      quarantineSourceIds: [held.source.id], reason: 'Keep the native incomplete publication independently of the qualified public presentation' };
    return { good, held, request };
  }
  async function reobserve(held: Awaited<ReturnType<typeof publication>>, options: { hold?: string; config?: Record<string, unknown>; missingDescription?: boolean } = {}) {
    const { toCandidate } = await import('./ingest.js');
    const registry = await db.source.findUniqueOrThrow({ where: { key: held.source.sourceKey } });
    const settings = options.config ?? { board: 'repair' };
    const raw = { id: held.source.externalId, title: held.source.title, jobUrl: held.source.url, isListed: true,
      descriptionPlain: 'Native recovered duties', board: (held.source.raw as Record<string, unknown>).board };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ apiVersion: '1', jobs: [raw] }))));
    const work = () => fetchAtsJobs('ASHBY', settings);
    const probe = await captureExtraction(db, held.source.sourceKey, settings, undefined, work, 'ASHBY');
    await admissionFixture(db, registry, probe.captureBatchId);
    const observed = { ...raw, ...(options.hold ? { isListed: false } : {}), ...(options.missingDescription ? { descriptionPlain: undefined } : {}) };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ apiVersion: '1', jobs: [observed] }))));
    const result = await captureExtraction(db, held.source.sourceKey, settings, undefined, work, 'ASHBY',
      { revisionId: registry.currentRevisionId, requireActive: true });
    await validateCapturedSource(db, result.captureBatchId);
    const job = result.jobs[0];
    const candidate = toCandidate({ ...job, publicationHold: undefined }, { key: held.source.sourceKey, tier: 'SPECIALIST_JOBBOARD', company: 'Repair witness' }, 'Repair witness', 'ASHBY');
    await db.company.update({ where: { id: companyId }, data: { canonicalKey: candidate.companyId, fashionjobsUrl: `resolved:${candidate.companyId}` } });
    const { sourceIdentityHash } = await import('../connectors/sourceIdentity.js');
    const { normalizedEmployerName } = await import('../normalize/employerName.js');
    const source = await db.source.findUniqueOrThrow({ where: { key: held.source.sourceKey } });
    const reviewId = randomUUID();
    await db.employerIdentityReview.create({ data: { id: reviewId, statement: 'Fixture source owner is explicitly reviewed', evidence: {}, planHash: reviewId, reviewedBy: 'integration', reviewedAt: new Date() } });
    await db.companyAlias.upsert({ where: { aliasKey: held.source.sourceKey }, create: {
      aliasKey: held.source.sourceKey, sourceKey: held.source.sourceKey, displayName: 'Repair witness', normalizedName: normalizedEmployerName('Repair witness'),
      companyId, sourceHash: sourceIdentityHash(source), reviewId,
    }, update: { reviewId } });
    return candidate;
  }

  it('retains every native field, rebuilds the eligible sibling, journals and repeats once', async () => {
    const { good, held, request } = await mixed();
    const plan = await planPublicationGroups(db, request);
    expect(plan.quarantines).toEqual([{ sourceId: held.source.id, reason: 'CONTENT_MISSING', rawHash: evidenceHash(held.source.raw) }]);
    expect(await apply(plan)).toMatchObject({ quarantined: 1, groups: 1, redirects: 0 });
    const after = await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } });
    const { jobId: _job, quarantinedAt: _at, quarantineReason: _reason, presentation: _cache, ...native } = after;
    const { jobId: _oldJob, quarantinedAt: _oldAt, quarantineReason: _oldReason, presentation: _oldCache, ...beforeNative } = held.source;
    expect(native).toEqual(beforeNative);
    expect(after).toMatchObject({ jobId: null, quarantineReason: 'CONTENT_MISSING', presentation: null, isActive: true });
    expect(after.quarantinedAt).toBeInstanceOf(Date);
    expect(await db.job.findUniqueOrThrow({ where: { id: good.job.id } })).toMatchObject({ title: 'Qualified content', isActive: true });
    expect(await db.job.count()).toBe(1);
    expect(await db.jobEvent.count({ where: { type: { in: ['CLOSED', 'WITHDRAWN'] } } })).toBe(0);
    expect(await db.publicationIdentityDecision.findFirstOrThrow({ where: { sourceId: held.source.id, action: 'QUARANTINED' } })).toMatchObject({ fromJobId: good.job.id, toJobId: null });
    const audit = await db.dataCorrection.findFirstOrThrow({ where: { entityId: plan.planHash } });
    expect(audit.evidence).toMatchObject({ quarantined: [expect.objectContaining({ id: held.source.id, jobId: null })] });
    expect(await apply(plan)).toMatchObject({ alreadyApplied: true });
  });

  it('refuses complete RAW quarantine, incomplete partitions, and loss of the original public ID', async () => {
    const { good, held, request } = await mixed();
    await expect(planPublicationGroups(db, { ...request, quarantineSourceIds: [good.source.id], withdrawJobIds: [good.job.id], groups: [{ sourceIds: [held.source.id] }] })).rejects.toThrow('Recoverable publication');
    await expect(planPublicationGroups(db, { ...request, quarantineSourceIds: [] })).rejects.toThrow('Every current publication');
    await expect(planPublicationGroups(db, { ...request, groups: [{ sourceIds: [good.source.id] }] })).rejects.toThrow('original Job ID');
    await expect(planPublicationGroups(db, { ...request, quarantineSourceIds: [held.source.id, held.source.id] })).rejects.toThrow('exactly once');
  });

  it('rejects stale evidence and atomic rollback leaves both publications attached', async () => {
    const { held, request } = await mixed();
    const plan = await planPublicationGroups(db, request);
    await db.jobSource.update({ where: { id: held.source.id }, data: { lastSeenAt: new Date(0) } });
    await expect(apply(plan)).rejects.toThrow('changed');
    expect((await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } })).jobId).toBe(held.job.id);
    expect(await db.publicationIdentityDecision.count({ where: { sourceId: held.source.id } })).toBe(0);
  });

  it('does not reuse the public ID of an unproven owner for a different native application', async () => {
    const good = await publication();
    const held = await publication({ jobId: good.job.id, url: 'https://example.com/jobs/unqualified-owner', omitNativeDescription: true });
    await db.job.update({ where: { id: good.job.id }, data: { url: held.source.url, canonicalSourceKey: held.source.sourceKey, canonicalExternalId: held.source.externalId } });
    await expect(planPublicationGroups(db, { jobIds: [good.job.id], groups: [{ jobId: good.job.id, sourceIds: [good.source.id] }], quarantineSourceIds: [held.source.id], reason: 'Insufficient old owner evidence cannot authorize changing the public application identity' })).rejects.toThrow('public application identity');
    expect(await db.jobSource.count({ where: { jobId: good.job.id } })).toBe(2);
  });

  async function ownerMissing() {
    const held = await publication({ ashby: true, omitNativeDescription: true, readerDescription: 'Invented legacy content' });
    const good = await publication({ jobId: held.job.id, url: 'https://example.com/qualified-distinct', description: 'Qualified sibling own text' });
    return { held, good, request: { jobIds: [held.job.id], groups: [{ sourceIds: [good.source.id] }],
      quarantineSourceIds: [held.source.id], withdrawJobIds: [held.job.id], reason: 'Withdraw the unqualified original public identity without guessing a sibling redirect' } };
  }

  it('withdraws an unqualified historical URL, preserves native records and separates the qualified sibling', async () => {
    const { held, good, request } = await ownerMissing();
    const plan = await planPublicationGroups(db, request);
    expect(plan.redirects).toEqual([]);
    expect(plan.groups[0].jobId).not.toBe(held.job.id);
    await apply(plan);
    const old = await db.job.findUniqueOrThrow({ where: { id: held.job.id }, include: { sources: true } });
    expect(old).toMatchObject({ isActive: false, closedAt: null, mergedIntoId: null, withdrawalReason: 'PUBLICATION_UNVERIFIED',
      url: held.job.url, description: held.job.description, firstSeenAt: held.job.firstSeenAt, sources: [] });
    expect(old.withdrawnAt).toBeInstanceOf(Date);
    expect(await canonicalJobId(db, old.id)).toBe(old.id);
    expect(await db.job.findUniqueOrThrow({ where: { id: plan.groups[0].jobId } })).toMatchObject({ isActive: true, description: 'Qualified sibling own text', url: good.source.url });
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } })).toMatchObject({ jobId: null, raw: held.source.raw, isActive: held.source.isActive, lastSeenAt: held.source.lastSeenAt });
    expect(await db.jobEvent.count({ where: { jobId: old.id, type: 'WITHDRAWN' } })).toBe(1);
    expect(await db.jobEvent.count({ where: { jobId: old.id, type: { in: ['CLOSED', 'MERGED'] } } })).toBe(0);
    expect(await apply(plan)).toMatchObject({ alreadyApplied: true });
  });

  it('requires an explicit historical withdrawal and never guesses it from quarantine', async () => {
    const { request } = await ownerMissing();
    await expect(planPublicationGroups(db, { ...request, withdrawJobIds: [] })).rejects.toThrow('original Job ID');
    await expect(planPublicationGroups(db, { ...request, withdrawJobIds: ['outside'] })).rejects.toThrow('must belong');
    await expect(planPublicationGroups(db, { ...request, withdrawJobIds: [request.jobIds[0], request.jobIds[0]] })).rejects.toThrow('must belong');
    await expect(planPublicationGroups(db, { ...request, groups: [{ ...request.groups[0], jobId: request.jobIds[0] }] })).rejects.toThrow('cannot be reused');
  });

  it('cannot withdraw a qualified original owner using the incomplete sibling as an excuse', async () => {
    const { good, request } = await mixed();
    await expect(planPublicationGroups(db, { ...request, groups: [{ sourceIds: [good.source.id] }], withdrawJobIds: [good.job.id] })).rejects.toThrow('own unqualified publication anchor');
  });

  it('permits complete quarantine only while preserving every historical ID as withdrawn', async () => {
    const held = await publication({ omitNativeDescription: true });
    const plan = await planPublicationGroups(db, { jobIds: [held.job.id], groups: [], quarantineSourceIds: [held.source.id],
      withdrawJobIds: [held.job.id], reason: 'Retain the incomplete native evidence and withdraw its unqualified public page' });
    expect(await apply(plan)).toMatchObject({ groups: 0, quarantined: 1, withdrawn: 1, redirects: 0 });
    expect(await db.job.count()).toBe(1);
  });

  it('refuses to reinterpret an earlier proven closure as an unverified withdrawal', async () => {
    const { held, request } = await ownerMissing();
    const closedAt = new Date('2025-01-01T00:00:00Z');
    await db.job.update({ where: { id: held.job.id }, data: { isActive: false, closedAt } });
    await expect(planPublicationGroups(db, request)).rejects.toThrow('proven closure must retain');
    expect(await db.job.findUniqueOrThrow({ where: { id: held.job.id } })).toMatchObject({ closedAt, withdrawnAt: null });
    expect(await db.jobSource.count({ where: { jobId: held.job.id } })).toBe(2);
  });

  it('rejects a changed original anchor without detaching anything or withdrawing a page', async () => {
    const { held, good, request } = await ownerMissing();
    const plan = await planPublicationGroups(db, request);
    await db.job.update({ where: { id: held.job.id }, data: { canonicalSourceKey: good.source.sourceKey, canonicalExternalId: good.source.externalId } });
    await expect(apply(plan)).rejects.toThrow('own unqualified publication anchor');
    expect(await db.jobSource.count({ where: { jobId: held.job.id } })).toBe(2);
    expect(await db.jobEvent.count({ where: { jobId: held.job.id } })).toBe(0);
  });

  it('does not silently reclaim a withdrawn historical ID when new native evidence releases its publication', async () => {
    const { upsertDeduplicated } = await import('../dedup/upsert.js');
    const { held, request } = await ownerMissing();
    const plan = await planPublicationGroups(db, request); await apply(plan);
    const candidate = await reobserve(held);
    await upsertDeduplicated(db, candidate);
    const released = await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } });
    expect(released.jobId).not.toBeNull(); expect(released.jobId).not.toBe(held.job.id);
    expect(await db.job.findUniqueOrThrow({ where: { id: held.job.id } })).toMatchObject({ isActive: false, withdrawalReason: 'PUBLICATION_UNVERIFIED', mergedIntoId: null });
  });

  it('database guards reject unaudited detachment, reuse of a committed decision and parent deletion', async () => {
    const { good, held, request } = await mixed();
    await expect(db.job.delete({ where: { id: good.job.id } })).rejects.toThrow();
    await expect(db.jobSource.update({ where: { id: held.source.id }, data: { jobId: null, quarantinedAt: new Date(), quarantineReason: 'CONTENT_MISSING' } })).rejects.toThrow('compensating decision');
    const plan = await planPublicationGroups(db, request); await apply(plan);
    await expect(db.jobSource.update({ where: { id: held.source.id }, data: { jobId: good.job.id, quarantinedAt: null, quarantineReason: null } })).rejects.toThrow('compensating decision');
    await expect(db.jobSource.update({ where: { id: held.source.id }, data: { quarantineReason: null } })).rejects.toThrow();
    await expect(db.jobSource.update({ where: { id: held.source.id }, data: { quarantineReason: 'ALTERED_WITHOUT_REVIEW' } })).rejects.toThrow('publication transition');
    await expect(db.publicationIdentityDecision.updateMany({ where: { sourceId: held.source.id }, data: { action: 'RELEASED' } })).rejects.toThrow('immutable');
  });

  it('requires a new qualified native capture and rejects held, changed-config and incomplete captures', async () => {
    const { upsertDeduplicated } = await import('../dedup/upsert.js');
    const { held, request } = await mixed();
    const old = await reobserve(held);
    await apply(await planPublicationGroups(db, request));
    await expect(upsertDeduplicated(db, old)).rejects.toThrow('NEW_NATIVE_CAPTURE');
    await expect(reobserve(held, { config: { different: true } })).rejects.toThrow('settings differ');
    for (const options of [{ hold: 'WRONG_DETAIL' }, { missingDescription: true }]) {
      const candidate = await reobserve(held, options);
      await expect(upsertDeduplicated(db, candidate)).rejects.toThrow(/QUARANTINE_CAPTURE_NOT_QUALIFIED|QUARANTINE_RECOVERY_REQUIRED|no current validated/);
      expect((await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } })).jobId).toBeNull();
    }
  });

  it('does not publish an in-flight capture after its source configuration changes', async () => {
    const { upsertDeduplicated } = await import('../dedup/upsert.js');
    for (const quarantine of [false, true]) {
      const { held, request } = await mixed();
      if (quarantine) await apply(await planPublicationGroups(db, request));
      const candidate = await reobserve(held);
      const before = await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } });
      await db.source.update({ where: { key: held.source.sourceKey }, data: { config: { scope: 'different' } } });
      await expect(upsertDeduplicated(db, candidate)).rejects.toThrow('no longer current');
      expect(await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } })).toEqual(before);
      expect(await db.publicationIdentityDecision.count({ where: { sourceId: held.source.id, action: 'RELEASED' } })).toBe(0);
    }
  });

  it('releases into a proven sibling while preserving the publication ID and first observation', async () => {
    const { upsertDeduplicated } = await import('../dedup/upsert.js');
    const { good, held, request } = await mixed();
    await apply(await planPublicationGroups(db, request));
    const candidate = await reobserve(held);
    const outcome = await upsertDeduplicated(db, candidate);
    expect(outcome.jobId).toBe(good.job.id);
    const source = await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } });
    expect(source).toMatchObject({ jobId: good.job.id, firstSeenAt: held.source.firstSeenAt, quarantinedAt: null, quarantineReason: null, captureOutputId: candidate.captureOutputId });
    expect(source.presentation).not.toBeNull();
    expect(await db.jobSource.count()).toBe(2);
    expect(await db.publicationIdentityDecision.count({ where: { sourceId: source.id, action: 'RELEASED' } })).toBe(1);
    expect((await upsertDeduplicated(db, candidate)).outcome).toBe('UPDATED');
    expect(await db.publicationIdentityDecision.count({ where: { sourceId: source.id, action: 'RELEASED' } })).toBe(1);
  });

  it('creates an independent presentation for a newly proven distinct publication, never restoring a false group', async () => {
    const { upsertDeduplicated } = await import('../dedup/upsert.js');
    const good = await publication();
    const held = await publication({ ashby: true, jobId: good.job.id, url: 'https://example.com/jobs/separate-native-entry', omitNativeDescription: true });
    const request = { jobIds: [good.job.id], groups: [{ jobId: good.job.id, sourceIds: [good.source.id] }], quarantineSourceIds: [held.source.id], reason: 'Preserve independent native entries until their own content can be recollected' };
    await apply(await planPublicationGroups(db, request));
    const outcome = await upsertDeduplicated(db, await reobserve(held));
    expect(outcome.jobId).not.toBe(good.job.id);
    expect(await db.jobSource.count()).toBe(2);
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } })).toMatchObject({ jobId: outcome.jobId, firstSeenAt: held.source.firstSeenAt });
    expect(await db.job.findUniqueOrThrow({ where: { id: outcome.jobId } })).toMatchObject({ description: 'Native recovered duties', firstSeenAt: held.source.firstSeenAt });
  });

  it('rebuilds facts for quarantine without touching a public projection', async () => {
    const { planFactsRepair, applyFactsRepair } = await import('../facts/repair.js');
    const { good, held, request } = await mixed();
    await apply(await planPublicationGroups(db, request));
    const before = await db.job.findUniqueOrThrow({ where: { id: good.job.id } });
    const plan = await planFactsRepair(db, [held.source.sourceKey]);
    expect(plan.entries[0]).toMatchObject({ jobId: null, companyId: null, after: null });
    expect(await applyFactsRepair(db, plan, plan.planHash)).toMatchObject({ applied: 1 });
    expect(await applyFactsRepair(db, plan, plan.planHash)).toMatchObject({ alreadyApplied: 1 });
    expect(await db.job.findUniqueOrThrow({ where: { id: good.job.id } })).toEqual(before);
    expect((await planFactsRepair(db, [held.source.sourceKey])).entries).toHaveLength(0);
  });

  it('refreshes a held publication deadline without a Job closure and safely repeats its manifest', async () => {
    const { readRefreshPlan, createRefreshManifest, runRefresh } = await import('./refresh.js');
    const { good, held, request } = await mixed();
    const expiry = new Date('2020-01-01T00:00:00Z');
    await db.jobSource.update({ where: { id: held.source.id }, data: { expiresAt: expiry, expiryEvidence: { fixture: 'native deadline' } } });
    await apply(await planPublicationGroups(db, request));
    const plan = await readRefreshPlan(db, { onlyKeys: [held.source.sourceKey] });
    const manifest = await createRefreshManifest(db, plan);
    expect(manifest.entries).toEqual([expect.objectContaining({ jobSourceId: held.source.id, jobId: null, consequence: 'QUARANTINED_PUBLICATION' })]);
    expect(await runRefresh(db, { manifest })).toMatchObject({ closedSources: 1, closedJobs: 0, withdrawn: 0 });
    expect(await runRefresh(db, { manifest })).toMatchObject({ closedSources: 0 });
    expect((await db.job.findUniqueOrThrow({ where: { id: good.job.id } })).isActive).toBe(true);
    expect((await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } })).isActive).toBe(false);
    expect(await db.jobEvent.count({ where: { jobId: good.job.id, type: 'CLOSED' } })).toBe(0);
  });

  it('retires quarantined observations of a retired source without touching the surviving publication', async () => {
    const { withdrawRetiredSource } = await import('./deactivateSources.js');
    const { good, held, request } = await mixed();
    await apply(await planPublicationGroups(db, request));
    expect(await withdrawRetiredSource(db, { sourceKey: held.source.sourceKey })).toMatchObject({ sourcesDeactivated: 1, jobsClosed: 0, jobsWithdrawn: 0 });
    expect(await withdrawRetiredSource(db, { sourceKey: held.source.sourceKey })).toMatchObject({ sourcesDeactivated: 0 });
    expect((await db.job.findUniqueOrThrow({ where: { id: good.job.id } })).isActive).toBe(true);
    expect((await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } })).quarantinedAt).not.toBeNull();
    expect(await db.dataCorrection.count({ where: { entityId: held.source.id, finding: 'QUARANTINE_SOURCE_DEACTIVATION' } })).toBe(1);
  });

  it('rebuilds a native deadline for quarantine without renewing its observation', async () => {
    const { planSourceExpiries, applySourceExpiries } = await import('./sourceExpiry.js');
    const good = await publication(), held = await publication({ jobId: good.job.id, omitNativeDescription: true, validThrough: '2030-01-01T00:00:00Z' });
    await apply(await planPublicationGroups(db, { jobIds: [good.job.id], groups: [{ jobId: good.job.id, sourceIds: [good.source.id] }], quarantineSourceIds: [held.source.id], reason: 'Missing description does not invalidate the native identity or its stated deadline' }));
    const { plan } = await planSourceExpiries(db, [held.source.sourceKey]);
    expect(plan.entries).toEqual([expect.objectContaining({ jobId: null, companyId: null })]);
    expect(await applySourceExpiries(db, plan, plan.planHash)).toMatchObject({ written: 1 });
    expect(await applySourceExpiries(db, plan, plan.planHash)).toMatchObject({ alreadyApplied: true });
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } })).toMatchObject({ jobId: null, lastSeenAt: held.source.lastSeenAt, expiresAt: new Date('2030-01-01T00:00:00Z') });
  });

  it.each([false, true])('accepts proven absence of a quarantined publication; rejects a later proof change=%s', async changed => {
    const { attestSyntheticFeed, collectAdmittedWithoutCompletion } = await import('../test/ingestionFixture.js');
    const { readRefreshPlan, createRefreshManifest, runRefresh } = await import('./refresh.js');
    const { held, request } = await mixed();
    await db.jobSource.update({ where: { id: held.source.id }, data: { lastSeenAt: new Date(Date.now() - 72 * 3_600_000) } });
    await apply(await planPublicationGroups(db, request));
    await attestSyntheticFeed(db, held.source.sourceKey, []);
    const manifest = await createRefreshManifest(db, await readRefreshPlan(db, { onlyKeys: [held.source.sourceKey] }));
    expect(manifest.entries[0]).toMatchObject({ jobId: null, state: 'ABSENT_FROM_PROVEN_ENUMERATION' });
    // A newer attempt that observes the publication again, still without a completion, replaces the frozen proof.
    if (changed) await collectAdmittedWithoutCompletion(db, held.source.sourceKey, [{ id: held.source.externalId, url: held.source.url }]);
    expect(await runRefresh(db, { manifest })).toMatchObject({ closedSources: changed ? 0 : 1, closedJobs: 0 });
    expect((await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } })).isActive).toBe(changed);
  });

  it('cannot let a frozen quarantine refresh close a newly released publication', async () => {
    const { attestSyntheticFeed } = await import('../test/ingestionFixture.js');
    const { readRefreshPlan, createRefreshManifest, runRefresh } = await import('./refresh.js');
    const { upsertDeduplicated } = await import('../dedup/upsert.js');
    const { held, request } = await mixed();
    await db.jobSource.update({ where: { id: held.source.id }, data: { lastSeenAt: new Date(Date.now() - 72 * 3_600_000) } });
    await apply(await planPublicationGroups(db, request));
    await attestSyntheticFeed(db, held.source.sourceKey, []);
    const manifest = await createRefreshManifest(db, await readRefreshPlan(db, { onlyKeys: [held.source.sourceKey] }));
    const released = await upsertDeduplicated(db, await reobserve(held));
    expect(await runRefresh(db, { manifest })).toMatchObject({ closedSources: 0, closedJobs: 0 });
    expect((await db.jobSource.findUniqueOrThrow({ where: { id: held.source.id } })).isActive).toBe(true);
    expect((await db.job.findUniqueOrThrow({ where: { id: released.jobId } })).isActive).toBe(true);
  });
});
