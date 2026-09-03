import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { retireSource } from './retireSource.js';

/**
 * Retiring a catalogue line must not leave ghost offers: rows only the retired
 * source backed disappear, shared rows survive with a living apply URL.
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

describe('retireSource', () => {
  it('deletes orphaned jobs, keeps shared ones, reassigns the canonical URL', async () => {
    const company = await prisma.company.create({
      data: { name: 'Cartier', canonicalKey: 'CARTIER', fashionjobsUrl: 'resolved:CARTIER' },
    });

    // Backed ONLY by the retired source -> must disappear.
    await prisma.job.create({
      data: {
        companyId: company.id,
        externalId: 'r-1',
        source: 'WORKDAY',
        title: 'Vendeur',
        url: 'https://old/r-1',
        fingerprint: 'fp1',
        sources: {
          create: [{ sourceKey: 'cartier-3', sourceTier: 'ATS_OFFICIAL', externalId: 'r-1', url: 'https://old/r-1' }],
        },
      },
    });

    // Shared with WTTJ, and the retired source OWNS the canonical URL -> must
    // survive with the WTTJ URL promoted.
    await prisma.job.create({
      data: {
        companyId: company.id,
        externalId: 'r-2',
        source: 'WORKDAY',
        title: 'Sales Associate',
        url: 'https://old/r-2',
        canonicalTier: 'ATS_OFFICIAL',
        fingerprint: 'fp2',
        sources: {
          create: [
            { sourceKey: 'cartier-3', sourceTier: 'ATS_OFFICIAL', externalId: 'r-2', url: 'https://old/r-2' },
            { sourceKey: 'wttj', sourceTier: 'SPECIALIST_JOBBOARD', externalId: 'w-2', url: 'https://wttj/w-2' },
          ],
        },
      },
    });

    const stats = await retireSource(prisma, 'cartier-3');

    expect(stats).toEqual({
      sourceKey: 'cartier-3',
      jobSourcesRemoved: 2,
      jobsDeleted: 1,
      jobsKept: 1,
      urlsReassigned: 1,
    });

    const jobs = await prisma.job.findMany({ include: { sources: true } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].url).toBe('https://wttj/w-2');
    expect(jobs[0].canonicalTier).toBe('SPECIALIST_JOBBOARD');
    expect(jobs[0].sources.map((s) => s.sourceKey)).toEqual(['wttj']);
  });

  it('is a no-op for an unknown key', async () => {
    const stats = await retireSource(prisma, 'nothing-here');
    expect(stats.jobSourcesRemoved).toBe(0);
    expect(stats.jobsDeleted).toBe(0);
  });
});
