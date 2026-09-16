import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import { publicationFixture } from '../test/publication-fixture.js';
import '../test/setup-integration.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { CandidateJob } from '../dedup/match.js';
import { runRefresh, readRefreshPlan } from './refresh.js';
import { publicJobWhere } from '@catwalks/db/availability';
import { EXPIRY_READER_VERSION } from '../normalize/expiry.js';

const db = new PrismaClient();
const past = new Date(Date.now() - 3_600_000);
const future = new Date(Date.now() + 3_600_000);
const candidate = (id: string, raw: unknown, sourceKey = 'expiry-witness'): CandidateJob & { companyId: string } => ({
  company: 'Expiry witness', companyId: 'expiry-witness', sourceKey, sourceTier: 'EMPLOYER_DIRECT',
  externalId: id, title: 'Client Advisor', country: 'FR', city: 'Paris',
  url: `https://example.com/${sourceKey}/${id}`, atsType: 'GENERIC_JSONLD', raw,
});
const wipe = async () => {
  await db.jobSource.deleteMany(); await db.job.deleteMany(); await db.company.deleteMany(); await db.sourceRun.deleteMany();
};
beforeEach(wipe);
afterAll(async () => { await wipe(); await db.$disconnect(); });

describe('publication deadlines', () => {
  it.each([
    ['GREENHOUSE', { application_deadline: '2024-01-01T12:00:00Z' }],
    ['EASYCRUIT', { detail: { '@_date_end': '2024-01-01' } }],
    ['TALENTVIEW', { detail: { date_end: '2024-01-01' } }],
    ['VOLCANIC', { postingEvidence: { jobPosting: { validThrough: '2024-01-01T12:00:00Z' } } }],
  ] as const)('excludes the native expired publication for %s on ingestion', async (atsType, raw) => {
    const { jobId } = await upsertDeduplicated(db, { ...candidate('native-deadline', raw), atsType });
    expect(await db.jobSource.findFirstOrThrow({ where: { jobId } })).toMatchObject({ isActive: false, expiresAt: expect.any(Date) });
    expect(await db.job.count({ where: { ...publicJobWhere(), id: jobId } })).toBe(0);
    expect(await db.jobEvent.count({ where: { jobId, type: 'CLOSED' } })).toBe(1);
  });

  it('archives an already expired publication without opening it', async () => {
    const { jobId } = await upsertDeduplicated(db, candidate('past', { validThrough: past.toISOString() }));
    const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { sources: true, events: true } });
    expect(job).toMatchObject({ isActive: false, closedAt: expect.any(Date) });
    expect(job.sources[0]).toMatchObject({ isActive: false, expiresAt: past,
      expiryEvidence: { path: '$.validThrough', value: past.toISOString(), readerVersion: EXPIRY_READER_VERSION } });
    expect(job.events.map(event => event.type)).toEqual(['CLOSED']);
    expect(await db.sourceObservation.count()).toBeGreaterThan(0);
  });

  it('stores the native maximum calendar date without inventing a representable deadline', async () => {
    const input = { ...candidate('maximum-date', { vacancy: { validTo: '9999-12-31' } }), atsType: 'TALENT_FUNNEL' as const };
    const { jobId } = await upsertDeduplicated(db, input);
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ isActive: true });
    expect(await db.jobSource.findFirstOrThrow({ where: { jobId } })).toMatchObject({ expiresAt: null,
      expiryEvidence: { value: '9999-12-31', status: 'BEYOND_STORAGE_RANGE' } });
  });

  it('does not close a Flatchr publication because its contract end is past', async () => {
    const raw = { vacancy: { contract_type: 'CDD', end_date: past.toISOString() } };
    const { jobId } = await upsertDeduplicated(db, { ...candidate('contract-end', raw), atsType: 'FLATCHR' });
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ isActive: true, closedAt: null });
    expect(await db.jobSource.findFirstOrThrow({ where: { jobId } })).toMatchObject({ isActive: true, expiresAt: null, expiryEvidence: null, raw });
    expect(await db.jobEvent.count({ where: { jobId, type: 'CLOSED' } })).toBe(0);
  });

  it('does not use the grouped normalized deadline as evidence for a publication', async () => {
    const { jobId } = await upsertDeduplicated(db, { ...candidate('unproven', {}), validThrough: past });
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ isActive: true });
    expect(await db.jobSource.findFirstOrThrow({ where: { jobId } })).toMatchObject({ expiresAt: null, expiryEvidence: null });
  });

  it('preserves an expired deadline after a partial capture and reopens only on a new future deadline', async () => {
    const input = candidate('reopen', { validThrough: past.toISOString() });
    const { jobId } = await upsertDeduplicated(db, input);
    await upsertDeduplicated(db, { ...input, raw: { detailReadError: 'timeout' } });
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ isActive: false, reopenedCount: 0 });
    expect(await db.jobSource.findFirstOrThrow({ where: { jobId } })).toMatchObject({ isActive: false, expiresAt: past });
    await upsertDeduplicated(db, { ...input, raw: { validThrough: future.toISOString() } });
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ isActive: true, closedAt: null, reopenedCount: 1 });
    expect(await db.jobEvent.count({ where: { jobId, type: 'REOPENED' } })).toBe(1);
  });

  it('a recently observed publication expires even without a usable enumeration', async () => {
    const { jobId } = await upsertDeduplicated(db, candidate('elapsed', { validThrough: future.toISOString() }));
    await db.jobSource.updateMany({ where: { jobId }, data: { expiresAt: past } });
    // The clock guard hides it before the maintenance job writes the closure.
    expect(await db.job.count({ where: publicJobWhere() })).toBe(0);
    const plan = await readRefreshPlan(db, { onlyKeys: ['expiry-witness'] });
    expect(plan.wouldClose).toEqual([jobId]);
    expect(plan.expiredSources).toHaveLength(1);
    expect(await runRefresh(db, { onlyKeys: ['expiry-witness'] })).toMatchObject({ closedSources: 1, closedJobs: 1 });
    expect(await runRefresh(db, { onlyKeys: ['expiry-witness'] })).toMatchObject({ closedSources: 0, closedJobs: 0 });
    expect(await db.jobEvent.count({ where: { jobId, type: 'CLOSED' } })).toBe(1);
  });

  it('keeps another publication alive and switches the apply URL', async () => {
    const { jobId } = await upsertDeduplicated(db, candidate('primary', { validThrough: future.toISOString() }));
    await db.jobSource.create({ data: { jobId, sourceKey: 'other', externalId: 'other', sourceTier: 'ATS_OFFICIAL',
      url: 'https://example.com/other', ...publicationFixture({ sourceKey: 'other', externalId: 'other', url: 'https://example.com/other', title: 'Other publication', description: 'Own surviving description', country: 'US', city: 'New York' }), lastSeenAt: new Date(0) } });
    await db.jobSource.updateMany({ where: { sourceKey: 'expiry-witness' }, data: { expiresAt: past } });
    const before = await db.jobSource.findFirstOrThrow({ where: { sourceKey: 'other' } });
    expect(await runRefresh(db, { onlyKeys: ['expiry-witness'] })).toMatchObject({ closedSources: 1, closedJobs: 0 });
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ isActive: true, url: before.url, title: 'Other publication', description: 'Own surviving description', countryCode: 'US', city: 'New York' });
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    expect(await db.job.count({ where: publicJobWhere() })).toBe(1);
  });

  it('a fresh alternative replaces an elapsed apply URL during ingestion, before refresh', async () => {
    const applicationUrl = 'https://jobaffinity.fr/apply/expiry123456';
    const raw = { board: { row: { attrs: { 'data-applyurl': applicationUrl } } } };
    const primary = { ...candidate('primary', raw), url: applicationUrl };
    const { jobId } = await upsertDeduplicated(db, primary);
    const alternative = { ...candidate('alternative', { ...raw, validThrough: future.toISOString() }, 'expiry-alternative'),
      url: `${applicationUrl}?source=alternative` };
    expect((await upsertDeduplicated(db, alternative)).jobId).toBe(jobId);
    await db.jobSource.updateMany({ where: { jobId, sourceKey: primary.sourceKey }, data: { expiresAt: past } });
    expect((await upsertDeduplicated(db, alternative)).jobId).toBe(jobId);
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ isActive: true, url: alternative.url });
  });

  it('a new expired capture closes the last publication during ingestion', async () => {
    const input = candidate('changing', { validThrough: future.toISOString() });
    const { jobId } = await upsertDeduplicated(db, input);
    await upsertDeduplicated(db, { ...input, raw: { validThrough: past.toISOString() } });
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ isActive: false, closedAt: expect.any(Date) });
    expect(await db.jobEvent.count({ where: { jobId, type: 'CLOSED' } })).toBe(1);
  });

  it('an empty source or representation scope cannot expire anything', async () => {
    const { jobId } = await upsertDeduplicated(db, candidate('bounded', {}));
    await db.jobSource.updateMany({ where: { jobId }, data: { expiresAt: past } });
    const before = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { sources: true, events: true } });
    for (const options of [{ onlyKeys: [] }, { onlySourceIds: [] }, { onlyKeys: ['other'] }]) {
      expect(await runRefresh(db, options)).toMatchObject({ closedSources: 0, closedJobs: 0, withdrawn: 0 });
    }
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { sources: true, events: true } })).toEqual(before);
  });
});
