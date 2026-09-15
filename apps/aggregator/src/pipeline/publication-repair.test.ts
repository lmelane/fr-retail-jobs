import '../test/setup-integration.js';
import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { captureExtraction } from '../capture/batch.js';
import { fetchJson } from '../lib/http.js';
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

async function publication(options: { url?: string; title?: string; description?: string; country?: string; city?: string; tier?: string; jobId?: string; validThrough?: string } = {}) {
  const key = `repair-${randomUUID()}`, url = options.url ?? application;
  await db.source.create({ data: { key, maison: 'Repair witness', kind: 'generic-listing', config: {}, tier: options.tier ?? 'EMPLOYER_DIRECT', tenantKey: key, status: 'ACTIVE' } });
  const job: NormalizedJob = { externalId: key, url, title: options.title ?? 'Client Advisor', description: options.description ?? 'Own publication description',
    country: options.country, city: options.city, raw: { title: options.title ?? 'Client Advisor', ...(options.validThrough ? { validThrough: options.validThrough } : {}), board: { row: { attrs: { 'data-applyurl': url } } } } };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(job))));
  const result = await captureExtraction(db, key, {}, undefined, async () => ({ jobs: [await fetchJson<NormalizedJob>(`https://repair.example/${key}`)] }), 'GENERIC_JSONLD');
  const native = result.jobs[0];
  const parent = options.jobId ? await db.job.findUniqueOrThrow({ where: { id: options.jobId } }) : await db.job.create({ data: {
    companyId, externalId: key, source: 'GENERIC_JSONLD', title: job.title, description: job.description, url, fingerprint: key,
    canonicalSourceKey: key, canonicalExternalId: key, canonicalTier: options.tier ?? 'EMPLOYER_DIRECT',
  } });
  const source = await db.jobSource.create({ data: { jobId: parent.id, sourceKey: key, externalId: key, sourceTier: options.tier ?? 'EMPLOYER_DIRECT',
    url, title: native.title, raw: native.raw as any, captureBatchId: native.captureBatchId, captureOutputId: native.captureOutputId } });
  return { job: parent, source };
}
const apply = (plan: GroupRepairPlan) => applyPublicationGroups(db, plan, plan.planHash);
const mergePlan = (a: Awaited<ReturnType<typeof publication>>, b: Awaited<ReturnType<typeof publication>>) => planPublicationGroups(db, {
  jobIds: [a.job.id, b.job.id], groups: [{ jobId: a.job.id, sourceIds: [a.source.id, b.source.id] }], reason: 'Same qualified native application identity in both captured publications',
});

describe('reviewed publication partitions', () => {
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

  it('requires the selected publication capture and rejects a forged reviewed patch', async () => {
    const a = await publication(), b = await publication({ tier: 'SPECIALIST_JOBBOARD' });
    const plan = await mergePlan(a, b);
    const body = { ...plan }; delete (body as Partial<GroupRepairPlan>).planHash;
    (body.groups[0].patch as Record<string, unknown>).description = 'Invented content';
    const forged = { ...body, planHash: evidenceHash(body) };
    await expect(apply(forged)).rejects.toThrow('changed');
    await db.jobSource.update({ where: { id: a.source.id }, data: { captureBatchId: null, captureOutputId: null } });
    await expect(mergePlan(a, b)).rejects.toThrow('new native capture');
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
