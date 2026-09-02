import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runRefresh } from './refresh.js';

/**
 * Integration tests for the refresh lifecycle pass (against the local audit DB).
 *
 * Refresh closes offers no source reports any more — but it must NOT close the
 * offers of a source that just broke (a rotated key, a WAF), because those
 * offers still exist; the source simply went silent. And a run that would close
 * a large share of the whole base at once is a signal of a systemic failure, not
 * a normal lifecycle event, so it is refused.
 */

const prisma = new PrismaClient();

async function wipe() {
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.company.deleteMany({});
  await prisma.sourceRun.deleteMany({});
}

async function company() {
  return prisma.company.create({
    data: { name: 'Acme', canonicalKey: 'acme', fashionjobsUrl: `resolved:acme-${Math.random()}` },
  });
}

/** A job with one source last seen `hoursAgo` hours ago. */
async function job(companyId: string, sourceKey: string, externalId: string, hoursAgo: number) {
  const seen = new Date(Date.now() - hoursAgo * 3_600_000);
  return prisma.job.create({
    data: {
      companyId,
      externalId,
      source: 'GENERIC_JSONLD',
      title: 'Vendeur',
      url: `https://x/${externalId}`,
      fingerprint: `fp-${externalId}`,
      isActive: true,
      lastSeenAt: seen,
      sources: {
        create: {
          sourceKey,
          sourceTier: 'ATS_OFFICIAL',
          externalId: `s-${externalId}`,
          url: `https://x/${externalId}`,
          isActive: true,
          lastSeenAt: seen,
        },
      },
    },
  });
}

async function recordHealth(sourceKey: string, status: string, jobs: number) {
  await prisma.sourceRun.create({ data: { sourceKey, status, jobs, ranAt: new Date() } });
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('runRefresh', () => {
  it('closes an offer whose only source has been silent past the window', async () => {
    const c = await company();
    await job(c.id, 'kering', 'stale1', 72); // 72h > 48h window
    await recordHealth('kering', 'OK', 100); // kering is healthy, just this offer is gone

    const result = await runRefresh(prisma);

    expect(result.closedJobs).toBe(1);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(0);
  });

  it('does NOT close offers of a source that just broke', async () => {
    const c = await company();
    // Two offers of "kering", both stale (source went silent).
    await job(c.id, 'kering', 'k1', 72);
    await job(c.id, 'kering', 'k2', 72);
    // kering's last health run says BROKEN — the offers still exist, the feed died.
    await recordHealth('kering', 'BROKEN', 0);

    const result = await runRefresh(prisma);

    // Nothing closed: a broken source must not take its offers down with it.
    expect(result.closedJobs).toBe(0);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(2);
    expect(result.skippedBrokenSources).toContain('kering');
  });

  it('keeps a multi-source offer while any source still reports it', async () => {
    const c = await company();
    // One job, two sources: kering stale, but loreal seen recently.
    const seenOld = new Date(Date.now() - 72 * 3_600_000);
    const seenNew = new Date();
    const j = await prisma.job.create({
      data: {
        companyId: c.id, externalId: 'shared', source: 'GENERIC_JSONLD', title: 'Vendeur',
        url: 'https://x/shared', fingerprint: 'fp-shared', isActive: true, lastSeenAt: seenNew,
        sources: {
          create: [
            { sourceKey: 'kering', sourceTier: 'ATS_OFFICIAL', externalId: 's-k', url: 'https://x/shared', isActive: true, lastSeenAt: seenOld },
            { sourceKey: 'loreal', sourceTier: 'ATS_OFFICIAL', externalId: 's-l', url: 'https://x/shared', isActive: true, lastSeenAt: seenNew },
          ],
        },
      },
    });
    await recordHealth('kering', 'OK', 100);
    await recordHealth('loreal', 'OK', 100);

    const result = await runRefresh(prisma);

    expect(result.closedJobs).toBe(0);
    const still = await prisma.job.findUnique({ where: { id: j.id } });
    expect(still?.isActive).toBe(true);
  });

  it('refuses a mass closure that would empty most of the base', async () => {
    const c = await company();
    // 10 offers, all stale, all from healthy sources -> would close all 10.
    for (let i = 0; i < 10; i++) {
      await job(c.id, `src${i}`, `mass${i}`, 72);
      await recordHealth(`src${i}`, 'OK', 1);
    }

    // A guard rail: closing 100% of the base at once is a systemic failure.
    // minCloseForGuard lowered so the mechanism is exercised without seeding 50.
    const result = await runRefresh(prisma, { maxCloseRatio: 0.5, minCloseForGuard: 2 });

    expect(result.refused).toBe(true);
    // Nothing was actually closed.
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(10);
  });
});
