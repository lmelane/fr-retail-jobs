import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { getJobs, whereClause } from './jobs';

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const prefix = 'audit-facets-';
const group = 'Audit Facets 301';

describe.skipIf(!enabled)('search against a dedicated local database', () => {
  const cleanup = async () => {
    await prisma.job.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: prefix } } });
  };
  beforeAll(async () => {
    await cleanup();
    await prisma.company.createMany({ data: Array.from({ length: 301 }, (_, i) => ({
      id: `${prefix}${i}`, name: `${prefix}${i}`, canonicalKey: `${prefix}${i}`,
      fashionjobsUrl: `resolved:${prefix}${i}`, sector: 'LUXURY' as const, parentGroup: group,
    })) });
    await prisma.job.createMany({ data: Array.from({ length: 301 }, (_, i) => ({
      id: `${prefix}${String(i).padStart(3, '0')}`, companyId: `${prefix}${i}`, externalId: String(i),
      source: 'GENERIC_JSONLD' as const, title: 'Conseiller de vente', url: `https://example.com/jobs/${i}`,
      fingerprint: `${prefix}${i}`, isActive: true, postedAt: new Date('2026-01-01'),
      firstSeenAt: new Date('2026-01-01'),
    })) });
  });
  afterAll(cleanup);

  it('counts all 301 companies in sector and group totals', async () => {
    const result = await getJobs({ group });
    expect(result.total).toBe(301);
    expect(result.facets.sectors).toEqual([{ value: 'LUXURY', count: 301 }]);
    expect(result.facets.groups).toEqual([{ value: group, count: 301 }]);
    expect(result.facets.maisons).toHaveLength(301);
  });

  it('uses a stable order for tied dates across successive pages', async () => {
    const first = await getJobs({ group, page: 1 });
    const second = await getJobs({ group, page: 2 });
    const ids = [...first.jobs, ...second.jobs].map(job => job.id);
    expect(new Set(ids).size).toBe(50);
    expect(ids).toEqual(Array.from({ length: 50 }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`));
  });

  it.each([
    { q: 'Conseiller vente' }, { q: 'Audit' }, { q: 'absent' },
    { q: 'Conseiller', sector: 'LUXURY' }, { country: 'FR' },
    { maison: `${prefix}12` }, { source: 'absent-source' },
  ])('preserves filter semantics against the original query: %j', async filters => {
    const scoped = { ...filters, group };
    expect((await getJobs(scoped)).total).toBe(await prisma.job.count({ where: whereClause(scoped) }));
  });

  it('updates the indexed document after posting edits and company renames', async () => {
    const id = `${prefix}000`;
    await prisma.job.update({ where: { id }, data: { title: 'UniqueSearchTitle' } });
    expect((await getJobs({ q: 'UniqueSearchTitle', group })).total).toBe(1);
    await prisma.company.update({ where: { id: `${prefix}0` }, data: { name: 'UniqueMaisonLabel' } });
    expect((await getJobs({ q: 'UniqueMaisonLabel', group })).total).toBe(1);
    await prisma.job.update({ where: { id }, data: { title: 'Conseiller de vente' } });
    await prisma.company.update({ where: { id: `${prefix}0` }, data: { name: `${prefix}0` } });
    expect((await getJobs({ q: 'UniqueSearchTitle', group })).total).toBe(0);
    expect((await getJobs({ q: 'UniqueMaisonLabel', group })).total).toBe(0);
  });
});
