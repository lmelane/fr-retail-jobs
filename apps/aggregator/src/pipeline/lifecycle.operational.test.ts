import { publicationFixture } from '../test/publication-fixture.js';
import '../test/setup-integration.js';
import { attestSyntheticFeed, collectAdmittedWithoutCompletion, ingestSyntheticFeed, releaseQualifiedSources, resolvedCompany } from '../test/ingestionFixture.js';
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runRefresh, readRefreshPlan } from './refresh.js';

/**
 * OPERATIONAL / EDGE-CASE tests for a cron that runs on a ~24h cadence.
 *
 * These are the failure modes that matter in production, written as BDD
 * scenarios: a source breaks, the ingest is cut short, a Maison disappears, an
 * offer comes back, two runs are missed in a row. Each proves the system does
 * the safe thing — offers of a healthy market are never lost, and a genuinely
 * gone offer is closed on time. Every proof is a real admitted, sealed and
 * completed collection of a synthetic native feed.
 */

const prisma = new PrismaClient();

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

/** A live job with one source, last seen `hoursAgo` hours ago. */
async function job(opts: { companyId: string; ext: string; sourceKey: string; hoursAgo?: number }) {
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
      sources: {
        create: {
          sourceKey: opts.sourceKey,
          sourceTier: 'ATS_OFFICIAL',
          externalId: `s-${opts.ext}`,
          ...publicationFixture({ sourceKey: opts.sourceKey, externalId: `s-${opts.ext}`, url: `https://x/${opts.ext}`, title: 'Conseiller de vente' }),
          url: `https://x/${opts.ext}`,
          isActive: true,
          lastSeenAt: seen,
        },
      },
    },
  });
}

const attest = (sourceKey: string, ids: string[] = []) => attestSyntheticFeed(prisma, sourceKey, ids.map(id => ({ id })));

beforeEach(wipe);
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => {
  await wipe();
  await releaseQualifiedSources(prisma);
  await prisma.$disconnect();
});

describe('OP1 — a source breaks for a day (returns an unreadable feed)', () => {
  it('records a failed collection and does NOT close its offers', async () => {
    const c = await company('kering');
    // Yesterday kering proved its board.
    await attest('kering');
    // Today's run of kering cannot read its feed at all.
    expect((await ingestSyntheticFeed(prisma, 'kering', '{}')).errors).toBe(1);

    // Its offers are stale (not seen for 72h) but must survive: the latest attempt
    // sealed no result and no completion, so the source proves nothing.
    await job({ companyId: c.id, ext: 'k1', sourceKey: 'kering', hoursAgo: 72 });
    await job({ companyId: c.id, ext: 'k2', sourceKey: 'kering', hoursAgo: 72 });
    const plan = await readRefreshPlan(prisma, { onlyKeys: ['kering'] });
    expect(plan.absencePlan.eligibility[0].reasons.join(' ')).toMatch(/échouée|inachevée/);
    const refresh = await runRefresh(prisma);
    expect(refresh.closedJobs).toBe(0);
    expect(refresh.unverifiableSources).toContain('kering');
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(2);
  });
});

describe('OP2 — the ingest is cut short mid-run', () => {
  it('a collection whose publication loop never completed proves no absence; the completed one does', async () => {
    const c = await company('acme');
    await job({ companyId: c.id, ext: 'cart1', sourceKey: 'cartier', hoursAgo: 72 });
    // The run was killed after sealing the capture, before the publication loop finished.
    await collectAdmittedWithoutCompletion(prisma, 'cartier', []);
    const plan = await readRefreshPlan(prisma, { onlyKeys: ['cartier'] });
    expect(plan.absencePlan.eligibility[0].reasons).toEqual(['publication inachevée : aucun rapport de fin d’ingestion']);
    expect(await runRefresh(prisma)).toMatchObject({ closedJobs: 0 });
    // The next run completes: the proven-empty board closes the stale offer.
    await attest('cartier');
    expect(await runRefresh(prisma)).toMatchObject({ closedJobs: 1 });
  });
});

describe('OP3 — a Maison disappears from a healthy source', () => {
  it('is NOT closed before the 48h window, and IS closed after', async () => {
    const c = await company('courir');
    await attest('courir'); // source is healthy and proves an empty board
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
    // A closed job whose source is active again (its JobSource seen just now).
    const seenNow = new Date();
    const j = await prisma.job.create({
      data: {
        companyId: c.id, externalId: 're1', source: 'GENERIC_JSONLD', title: 'Vendeur',
        url: 'https://x/re1', fingerprint: 'fp-re1', isActive: false, closedAt: new Date(seenNow.getTime() - 3600_000),
        sources: {
          create: {
            sourceKey: 'acme', sourceTier: 'ATS_OFFICIAL', externalId: 's-re1',
            url: 'https://x/re1', isActive: true, lastSeenAt: seenNow,
            ...publicationFixture({ sourceKey: 'acme', externalId: 's-re1', url: 'https://x/re1', title: 'Vendeur' }),
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

describe('OP5 — two ingests missed in a row (source silent 50h, but proven last it ran)', () => {
  it('keeps the offer when the last complete collection is itself stale', async () => {
    const c = await company('lacoste');
    await job({ companyId: c.id, ext: 'l1', sourceKey: 'lacoste', hoursAgo: 50 });
    await attest('lacoste');
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 50 * 3_600_000);
    const plan = await readRefreshPlan(prisma, { onlyKeys: ['lacoste'] });
    expect(plan.absencePlan.eligibility[0].reasons.join(' ')).toMatch(/CAPTURE_STALE|trop ancienne/);
    const refresh = await runRefresh(prisma);
    // A historical success proves nothing about an absence today.
    expect(refresh.closedJobs).toBe(0);
    expect(refresh.unverifiableSources).toContain('lacoste');
  });
});

describe('OP6 — a broken source recovers', () => {
  it('its offers, kept alive during the outage, are refreshed and stay open', async () => {
    const c = await resolvedCompany(prisma, 'estee');
    // Outage: the collection fails.
    expect((await ingestSyntheticFeed(prisma, 'estee', '{}')).errors).toBe(1);
    const e1 = await job({ companyId: c.id, ext: 'e1', sourceKey: 'estee', hoursAgo: 72 });
    // During the outage refresh keeps it open.
    let refresh = await runRefresh(prisma);
    expect(refresh.closedJobs).toBe(0);

    // Recovery: the source runs again and lists the offer; ingestion re-attests it.
    await attest('estee', ['s-e1']);
    refresh = await runRefresh(prisma);
    expect(refresh.closedJobs).toBe(0);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: e1.id } })).toMatchObject({ isActive: true });
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(1);
  });
});

describe('OP7 — a mass outage would close most of the base', () => {
  it('is refused by the volume guard, nothing is closed', async () => {
    const c = await company('bigsource');
    // 60 offers all from one source, all stale, whose latest proven board is empty
    // (it lost them between the last ingest and this refresh — the latency gap).
    await attest('bigsource');
    for (let i = 0; i < 60; i++) {
      await job({ companyId: c.id, ext: `m${i}`, sourceKey: 'bigsource', hoursAgo: 72 });
    }
    const refresh = await runRefresh(prisma);
    // 60 >= 50 (floor) and 60/60 > 0.5 (ratio) -> refused.
    expect(refresh.refused).toBe(true);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(60);
  });
});
