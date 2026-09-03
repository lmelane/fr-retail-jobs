import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runRefresh } from './refresh.js';
import { checkSourceHealth } from './health.js';
import { purgeStaleForSource } from './purge.js';
import type { IngestStats } from './ingest.js';

/**
 * OPERATIONAL / EDGE-CASE tests for a cron that runs on a ~24h cadence.
 *
 * These are the failure modes that matter in production, written as BDD
 * scenarios: a source breaks, the ingest is cut short, a Maison disappears, an
 * offer comes back, two runs are missed in a row. Each proves the system does
 * the safe thing — offers of a healthy market are never lost, and a genuinely
 * gone offer is closed on time.
 */

const prisma = new PrismaClient();
const V = 6; // current pipeline generation

async function wipe() {
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.company.deleteMany({});
  await prisma.sourceRun.deleteMany({});
}

async function company(key = 'acme') {
  return prisma.company.create({
    data: { name: key, canonicalKey: key, fashionjobsUrl: `resolved:${key}-${Math.random()}` },
  });
}

/** A live job with one source, last seen `hoursAgo` hours ago, at generation `version`. */
async function job(opts: {
  companyId: string;
  ext: string;
  sourceKey: string;
  hoursAgo?: number;
  version?: number;
}) {
  const seen = new Date(Date.now() - (opts.hoursAgo ?? 0) * 3_600_000);
  return prisma.job.create({
    data: {
      companyId: opts.companyId,
      externalId: opts.ext,
      source: 'GENERIC_JSONLD',
      title: 'Conseiller de vente',
      url: `https://x/${opts.ext}`,
      fingerprint: `fp-${opts.ext}`,
      isActive: true,
      lastSeenAt: seen,
      pipelineVersion: opts.version ?? V,
      sources: {
        create: {
          sourceKey: opts.sourceKey,
          sourceTier: 'ATS_OFFICIAL',
          externalId: `s-${opts.ext}`,
          url: `https://x/${opts.ext}`,
          isActive: true,
          lastSeenAt: seen,
        },
      },
    },
  });
}

function stat(source: string, produced: number): IngestStats {
  return { source, fetched: produced, inSector: produced, france: produced, created: produced, merged: 0, updated: 0, errors: 0, withDescription: produced, withDate: produced, withCountry: produced, withUrl: produced };
}

