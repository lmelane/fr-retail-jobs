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

async function recordHealth(sourceKey: string, status: string, jobs: number, note?: string, canAttestAbsence = status === 'OK') {
  await prisma.sourceRun.create({ data: { sourceKey, status, jobs, note, canAttestAbsence, ranAt: new Date() } });
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('runRefresh', () => {
  it('keeps jobs when evidence is absent or legacy, regardless of the human note', async () => {
    const c = await company();
    await job(c.id, 'missing', 'missing-1', 72);
    await job(c.id, 'legacy', 'legacy-1', 72);
    await prisma.sourceRun.create({ data: { sourceKey: 'legacy', status: 'OK', jobs: 10, note: 'complete and healthy' } });
    const result = await runRefresh(prisma);
    expect(result.closedJobs).toBe(0);
    expect(result.skippedBrokenSources).toEqual(expect.arrayContaining(['missing', 'legacy']));
  });
  it('closes an offer whose only source has been silent past the window', async () => {
    const c = await company();
    await job(c.id, 'kering', 'stale1', 72); // 72h > 48h window
    await recordHealth('kering', 'OK', 100); // kering is healthy, just this offer is gone

    const result = await runRefresh(prisma);

    expect(result.closedJobs).toBe(1);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(0);
  });

  it('writes exactly one closure event when several refreshes overlap', async () => {
    const c = await company();
    const j = await job(c.id, 'healthy', 'concurrent', 72);
    await recordHealth('healthy', 'OK', 100);
    const results = await Promise.all(Array.from({ length: 4 }, () => runRefresh(prisma)));
    expect(results.reduce((n, r) => n + r.closedJobs, 0)).toBe(1);
    expect(await prisma.jobEvent.count({ where: { jobId: j.id, type: 'CLOSED' } })).toBe(1);
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

  it('does NOT close offers of a source whose last run TIMED OUT or ERRORED (L-01)', async () => {
    const c = await company();
    await job(c.id, 'fashionjobs', 'f1', 72);
    await job(c.id, 'hermes', 'h1', 72);
    // Neither source finished its last run: their offers were not re-attested,
    // so their silence proves nothing — the refresh must leave them open.
    await recordHealth('fashionjobs', 'TIMEOUT', 0);
    await recordHealth('hermes', 'ERROR', 0);

    const result = await runRefresh(prisma);

    expect(result.closedJobs).toBe(0);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(2);
    expect(result.skippedBrokenSources).toEqual(expect.arrayContaining(['fashionjobs', 'hermes']));
  });

  /**
   * LE CAS L'ORÉAL (2026-09-08, D51). Un anti-bot nous sert une page d'attente :
   * nous n'avons pas lu des offres, nous avons lu un mur. Ce run ne prouve rien,
   * et fermer sur lui fabriquerait l'illusion « la Maison n'embauche plus ».
   */
  it("ne ferme RIEN quand la source a été bloquée par un anti-bot (CHALLENGED)", async () => {
    const c = await company();
    await job(c.id, 'l-oreal-professionnel', 'lo1', 72);
    await job(c.id, 'l-oreal-professionnel', 'lo2', 72);
    await recordHealth('l-oreal-professionnel', 'CHALLENGED', 0, "anti-bot cloudflare : page d'attente servie");

    const result = await runRefresh(prisma);

    expect(result.closedJobs).toBe(0);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(2);
    expect(result.skippedBrokenSources).toContain('l-oreal-professionnel');
  });

  /**
   * LE CAS LAGARDÈRE (20 lues sur 109 déclarées). Le run a PRODUIT des offres —
   * il franchissait donc toutes les gardes existantes, qui ne testaient que le
   * zéro — mais il n'a pas vu son board. Il ne peut rien conclure sur les 89
   * offres qu'il n'a pas lues.
   */
  it("ne ferme RIEN quand le dernier run était TRONQUÉ, même s'il a produit", async () => {
    const c = await company();
    await job(c.id, 'lagardere-travel-retail', 'lg1', 72);
    await job(c.id, 'lagardere-travel-retail', 'lg2', 72);
    await recordHealth(
      'lagardere-travel-retail',
      'DEGRADED',
      20,
      'troncature : 20 collectées sur 109 déclarées',
    );

    const result = await runRefresh(prisma);

    expect(result.closedJobs).toBe(0);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(2);
    expect(result.skippedBrokenSources).toContain('lagardere-travel-retail');
  });

  /**
   * La contrepartie indispensable : un DEGRADED de COUVERTURE DE CHAMP (des
   * descriptions manquantes) a bien vu tout le board. Il garde le droit
   * d'attester — sinon plus aucune offre expirée ne se fermerait jamais et le
   * catalogue se remplirait de postes morts.
   */
  it('ferme normalement sur un DEGRADED de couverture de champ (board vu en entier)', async () => {
    const c = await company();
    await job(c.id, 'urbn-stores', 'u1', 72);
    await recordHealth('urbn-stores', 'DEGRADED', 915, 'descriptions manquantes sur 37% des offres', true);

    const result = await runRefresh(prisma);

    expect(result.closedJobs).toBe(1);
    expect(result.skippedBrokenSources).not.toContain('urbn-stores');
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
