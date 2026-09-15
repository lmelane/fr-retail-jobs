import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, Prisma } from '@catwalks/db';
import { readSourceFacts } from '../../aggregator/src/facts/index';
import { getJobStatus } from './jobs';

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost','127.0.0.1','[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const key = `facts-api-${randomUUID()}`;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
describe.skipIf(!enabled)('source facts in the real public job query', () => {
  beforeAll(() => prisma.company.create({ data: { id: key, name: key, canonicalKey: key, fashionjobsUrl: `resolved:${key}` } }));
  afterAll(async () => { await prisma.job.deleteMany({ where: { companyId: key } }); await prisma.company.delete({ where: { id: key } }); });
  const create = (suffix: string, primary: unknown, secondary?: unknown) => prisma.job.create({ data: {
    companyId: key, source: 'LEVER', externalId: suffix, fingerprint: `${key}-${suffix}`,
    title: 'Sales Advisor', city: 'Paris', countryCode: 'FR', isFrance: true, url: `https://example.com/${suffix}`,
    salaryMin: 99999, salaryCurrency: 'EUR', salaryPeriod: 'YEAR',
    sources: { create: [
      { sourceKey: `${key}-primary`, sourceTier: 'EMPLOYER_DIRECT', externalId: suffix, url: `https://example.com/${suffix}`,
        sourceFacts: primary ? json(primary) : Prisma.DbNull, expiresAt: secondary ? new Date(Date.now() - 60_000) : null },
      ...(secondary ? [{ sourceKey: `${key}-secondary`, sourceTier: 'ATS_OFFICIAL', externalId: suffix, url: `https://example.org/${suffix}`, sourceFacts: json(secondary) }] : []),
    ] },
  } });
  const read = async (id: string) => { const result = await getJobStatus(id); if (result.status !== 'active') throw new Error('Fixture unavailable'); return result.job; };
  it('returns exact facts and compatible numeric amounts without exposing raw evidence', async () => {
    const facts = readSourceFacts('lever', { salaryRange: { min: 12.31, max: 20.8, currency: 'EUR', interval: 'per-hour-wage' } });
    const job = await read((await create('decimal', facts)).id);
    expect(job).toMatchObject({ salaryMin: 12.31, salaryMax: 20.8, salaryPeriod: 'HOUR', salaryCurrency: 'EUR' });
    expect(job.sourceFacts?.salary.value?.bands[0].min).toBe('12.31');
    expect(JSON.stringify(job.sourceFacts)).not.toContain('salaryRange');
    expect(job.sourceFacts?.salary).not.toHaveProperty('evidence');
  });
  it('selects the remaining publication facts along with its application URL', async () => {
    const old = readSourceFacts('lever', { salaryRange: { min: 90000, currency: 'EUR', interval: 'per-year-salary' } });
    const live = readSourceFacts('lever', { salaryRange: { min: 25.31, currency: 'USD', interval: 'per-hour-wage' } });
    const job = await read((await create('fallback', old, live)).id);
    expect(job).toMatchObject({ applyUrl: 'https://example.org/fallback', salaryMin: 25.31, salaryCurrency: 'USD', salaryPeriod: 'HOUR' });
  });
  it('keeps an unknown period in the rich facts without inviting a default annual display', async () => {
    const facts = readSourceFacts('icims', { postingEvidence: { jobPosting: { baseSalary: { currency: 'USD', minValue: 22.95, maxValue: 42.63 } } } });
    const job = await read((await create('unknown-period', facts)).id);
    expect(job).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null });
    expect(job.sourceFacts?.salary.value?.bands[0]).toMatchObject({ min: '22.95', currency: 'USD', period: null });
  });
  it('does not expose unproven historical scalar amounts before backfill', async () => {
    const job = await read((await create('uncached', null)).id);
    expect(job).toMatchObject({ salaryMin: null, salaryCurrency: null, salaryPeriod: null, sourceFacts: null });
  });
});
