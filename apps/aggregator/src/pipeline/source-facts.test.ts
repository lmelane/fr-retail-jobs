import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { planFactsRepair, applyFactsRepair } from '../facts/repair.js';

const db = new PrismaClient();
afterAll(() => db.$disconnect());
const raw = () => ({ salary: { min: 12.31, max: 20.8, currency: 'EUR', period: 'hour' },
  education_code: 'vocational', hybrid: true, remote: false, on_site: false,
  locations: [{ city: 'Paris', country_code: 'FR', postal_code: '75008' }] });
async function fixture(historical = false, preciseCoordinates = false) {
  const key = `facts-${randomUUID()}`;
  await db.source.create({ data: { key, maison: key, kind: preciseCoordinates ? 'jibe' : 'recruitee', config: {}, tenantKey: key, tier: 'EMPLOYER_DIRECT' } });
  const input = { company: key, companyId: key, sourceKey: key, sourceTier: 'EMPLOYER_DIRECT' as const, atsType: preciseCoordinates ? 'JIBE' as const : 'RECRUITEE' as const,
    externalId: 'one', title: 'Sales Advisor', url: 'https://example.com/jobs/one', city: 'Paris', country: 'FR', raw: preciseCoordinates ? { latitude: '48.775130000000004', longitude: '9.1', city: 'Stuttgart', country: 'DE' } : raw() };
  const { jobId } = await upsertDeduplicated(db, input);
  const publication = await db.jobSource.findFirstOrThrow({ where: { jobId } });
  if (historical) await db.jobSource.update({ where: { id: publication.id }, data: { sourceFacts: Prisma.DbNull } });
  return { key, jobId, input, publication };
}

describe('source facts across ingestion and reviewed repairs', () => {
  it('preserves precise coordinates and produces no follow-up repair after applying them', async () => {
    const { key, jobId, publication } = await fixture(true, true);
    const plan = await planFactsRepair(db, [key]);
    expect(plan.entries[0].after?.latitude).toBe(48.775130000000004);
    await applyFactsRepair(db, plan, plan.planHash);
    const [stored] = await db.$queryRaw<Array<{ latitude: string }>>`SELECT latitude::text FROM "Job" WHERE id=${jobId}`;
    expect(Number(stored.latitude)).toBe(48.775130000000004);
    expect((await db.jobSource.findUniqueOrThrow({ where: { id: publication.id } })).sourceFacts).toEqual(plan.entries[0].facts);
    expect((await planFactsRepair(db, [key])).entries).toEqual([]);
    expect(await applyFactsRepair(db, plan, plan.planHash)).toMatchObject({ alreadyApplied: 1, applied: 0 });
  });

  it('updates native education, salary and postcode, then removes facts the new RAW no longer supports', async () => {
    const { input, jobId } = await fixture();
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ educationLevel: 'RECRUITEE:vocational', workplaceType: 'HYBRID', postalCode: '75008' });
    await upsertDeduplicated(db, { ...input, raw: { ...raw(), education_code: 'master_degree', locations: [{ city: 'Lyon', country_code: 'FR', postal_code: '69002' }] } });
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ educationLevel: 'RECRUITEE:master_degree', postalCode: '69002' });
    await upsertDeduplicated(db, { ...input, raw: {} });
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ educationLevel: null, workplaceType: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null, postalCode: null });
  });
  it('does not manufacture salaries from prose or stale adapter fields', async () => {
    const { input, jobId } = await fixture();
    await upsertDeduplicated(db, { ...input, raw: {}, salaryMin: 5000, salaryCurrency: 'EUR', description: 'Salary 5000. Remote team support.' });
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ salaryMin: null, workplaceType: null });
  });
  it('repairs a historical projection, journals its exact evidence and resumes idempotently', async () => {
    const { key, jobId, publication } = await fixture();
    await db.jobSource.update({ where: { id: publication.id }, data: { sourceFacts: Prisma.DbNull } });
    await db.job.update({ where: { id: jobId }, data: { salaryMin: 12, workplaceType: 'ONSITE', educationLevel: null, postalCode: null } });
    const plan = await planFactsRepair(db, [key]);
    expect(plan.entries[0].before.salaryMin).toBe('12');
    expect(plan.entries[0].after?.salaryMin).toBe('12.31');
    expect(await applyFactsRepair(db, plan, plan.planHash)).toMatchObject({ applied: 1, alreadyApplied: 0 });
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).salaryMin?.toString()).toBe('12.31');
    expect(await applyFactsRepair(db, plan, plan.planHash)).toMatchObject({ applied: 0, alreadyApplied: 1 });
    expect(await db.dataCorrection.count({ where: { batchId: `source-facts:${plan.planHash}` } })).toBe(1);
  });
  it('refuses changed RAW and a changed apply owner after preview', async () => {
    const a = await fixture(true), plan = await planFactsRepair(db, [a.key]);
    await db.jobSource.update({ where: { id: a.publication.id }, data: { raw: { ...raw(), salary: { min: 30, max: 35, currency: 'EUR', period: 'hour' } } } });
    await expect(applyFactsRepair(db, plan, plan.planHash)).rejects.toThrow('input changed');
    expect(await db.dataCorrection.count({ where: { planHash: plan.planHash } })).toBe(0);
    const b = await fixture(true), other = await planFactsRepair(db, [b.key]);
    await db.jobSource.update({ where: { id: b.publication.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(applyFactsRepair(db, other, other.planHash)).rejects.toThrow('job or owner changed');
  });
  it('rejects a tampered plan and unknown source scope before applying changes', async () => {
    const { key } = await fixture(true), plan = await planFactsRepair(db, [key]);
    plan.entries[0].facts.salary.value!.bands[0].min = '1';
    await expect(applyFactsRepair(db, plan, plan.planHash)).rejects.toThrow('Invalid');
    await expect(planFactsRepair(db, ['missing-source'])).rejects.toThrow('Unknown source');
  });
  it('plans no correction when the cached facts and projection are already current', async () => {
    const { key } = await fixture();
    expect((await planFactsRepair(db, [key])).entries).toEqual([]);
  });
});
