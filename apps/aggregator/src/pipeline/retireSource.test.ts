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

/**
 * Mesuré le 2026-09-06 : la clé `kering` portait deux routes — le flux
 * Eightfold (ids numériques, vivant) et une route sitemap (ids = URL, 394
 * offres périmées dont un stage de 2021). Retirer la clé entière aurait tué
 * le flux vivant ; le préfixe ne retire que la route morte.
 */
describe('retireSource — une seule route d’une clé (externalIdPrefix)', () => {
  it('ne détache que les rattachements dont l’id commence par le préfixe et laisse la Source ACTIVE', async () => {
    const company = await prisma.company.create({
      data: { name: 'Gucci', canonicalKey: 'GUCCI', fashionjobsUrl: 'resolved:GUCCI' },
    });
    await prisma.source.deleteMany({ where: { key: 'kering' } });
    await prisma.source.create({
      data: { key: 'kering', maison: 'Kering', kind: 'eightfold', config: {}, tier: 'GROUP_OFFICIAL', tenantKey: 'eightfold:kering.com', status: 'ACTIVE' },
    });
    // Route sitemap seule : doit disparaître.
    await prisma.job.create({
      data: {
        companyId: company.id, externalId: 'https://www.kering.com/fr/offres/x', source: 'GENERIC_JSONLD', title: 'Stage 2021', url: 'https://www.kering.com/fr/offres/x', fingerprint: 'fp-sitemap',
        sources: { create: [{ sourceKey: 'kering', sourceTier: 'GROUP_OFFICIAL', externalId: 'https://www.kering.com/fr/offres/x', url: 'https://www.kering.com/fr/offres/x' }] },
      },
    });
    // Route Eightfold : doit rester intacte.
    await prisma.job.create({
      data: {
        companyId: company.id, externalId: '12345', source: 'EIGHTFOLD', title: 'Vendeur', url: 'https://careers.kering.com/12345', fingerprint: 'fp-eightfold',
        sources: { create: [{ sourceKey: 'kering', sourceTier: 'GROUP_OFFICIAL', externalId: '12345', url: 'https://careers.kering.com/12345' }] },
      },
    });

    const stats = await retireSource(prisma, 'kering', { externalIdPrefix: 'https://' });

    expect(stats.jobSourcesRemoved).toBe(1);
    expect(stats.jobsDeleted).toBe(1);
    expect(await prisma.job.count()).toBe(1);
    expect((await prisma.job.findFirstOrThrow()).externalId).toBe('12345');
    expect((await prisma.source.findUniqueOrThrow({ where: { key: 'kering' } })).status).toBe('ACTIVE');
  });
});