async function recordHealth(sourceKey: string, status: string, jobs: number) {
  await prisma.sourceRun.create({ data: { sourceKey, status, jobs, ranAt: new Date() } });
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('OP1 — a source breaks for a day (returns zero)', () => {
  it('flags BROKEN and does NOT close its offers', async () => {
    const c = await company('kering');
    // Yesterday kering had 200 offers and health recorded it.
    await recordHealth('kering', 'OK', 200);
    // Today's run of kering returns nothing.
    const health = await checkSourceHealth(prisma, [stat('kering', 0)]);
    expect(health.broken).toBe(1);
    expect(health.incidents[0]?.status).toBe('BROKEN');

    // Its offers are stale (not seen for 72h) but must survive: refresh excludes
    // a source whose last health run is BROKEN.
    await job({ companyId: c.id, ext: 'k1', sourceKey: 'kering', hoursAgo: 72 });
    await job({ companyId: c.id, ext: 'k2', sourceKey: 'kering', hoursAgo: 72 });
    const refresh = await runRefresh(prisma);
    expect(refresh.closedJobs).toBe(0);
    expect(refresh.skippedBrokenSources).toContain('kering');
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(2);
  });
});

describe('OP2 — the ingest is cut short mid-run', () => {
  it('the per-source purge only touched sources that finished; the rest are intact', async () => {
    const c = await company('acme');
    // cartier finished this run (its offers are at v6); dior did NOT run yet (v5).
    await job({ companyId: c.id, ext: 'cart1', sourceKey: 'cartier', version: V });
    await job({ companyId: c.id, ext: 'dior1', sourceKey: 'dior', version: V - 1 });

    // The run was killed after cartier, before dior. cartier's purge ran.
    const purged = await purgeStaleForSource(prisma, 'cartier', V);
    // cartier has nothing stale (its only offer is v6), so nothing is removed.
    expect(purged.jobsDeleted).toBe(0);
    // dior's old-generation offer is untouched — its source never ran.
    expect(await prisma.job.count()).toBe(2);
    const dior = await prisma.job.findFirst({ where: { externalId: 'dior1' } });
    expect(dior?.isActive).toBe(true);
  });
});

describe('OP3 — a Maison disappears from a healthy source', () => {
  it('is NOT closed before the 48h window, and IS closed after', async () => {
    const c = await company('courir');
    await recordHealth('courir', 'OK', 300); // source is healthy
    // One offer last seen 30h ago (< 48h): still within tolerance.
    const fresh = await job({ companyId: c.id, ext: 'fresh', sourceKey: 'courir', hoursAgo: 30 });
    // One offer last seen 72h ago (> 48h): genuinely gone.
    await job({ companyId: c.id, ext: 'gone', sourceKey: 'courir', hoursAgo: 72 });

    const refresh = await runRefresh(prisma);
    expect(refresh.closedJobs).toBe(1); // only the 72h one
    const stillFresh = await prisma.job.findUnique({ where: { id: fresh.id } });
    expect(stillFresh?.isActive).toBe(true);
    const gone = await prisma.job.findFirst({ where: { externalId: 'gone' } });
    expect(gone?.isActive).toBe(false);
  });
});

describe('OP4 — an offer reappears after being closed', () => {
  it('is reopened, not duplicated', async () => {
    const c = await company('acme');
    await recordHealth('acme', 'OK', 10);
    // A closed job whose source is active again (its JobSource seen just now).
    const seenNow = new Date();
    const j = await prisma.job.create({
      data: {
        companyId: c.id, externalId: 're1', source: 'GENERIC_JSONLD', title: 'Vendeur',
        url: 'https://x/re1', fingerprint: 'fp-re1', isActive: false, pipelineVersion: V,
        sources: {
          create: {
            sourceKey: 'acme', sourceTier: 'ATS_OFFICIAL', externalId: 's-re1',
            url: 'https://x/re1', isActive: true, lastSeenAt: seenNow,
          },
        },
      },
    });
    const refresh = await runRefresh(prisma);
    expect(refresh.reopened).toBe(1);
    const reopened = await prisma.job.findUnique({ where: { id: j.id } });
    expect(reopened?.isActive).toBe(true);
    // Still ONE job — never a duplicate.
    expect(await prisma.job.count()).toBe(1);
  });
});

describe('OP5 — two ingests missed in a row (source silent 50h, but healthy last it ran)', () => {
  it('closes the offer once past the window — this is correct, the offer is gone', async () => {
    const c = await company('lacoste');
    await recordHealth('lacoste', 'OK', 50); // last time it ran, it was fine
    await job({ companyId: c.id, ext: 'l1', sourceKey: 'lacoste', hoursAgo: 50 });
    const refresh = await runRefresh(prisma);
    // 50h > 48h and the source is not BROKEN, so the offer closes. This is the
    // intended behaviour: if the source keeps reporting but this offer stopped
    // appearing, it is genuinely gone.
    expect(refresh.closedJobs).toBe(1);
  });
});

describe('OP6 — a broken source recovers', () => {
  it('its offers, kept alive during the outage, are refreshed and stay open', async () => {
    const c = await company('estee');
    // Outage: last run BROKEN.
    await recordHealth('estee', 'BROKEN', 0);
    await job({ companyId: c.id, ext: 'e1', sourceKey: 'estee', hoursAgo: 72 });
    // During the outage refresh keeps it open.
    let refresh = await runRefresh(prisma);
    expect(refresh.closedJobs).toBe(0);

    // Recovery: the source runs again and produces; health records OK.
    await recordHealth('estee', 'OK', 40);
    // Its offer is seen again (lastSeenAt now) — simulate the ingest touch.
    await prisma.jobSource.updateMany({ where: { sourceKey: 'estee' }, data: { lastSeenAt: new Date(), isActive: true } });
    await prisma.job.updateMany({ where: { externalId: 'e1' }, data: { lastSeenAt: new Date() } });
    refresh = await runRefresh(prisma);
    expect(refresh.closedJobs).toBe(0);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(1);
  });
});

describe('OP7 — a mass outage would close most of the base', () => {
  it('is refused by the volume guard, nothing is closed', async () => {
    const c = await company('bigsource');
    // 60 offers all from one source, all stale, source not yet marked BROKEN
    // (it broke between the last ingest and this refresh — the latency gap).
    await recordHealth('bigsource', 'OK', 60);
    for (let i = 0; i < 60; i++) {
      await job({ companyId: c.id, ext: `m${i}`, sourceKey: 'bigsource', hoursAgo: 72 });
    }
    const refresh = await runRefresh(prisma);
    // 60 >= 50 (floor) and 60/60 > 0.5 (ratio) -> refused.
    expect(refresh.refused).toBe(true);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(60);
  });
});
