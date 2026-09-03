import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { separateFusedJobs } from './separateFused.js';

/**
 * Repair pass for audit D-01: a Job wrongly carrying several JobSource rows of
 * ONE sourceKey under distinct externalIds must be split back into one Job per
 * real opening — and the metric must read zero afterwards.
 */

const prisma = new PrismaClient();

async function wipe() {
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.company.deleteMany({});
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

async function makeFusedJob() {
  const company = await prisma.company.create({
    data: { name: 'Cartier', canonicalKey: 'CARTIER', fashionjobsUrl: 'resolved:CARTIER' },
  });
  return prisma.job.create({
    data: {
      companyId: company.id,
      externalId: 'wd-1',
      source: 'WORKDAY',
      title: 'Sales Associate',
      url: 'https://x/wd-1',
      clusterKey: 'CARTIER|PARIS',
      fingerprint: 'fp',
      sources: {
        create: [
          { sourceKey: 'cartier', sourceTier: 'ATS_OFFICIAL', externalId: 'wd-1', url: 'https://x/wd-1', title: 'Sales Associate' },
          { sourceKey: 'cartier', sourceTier: 'ATS_OFFICIAL', externalId: 'wd-2', url: 'https://x/wd-2', title: 'Sales Associate' },
          { sourceKey: 'cartier', sourceTier: 'ATS_OFFICIAL', externalId: 'wd-3', url: 'https://x/wd-3', title: 'Sales Associate (night)' },
          // A DIFFERENT source on the same job is legitimate and must stay.
          { sourceKey: 'wttj', sourceTier: 'SPECIALIST_JOBBOARD', externalId: 'w-9', url: 'https://w/9', title: 'Sales Associate' },
        ],
      },
    },
    include: { sources: true },
  });
}

describe('separateFusedJobs', () => {
  it('splits every extra same-source id into its own job and zeroes the metric', async () => {
    await makeFusedJob();

    const stats = await separateFusedJobs(prisma);

    expect(stats.fusedBefore).toBe(1);
    expect(stats.separated).toBe(2);
    expect(stats.fusedAfter).toBe(0);

    const jobs = await prisma.job.findMany({ include: { sources: true }, orderBy: { externalId: 'asc' } });
    expect(jobs).toHaveLength(3);
    // The original keeps its own id and the legitimate cross-source attachment.
    const original = jobs.find((j) => j.externalId === 'wd-1');
    expect(original?.sources.map((s) => s.externalId).sort()).toEqual(['w-9', 'wd-1']);
    // Each split job carries exactly its own source row, seeded from it.
    const split = jobs.find((j) => j.externalId === 'wd-3');
    expect(split?.title).toBe('Sales Associate (night)');
    expect(split?.url).toBe('https://x/wd-3');
    expect(split?.sources).toHaveLength(1);
  });

  it('is a no-op on a healthy base', async () => {
    const stats = await separateFusedJobs(prisma);
    expect(stats).toEqual({ fusedBefore: 0, separated: 0, reattached: 0, fusedAfter: 0 });
  });
});
