import '../test/setup-integration.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildHealthReport } from './healthReport.js';

const prisma = new PrismaClient();
const now = new Date('2026-09-08T12:00:00Z');
const old = new Date('2026-09-01T12:00:00Z');
beforeEach(async () => {
  await prisma.job.deleteMany();
  await prisma.company.deleteMany();
  await prisma.sourceRun.deleteMany();
});
afterAll(() => prisma.$disconnect());

describe('operational source exposure', () => {
  it('protects fresh alternatives and counts distinct worldwide risks without adding overlapping sources', async () => {
    const company = await prisma.company.create({ data: { name: 'Audit', canonicalKey: 'audit-report', fashionjobsUrl: 'resolved:audit-report' } });
    const job = (id: string, sources: Array<[string, Date]>, expired = false) => prisma.job.create({ data: {
      companyId: company.id, externalId: id, source: 'WORKDAY', title: id, fingerprint: id,
      url: `https://example.com/${id}`, isActive: true, validThrough: expired ? old : null,
      sources: { create: sources.map(([sourceKey, lastSeenAt]) => ({ sourceKey, externalId: id,
        sourceTier: 'EMPLOYER_DIRECT', url: `https://example.com/${id}`, lastSeenAt, isActive: true })) },
    } });
    await job('protected', [['a', old], ['b', now]]);
    await job('stale', [['a', old], ['c', old]]);
    await job('expired', [['b', now]], true);
    await job('orphan', []);
    await prisma.sourceRun.create({ data: { sourceKey: 'a', status: 'OK', jobs: 2, descriptionRate: 0.3 } });
    const report = await buildHealthReport(prisma, now);
    expect(report.totals).toMatchObject({ activeJobs: 4, atRiskJobs: 3, withoutFreshSource: 2,
      withoutActiveSource: 1, expiredStillActive: 1, canonicalUrlUnbacked: 1 });
    expect(report.sources.find(s => s.sourceKey === 'a')).toMatchObject({ activeJobs: 2, atRiskJobs: 1, descriptionRate: null });
    expect(report.sources.find(s => s.sourceKey === 'c')?.atRiskJobs).toBe(1);
    expect(report.sources.find(s => s.sourceKey === 'b')?.atRiskJobs).toBe(1);
  });

  it('returns explicit zero totals on an empty catalogue', async () => {
    expect((await buildHealthReport(prisma, now)).totals.activeJobs).toBe(0);
  });
});
