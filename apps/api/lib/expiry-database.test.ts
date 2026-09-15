import { headline } from './intelligence/facts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, Prisma } from '@catwalks/db';
import { publicJobSql, publicJobWhere } from '@catwalks/db/availability';
import { getJobs, getJobStatus, getOfferState, suggestCities, suggestTitles, getSimilarJobs, sitemapOffersChunk, getCompanyAside } from './jobs';

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const key = 'expiry-api-witness';
const past = new Date(Date.now() - 60_000), future = new Date(Date.now() + 3_600_000);
describe.skipIf(!enabled)('public availability from source publications', () => {
  const cleanup = async () => {
    await prisma.job.deleteMany({ where: { companyId: key } });
    await prisma.company.deleteMany({ where: { id: key } });
  };
  beforeEach(async () => {
    await cleanup();
    await prisma.company.create({ data: { id: key, name: key, canonicalKey: key, fashionjobsUrl: `resolved:${key}` } });
  });
  afterAll(cleanup);
  const create = (suffix: string, expiresAt: Date | null, extra = false) => prisma.job.create({ data: {
    id: `${key}-${suffix}`, companyId: key, source: 'GENERIC_JSONLD', externalId: suffix, fingerprint: `${key}-${suffix}`,
    title: `ExpiryWitness ${suffix}`, city: `Expirycity${suffix}`, countryCode: 'FR', isFrance: true,
    url: `https://example.com/primary/${suffix}`, validThrough: past,
    sources: { create: [
      { sourceKey: `${key}-primary`, sourceTier: 'EMPLOYER_DIRECT', externalId: suffix,
        url: `https://example.com/primary/${suffix}`, expiresAt },
      ...(extra ? [{ sourceKey: `${key}-secondary`, sourceTier: 'ATS_OFFICIAL', externalId: suffix,
        url: `https://example.com/secondary/${suffix}`, expiresAt: future }] : []),
    ] },
  } });

  it('SQL and Prisma agree before the maintenance job runs', async () => {
    const expired = await create('expired', past);
    const live = await create('live', future);
    const indefinite = await create('indefinite', null);
    const multi = await create('multi', past, true);
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT j.id FROM "Job" j WHERE j."companyId" = ${key} AND ${publicJobSql(Prisma.sql`j`)}`);
    const expected = [live.id, indefinite.id, multi.id].sort();
    expect(rows.map(row => row.id).sort()).toEqual(expected);
    expect((await prisma.job.findMany({ where: { ...publicJobWhere(), companyId: key } })).map(row => row.id).sort()).toEqual(expected);
    const result = await getJobs({ maisons: [key] });
    expect(result.total).toBe(3);
    expect(result.jobs.map(job => job.id).sort()).toEqual(expected);
    expect(await getOfferState(expired.id)).toBe('closed');
    expect((await getJobStatus(expired.id)).status).toBe('closed');
    expect(await getOfferState(live.id)).toBe('active');
    expect((await getCompanyAside(key))?.openJobs).toBe(3);
    expect((await headline({ companyId: key })).active).toBe(3);
  });

  it('the remaining publication supplies a usable application link and its own deadline', async () => {
    const multi = await create('multi', past, true);
    const result = await getJobStatus(multi.id);
    expect(result.status).toBe('active');
    if (result.status === 'missing') throw new Error('Missing fixture');
    expect(result.job).toMatchObject({ applyUrl: 'https://example.com/secondary/multi', url: 'https://example.com/secondary/multi',
      validThrough: future, sourceCount: 1, sources: [`${key}-secondary`] });
    expect((await getJobs({ maisons: [key], source: `${key}-primary` })).total).toBe(0);
    expect((await getJobs({ maisons: [key] })).facets.sources).toEqual([{ value: `${key}-secondary`, count: 1 }]);
  });

  it('expired publications disappear from discovery and sitemap output', async () => {
    const expired = await create('expired', past);
    const live = await create('live', future);
    expect(await suggestCities('Expirycity', 'FR')).toEqual(['Expirycitylive']);
    expect(await suggestTitles('ExpiryWitness')).toEqual(['ExpiryWitness live']);
    expect((await sitemapOffersChunk(0)).map(job => job.id)).toContain(live.id);
    expect((await sitemapOffersChunk(0)).map(job => job.id)).not.toContain(expired.id);
    const result = await getJobStatus(live.id);
    if (result.status !== 'active') throw new Error('Live fixture unavailable');
    expect((await getSimilarJobs(result.job)).map(job => job.id)).not.toContain(expired.id);
  });
});
