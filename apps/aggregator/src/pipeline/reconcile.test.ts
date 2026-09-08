import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runReconcile } from './reconcile.js';

/**
 * Reconcile merges duplicates that only became mergeable after an alias/synonym
 * was added. The merge must be atomic: the loser's sources move to the keeper
 * and the loser is retired, together, so a crash can never leave two active
 * jobs sharing the same sources.
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

async function jobIn(cluster: string, opts: { ext: string; sourceKey: string; tier: string; title?: string; countryCode?: string; postedAt?: Date }) {
  return prisma.job.create({
    data: {
      company: { create: { name: 'x', canonicalKey: `c-${opts.ext}`, fashionjobsUrl: `resolved:${opts.ext}-${Math.random()}` } },
      externalId: opts.ext,
      source: 'GENERIC_JSONLD',
      title: opts.title ?? 'Conseiller de vente H/F',
      countryCode: opts.countryCode,
      postedAt: opts.postedAt,
      url: `https://x/${opts.ext}`,
      fingerprint: `fp-${opts.ext}`,
      clusterKey: cluster,
      canonicalTier: opts.tier,
      isActive: true,
      sources: {
        create: {
          sourceKey: opts.sourceKey, sourceTier: opts.tier, externalId: `s-${opts.ext}`,
          url: `https://x/${opts.ext}`, isActive: true,
        },
      },
    },
    include: { sources: true },
  });
}

describe('runReconcile', () => {
  it.each([
    { countryCode: 'US' },
    { title: 'Assistant Store Manager' },
    { postedAt: new Date('2026-06-30T00:00:00Z') },
  ])('does not undo ingest identity guards: %j', async (change) => {
    const evidence = { title: 'Store Manager', countryCode: 'FR', postedAt: new Date('2026-01-01T00:00:00Z') };
    await jobIn('acme|PARIS', { ext: 'a', sourceKey: 'employer', tier: 'EMPLOYER_DIRECT', ...evidence });
    await jobIn('acme|PARIS', { ext: 'b', sourceKey: 'board', tier: 'SPECIALIST_JOBBOARD', ...evidence, ...change });
    expect((await runReconcile(prisma)).jobsMerged).toBe(0);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(2);
  });

  it('does not use a posting with unknown country to bridge FR and US', async () => {
    const unknown = await jobIn('acme|PARIS', { ext: 'u', sourceKey: 'unknown', tier: 'SPECIALIST_JOBBOARD' });
    await prisma.job.update({ where: { id: unknown.id }, data: { firstSeenAt: new Date('2000-01-01') } });
    await jobIn('acme|PARIS', { ext: 'fr', sourceKey: 'fr', tier: 'EMPLOYER_DIRECT', countryCode: 'FR' });
    await jobIn('acme|PARIS', { ext: 'us', sourceKey: 'us', tier: 'EMPLOYER_DIRECT', countryCode: 'US' });
    expect((await runReconcile(prisma)).jobsMerged).toBe(1);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(2);
  });

  it('merges two now-duplicate jobs in one cluster into a single active job', async () => {
    // Same cluster (company|city), near-identical titles, different sources.
    const keeper = await jobIn('acme|PARIS', { ext: 'a', sourceKey: 'employer', tier: 'EMPLOYER_DIRECT', title: 'Conseiller de vente H/F' });
    await jobIn('acme|PARIS', { ext: 'b', sourceKey: 'wttj', tier: 'SPECIALIST_JOBBOARD', title: 'Conseiller de vente' });

    const stats = await runReconcile(prisma);

    expect(stats.jobsMerged).toBe(1);
    expect(stats.sourcesMoved).toBe(1);
    // Exactly one active job remains, carrying both sources.
    const active = await prisma.job.findMany({ where: { isActive: true }, include: { sources: true } });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(keeper.id);
    expect(active[0].sources.map((s) => s.sourceKey).sort()).toEqual(['employer', 'wttj']);
  });

  it('promotes the better-ranked apply URL when the loser outranks the keeper', async () => {
    // keeper (created first) is a jobboard; the other is the employer's own site.
    const keeper = await jobIn('acme|LYON', { ext: 'jb', sourceKey: 'wttj', tier: 'SPECIALIST_JOBBOARD' });
    await jobIn('acme|LYON', { ext: 'emp', sourceKey: 'employer', tier: 'EMPLOYER_DIRECT' });

    await runReconcile(prisma);

    const survivor = await prisma.job.findUnique({ where: { id: keeper.id } });
    // The employer URL took over the canonical apply link.
    expect(survivor?.url).toBe('https://x/emp');
    expect(survivor?.canonicalTier).toBe('EMPLOYER_DIRECT');
  });

  it('leaves genuinely different jobs alone', async () => {
    await jobIn('acme|PARIS', { ext: 'sell', sourceKey: 's1', tier: 'EMPLOYER_DIRECT', title: 'Conseiller de vente' });
    await jobIn('acme|PARIS', { ext: 'acct', sourceKey: 's2', tier: 'EMPLOYER_DIRECT', title: 'Comptable fournisseurs' });

    const stats = await runReconcile(prisma);

    expect(stats.jobsMerged).toBe(0);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(2);
  });
});
