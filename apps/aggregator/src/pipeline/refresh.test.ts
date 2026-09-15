import { loadRefreshManifest, storeRefreshManifest } from './refreshManifest.js';
import '../test/setup-integration.js';
import { recordSourceEvidence, clearSourceEvidence } from '../test/sourceEvidence.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runRefresh, readRefreshPlan, createRefreshManifest } from './refresh.js';
import { lockCompanyRows } from '../lib/writeLocks.js';
import { randomUUID } from 'node:crypto';

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
  await clearSourceEvidence(prisma);
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
  await recordSourceEvidence(prisma, sourceKey, { status, canAttestAbsence });
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('runRefresh', () => {
  it('un booléen de santé ne remplace pas une preuve d’énumération corrélée', async () => {
    const c = await company();
    await job(c.id, 'boolean-only', 'not-proven-absent', 72);
    await prisma.sourceRun.create({ data: { sourceKey: 'boolean-only', status: 'OK', jobs: 1,
      canAttestAbsence: true, complete: true, errors: 0, truncated: false, runId: 'missing-evidence' } });
    expect(await runRefresh(prisma)).toMatchObject({ closedSources: 0, closedJobs: 0 });
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(1);
  });

  it('la présence retenue reste ouverte ; seule l’absence prouvée ferme, avec le même plan en lecture et en écriture', async () => {
    const c = await company();
    const present = await job(c.id, 'proven', 'present', 72);
    const absent = await job(c.id, 'proven', 'absent', 72);
    const runId = await recordSourceEvidence(prisma, 'proven', { observedIds: ['s-present'] });
    await prisma.pipelineEvent.create({ data: { id: randomUUID(), runId, sourceKey: 'proven', jobId: 's-present',
      level: 'warn', event: 'job.publication_held', fingerprint: 'held', payload: { reason: 'DETAIL_UNREADABLE' } } });
    const plan = await readRefreshPlan(prisma, { onlyKeys: ['proven'] });
    expect(plan.absencePlan.deactivations.map(source => source.jobId)).toEqual([absent.id]);
    expect([...plan.absencePlan.states.values()]).toContain('PRESENT_BUT_HELD');
    expect(await runRefresh(prisma, { onlyKeys: ['proven'] })).toMatchObject({ closedSources: 1, closedJobs: 1 });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: present.id } })).isActive).toBe(true);
    const closed = await prisma.jobSource.findMany({ where: { isActive: false }, select: { id: true } });
    expect(closed.map(source => source.id)).toEqual(plan.absencePlan.deactivations.map(source => source.jobSourceId));
  });

  it('refuse une preuve d’un ancien cycle même si le dernier run se dit recevable', async () => {
    const c = await company();
    await job(c.id, 'proof-cycle', 'old', 72);
    await recordSourceEvidence(prisma, 'proof-cycle');
    await prisma.sourceRun.create({ data: { sourceKey: 'proof-cycle', runId: 'later-unproven', status: 'OK', jobs: 0,
      canAttestAbsence: true, complete: true, errors: 0, truncated: false } });
    expect(await runRefresh(prisma)).toMatchObject({ closedJobs: 0, closedSources: 0 });
  });

  it.each(['reattestation', 'new-proof'] as const)('revalide après attente du verrou : %s plus récente que le plan', async change => {
    const c = await company();
    const target = await job(c.id, 'race', 'race', 72);
    await recordSourceEvidence(prisma, 'race');
    let refreshing: ReturnType<typeof runRefresh> | undefined;
    await prisma.$transaction(async tx => {
      await lockCompanyRows(tx, [c.id]);
      refreshing = runRefresh(prisma, { onlyKeys: ['race'] });
      const until = Date.now() + 5000;
      while (true) {
        const [state] = await tx.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        ) AS waiting`;
        if (state.waiting) break;
        if (Date.now() >= until) throw new Error('Refresh never reached the company lock');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (change === 'reattestation') await tx.jobSource.updateMany({ where: { jobId: target.id }, data: { lastSeenAt: new Date() } });
      else await recordSourceEvidence(tx, 'race', { observedIds: ['s-race'] });
    });
    expect(await refreshing).toMatchObject({ closedJobs: 0, closedSources: 0, withdrawn: 0 });
    expect(await prisma.jobEvent.count({ where: { jobId: target.id } })).toBe(0);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: target.id } })).isActive).toBe(true);
  });

  it('keeps jobs when evidence is absent or legacy, regardless of the human note', async () => {
    const c = await company();
    await job(c.id, 'missing', 'missing-1', 72);
    await job(c.id, 'legacy', 'legacy-1', 72);
    await prisma.sourceRun.create({ data: { sourceKey: 'legacy', status: 'OK', jobs: 10, note: 'complete and healthy' } });
    const result = await runRefresh(prisma);
    expect(result.closedJobs).toBe(0);
    expect(result.unverifiableSources).toEqual(expect.arrayContaining(['missing', 'legacy']));
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
    expect(result.unverifiableSources).toContain('kering');
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
    expect(result.unverifiableSources).toEqual(expect.arrayContaining(['fashionjobs', 'hermes']));
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
    expect(result.unverifiableSources).toContain('l-oreal-professionnel');
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
    expect(result.unverifiableSources).toContain('lagardere-travel-retail');
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
    expect(result.unverifiableSources).not.toContain('urbn-stores');
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

/**
 * LE PÉRIMÈTRE BORNÉ D'UNE REPRISE (P7).
 *
 * Pendant une reprise, seules quelques sources sont ré-ingérées. Sans périmètre technique, le refresh prendrait
 * TOUTE `JobSource` active et fermerait les offres des autres — dont les 385 en publication retenue, qui n'ont
 * pas tourné et dont le silence ne prouve donc rien. Le statut ACTIVE ne peut pas servir de périmètre.
 */
describe('runRefresh — allowlist de reprise', () => {
  it('une source cassée ne remplace jamais l’allowlist ; orphelins et réouvertures hors périmètre restent intacts', async () => {
    const c = await company();
    await job(c.id, 'allowed', 'inside', 72);
    const outside = await job(c.id, 'outside', 'outside', 72);
    await job(c.id, 'broken', 'broken', 72);
    const orphan = await job(c.id, 'outside', 'orphan', 72);
    await prisma.jobSource.updateMany({ where: { jobId: orphan.id }, data: { isActive: false } });
    const reopening = await job(c.id, 'outside', 'reopening', 0);
    await prisma.job.update({ where: { id: reopening.id }, data: { isActive: false, closedAt: new Date(Date.now() - 3600_000) } });
    await recordHealth('allowed', 'OK', 10);
    await recordHealth('outside', 'OK', 10);
    await recordHealth('broken', 'BROKEN', 0);
    const untouchedIds = [outside.id, orphan.id, reopening.id];
    const snapshot = () => prisma.job.findMany({ where: { id: { in: untouchedIds } }, include: { sources: true, events: true }, orderBy: { id: 'asc' } });
    const before = await snapshot();
    expect(await runRefresh(prisma, { onlyKeys: ['allowed'] })).toMatchObject({ closedJobs: 1, reopened: 0, withdrawn: 0 });
    expect(await snapshot()).toEqual(before);
  });

  it.each([{ onlyKeys: [] }, { onlyKeys: ['allowed'], onlySourceIds: [] }])('un périmètre vide ne modifie aucune ligne, même orpheline ou réouvrable : %j', async options => {
    const c = await company();
    const orphan = await job(c.id, 'allowed', 'orphan', 72);
    await prisma.jobSource.deleteMany({ where: { jobId: orphan.id } });
    const reopening = await job(c.id, 'allowed', 'reopening', 0);
    await prisma.job.update({ where: { id: reopening.id }, data: { isActive: false, closedAt: new Date() } });
    const snapshot = () => prisma.job.findMany({ include: { sources: true, events: true }, orderBy: { id: 'asc' } });
    const before = await snapshot();
    expect(await runRefresh(prisma, options)).toMatchObject({ checked: 0, closedSources: 0, closedJobs: 0, reopened: 0, withdrawn: 0, republished: 0 });
    expect(await snapshot()).toEqual(before);
  });

  it('un manifeste non vide ne retire ni ne republie une autre offre de la même source', async () => {
    const c = await company();
    const selected = await job(c.id, 'allowed', 'selected', 72);
    const orphan = await job(c.id, 'allowed', 'orphan', 72);
    await prisma.jobSource.updateMany({ where: { jobId: orphan.id }, data: { isActive: false } });
    const reopening = await job(c.id, 'allowed', 'reopening', 0);
    await prisma.job.update({ where: { id: reopening.id }, data: { isActive: false, closedAt: new Date() } });
    await recordHealth('allowed', 'OK', 10);
    await recordHealth('broken', 'BROKEN', 0);
    const target = await prisma.jobSource.findFirstOrThrow({ where: { jobId: selected.id } });
    const snapshot = () => prisma.job.findMany({ where: { id: { in: [orphan.id, reopening.id] } }, include: { sources: true, events: true }, orderBy: { id: 'asc' } });
    const before = await snapshot();
    expect(await runRefresh(prisma, { onlyKeys: ['allowed'], onlySourceIds: [target.id] })).toMatchObject({ closedJobs: 1, withdrawn: 0, reopened: 0 });
    expect(await snapshot()).toEqual(before);
  });

  it('la garde de volume porte sur le périmètre autorisé, même devant un grand catalogue extérieur', async () => {
    const c = await company();
    for (let i = 0; i < 3; i++) await job(c.id, 'allowed', `inside-${i}`, 72);
    for (let i = 0; i < 8; i++) await job(c.id, 'outside', `outside-${i}`, 0);
    await recordHealth('allowed', 'OK', 10);
    expect(await runRefresh(prisma, { onlyKeys: ['allowed'], minCloseForGuard: 2 })).toMatchObject({ refused: true, closedJobs: 0 });
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(11);
  });

  it('ne ferme QUE les offres des sources autorisées, même si les autres sont périmées et dignes d\'attester', async () => {
    const c = await company();
    await job(c.id, 'vague', 'dans-la-vague', 72);      // périmée, DANS le périmètre
    await job(c.id, 'hors-vague', 'hors-de-la-vague', 72); // périmée aussi, HORS périmètre
    // Les deux sources ont un droit de fermer parfaitement valide : seul le périmètre les sépare.
    await recordHealth('vague', 'OK', 10);
    await recordHealth('hors-vague', 'OK', 10);

    const result = await runRefresh(prisma, { onlyKeys: ['vague'] });

    expect(result.closedJobs).toBe(1);
    const inWave = await prisma.job.findFirst({ where: { externalId: 'dans-la-vague' } });
    const outside = await prisma.job.findFirst({ where: { externalId: 'hors-de-la-vague' } });
    expect(inWave!.isActive).toBe(false);
    // L'offre hors périmètre est INTACTE : ni fermée, ni retirée, ni sa source désactivée.
    expect(outside!.isActive).toBe(true);
    expect(outside!.closedAt).toBeNull();
    expect(outside!.withdrawnAt).toBeNull();
    const outsideSource = await prisma.jobSource.findFirst({ where: { sourceKey: 'hors-vague' } });
    expect(outsideSource!.isActive).toBe(true);
  });

  it('une offre attestée par une source hors périmètre ne se ferme pas quand celle de la vague se tait', async () => {
    const c = await company();
    const j = await job(c.id, 'vague', 'partagee', 72);
    // La seconde source, hors périmètre, l'atteste encore : l'offre doit vivre.
    await prisma.jobSource.create({ data: { jobId: j.id, sourceKey: 'hors-vague', sourceTier: 'ATS_OFFICIAL',
      externalId: 's-partagee-2', url: 'https://x/partagee', isActive: true, lastSeenAt: new Date() } });
    await recordHealth('vague', 'OK', 10);
    await recordHealth('hors-vague', 'OK', 10);

    const result = await runRefresh(prisma, { onlyKeys: ['vague'] });

    expect(result.closedJobs).toBe(0);
    expect((await prisma.job.findFirst({ where: { externalId: 'partagee' } }))!.isActive).toBe(true);
  });

  it('sans allowlist, le comportement historique est inchangé', async () => {
    const c = await company();
    await job(c.id, 'vague', 'a', 72);
    await job(c.id, 'hors-vague', 'b', 72);
    await recordHealth('vague', 'OK', 10);
    await recordHealth('hors-vague', 'OK', 10);

    const result = await runRefresh(prisma);

    expect(result.closedJobs).toBe(2);
  });
});

/**
 * PARITÉ PRÉVISUALISATION / MUTATION — le manifeste figé est la seule liste que le refresh touche.
 *
 * Sans lui, la revue et l'exécution feraient deux calculs indépendants : l'état peut bouger entre les deux, et
 * la mutation toucherait des offres que personne n'a examinées. Ces tests exercent le VRAI `runRefresh` sur
 * une base réelle, pas un objet simulé.
 */
describe('runRefresh — manifeste figé', () => {
  it('ne touche QUE les lignes du manifeste, même si d\'autres sont périmées et fermables', async () => {
    const c = await company();
    const inManifest = await job(c.id, 'vague', 'dans-le-manifeste', 72);
    await job(c.id, 'vague', 'hors-manifeste', 72);   // périmée, même source, même droit
    await recordHealth('vague', 'OK', 10);

    const target = await prisma.jobSource.findFirstOrThrow({ where: { externalId: 's-dans-le-manifeste' } });
    const result = await runRefresh(prisma, { onlyKeys: ['vague'], onlySourceIds: [target.id] });

    expect(result.closedJobs).toBe(1);
    expect((await prisma.job.findFirstOrThrow({ where: { id: inManifest.id } })).isActive).toBe(false);
    // La ligne hors manifeste est INTACTE : le périmètre par identifiant a tenu.
    const outside = await prisma.job.findFirstOrThrow({ where: { externalId: 'hors-manifeste' } });
    expect(outside.isActive).toBe(true);
    expect(outside.closedAt).toBeNull();
  });

  /** Un manifeste VIDE ne signifie pas « aucune borne » : il signifie « rien à désactiver ». */
  it('un manifeste vide ne ferme rien, même avec des offres périmées', async () => {
    const c = await company();
    await job(c.id, 'vague', 'perimee', 72);
    await recordHealth('vague', 'OK', 10);

    const result = await runRefresh(prisma, { onlyKeys: ['vague'], onlySourceIds: [] });

    expect(result.closedJobs).toBe(0);
    expect((await prisma.job.findFirstOrThrow({ where: { externalId: 'perimee' } })).isActive).toBe(true);
  });

  /** Une ligne du manifeste appartenant à une source hors allowlist ne passe pas : les deux bornes se cumulent. */
  it('manifeste et allowlist se cumulent, ils ne se remplacent pas', async () => {
    const c = await company();
    await job(c.id, 'hors-vague', 'intruse', 72);
    await recordHealth('hors-vague', 'OK', 10);

    const intruder = await prisma.jobSource.findFirstOrThrow({ where: { externalId: 's-intruse' } });
    const result = await runRefresh(prisma, { onlyKeys: ['vague'], onlySourceIds: [intruder.id] });

    expect(result.closedJobs).toBe(0);
    expect((await prisma.job.findFirstOrThrow({ where: { externalId: 'intruse' } })).isActive).toBe(true);
  });

  /**
   * LE CAS QUI COMPTE POUR LA PARITÉ : une offre attestée par une source HORS périmètre reste ouverte, et la
   * conséquence annoncée par la prévisualisation (`JOB_KEPT_BY_ANOTHER_SOURCE`) est bien celle produite.
   */
  it('une autre source active hors allowlist maintient l\'offre ouverte', async () => {
    const c = await company();
    const j = await job(c.id, 'vague', 'partagee', 72);
    await prisma.jobSource.create({ data: { jobId: j.id, sourceKey: 'hors-vague', sourceTier: 'ATS_OFFICIAL',
      externalId: 's-partagee-2', url: 'https://x/partagee', isActive: true, lastSeenAt: new Date() } });
    await recordHealth('vague', 'OK', 10);

    const target = await prisma.jobSource.findFirstOrThrow({ where: { externalId: 's-partagee' } });
    const result = await runRefresh(prisma, { onlyKeys: ['vague'], onlySourceIds: [target.id] });

    // La représentation est désactivée, mais l'offre survit : exactement la conséquence prévue.
    expect(result.closedJobs).toBe(0);
    expect((await prisma.job.findFirstOrThrow({ where: { id: j.id } })).isActive).toBe(true);
    expect((await prisma.jobSource.findFirstOrThrow({ where: { id: target.id } })).isActive).toBe(false);
  });
});


describe('frozen refresh manifests', () => {
  it('covers source deactivation and parent state, leaves other lifecycle actions alone, and resumes once', async () => {
    const c = await company();
    const absent = await job(c.id, 'manifest-cycle', 'absent', 72);
    const orphan = await job(c.id, 'manifest-cycle', 'orphan', 72);
    await prisma.jobSource.updateMany({ where: { jobId: orphan.id }, data: { isActive: false } });
    const reopen = await job(c.id, 'manifest-cycle', 'reopen', 0);
    await prisma.job.update({ where: { id: reopen.id }, data: { isActive: false, closedAt: new Date(Date.now() - 60000) } });
    await recordSourceEvidence(prisma, 'manifest-cycle', { observedIds: ['s-reopen'] });
    const otherBefore = await prisma.job.findMany({ where: { id: { in: [orphan.id, reopen.id] } }, include: { sources: true, events: true }, orderBy: { id: 'asc' } });
    const manifest = await createRefreshManifest(prisma, await readRefreshPlan(prisma, { onlyKeys: ['manifest-cycle'] }));
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]).toMatchObject({ jobId: absent.id, state: 'ABSENT_FROM_PROVEN_ENUMERATION' });
    const result = await runRefresh(prisma, { manifest });
    expect(result).toMatchObject({ closedSources: 1, closedJobs: 1, withdrawn: 0, reopened: 0, republished: 0 });
    expect(await runRefresh(prisma, { manifest })).toMatchObject({ closedSources: 0, closedJobs: 0, reopened: 0 });
    expect(await prisma.job.findMany({ where: { id: { in: [orphan.id, reopen.id] } }, include: { sources: true, events: true }, orderBy: { id: 'asc' } })).toEqual(otherBefore);
    const audit = await prisma.dataCorrection.findMany({ where: { batchId: result.auditBatchId } });
    expect(audit).toHaveLength(1);
    expect(audit[0].evidence).toMatchObject({ outcome: 'APPLIED', deactivatedIds: [manifest.entries[0].jobSourceId] });
    expect(await prisma.jobEvent.count({ where: { jobId: absent.id, type: 'CLOSED' } })).toBe(1);
  });

  it.each(['reattested', 'new-proof'] as const)('records a safe skip when %s changes after freezing', async change => {
    const c = await company();
    const absent = await job(c.id, 'manifest-change', change, 72);
    await recordSourceEvidence(prisma, 'manifest-change');
    const manifest = await createRefreshManifest(prisma, await readRefreshPlan(prisma, { onlyKeys: ['manifest-change'] }));
    expect(manifest.entries).toHaveLength(1);
    if (change === 'reattested') await prisma.jobSource.updateMany({ where: { jobId: absent.id }, data: { lastSeenAt: new Date() } });
    else await recordSourceEvidence(prisma, 'manifest-change');
    const before = await prisma.job.findUniqueOrThrow({ where: { id: absent.id }, include: { sources: true, events: true } });
    const result = await runRefresh(prisma, { manifest });
    expect(result).toMatchObject({ closedSources: 0, closedJobs: 0 });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: absent.id }, include: { sources: true, events: true } })).toEqual(before);
    const audit = await prisma.dataCorrection.findFirstOrThrow({ where: { batchId: result.auditBatchId } });
    expect(audit.evidence).toMatchObject({ outcome: change === 'reattested' ? 'BEFORE_STATE_CHANGED' : 'EVIDENCE_CHANGED', deactivatedIds: [] });
  });

  it('rejects a modified manifest before any write', async () => {
    const c = await company();
    await job(c.id, 'manifest-invalid', 'invalid', 72);
    await recordSourceEvidence(prisma, 'manifest-invalid');
    const manifest = await createRefreshManifest(prisma, await readRefreshPlan(prisma, { onlyKeys: ['manifest-invalid'] }));
    await expect(runRefresh(prisma, { manifest, staleHours: manifest.limits.staleHours + 1 })).rejects.toThrow('Manifest limit mismatch');
    manifest.entries[0].proof.hash = '0'.repeat(64);
    await expect(runRefresh(prisma, { manifest })).rejects.toThrow('invalid plan hash');
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(1);
  });
});


describe('persisted enumeration dispositions', () => {
  it('keeps a rejected posting distinct from both absence and successful re-attestation', async () => {
    const c = await company();
    const rejected = await job(c.id, 'rejected-proof', 'rejected', 72);
    const absent = await job(c.id, 'rejected-proof', 'absent', 72);
    const runId = await recordSourceEvidence(prisma, 'rejected-proof', { observedIds: ['s-rejected'] });
    await prisma.pipelineEvent.create({ data: { id: randomUUID(), runId, sourceKey: 'rejected-proof', event: 'source.rows_rejected',
      fingerprint: 'rejected-proof', level: 'warn', payload: { rejectedRows: [{ canonicalId: 's-rejected', reason: 'MISSING_TITLE' }] } } });
    const plan = await readRefreshPlan(prisma, { onlyKeys: ['rejected-proof'] });
    const source = await prisma.jobSource.findFirstOrThrow({ where: { jobId: rejected.id } });
    expect(plan.absencePlan.states.get(source.id)).toBe('PRESENT_BUT_REJECTED');
    expect(plan.wouldClose).toEqual([absent.id]);
    expect(await runRefresh(prisma, { onlyKeys: ['rejected-proof'] })).toMatchObject({ closedSources: 1 });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: rejected.id } })).toMatchObject({ isActive: true });
  });

  it.each(['job.write_failed', 'job.publication_held', 'source.rows_rejected'])('an anonymous %s cannot establish absence', async event => {
    const c = await company();
    await job(c.id, 'anonymous-proof', 'unknown', 72);
    const runId = await recordSourceEvidence(prisma, 'anonymous-proof');
    await prisma.pipelineEvent.create({ data: { id: randomUUID(), runId, sourceKey: 'anonymous-proof', event,
      fingerprint: event, level: 'warn', payload: event === 'source.rows_rejected' ? { rejectedRows: [{ reason: 'NO_ID' }] } : {} } });
    expect(await runRefresh(prisma, { onlyKeys: ['anonymous-proof'] })).toMatchObject({ closedSources: 0, closedJobs: 0 });
  });
});


it('archives the exact manifest immutably and loads it by hash for a worker restart', async () => {
  const c = await company();
  await job(c.id, 'stored-manifest', 'stored', 72);
  await recordSourceEvidence(prisma, 'stored-manifest');
  const manifest = await createRefreshManifest(prisma, await readRefreshPlan(prisma, { onlyKeys: ['stored-manifest'] }));
  await storeRefreshManifest(prisma, manifest, 'a'.repeat(40));
  await storeRefreshManifest(prisma, manifest, 'a'.repeat(40));
  expect(await loadRefreshManifest(prisma, manifest.planHash)).toEqual(manifest);
  await expect(prisma.maintenancePlan.update({ where: { id: manifest.planHash }, data: { body: {} } })).rejects.toThrow('MaintenancePlan is immutable');
  expect(await loadRefreshManifest(prisma, manifest.planHash)).toEqual(manifest);
  expect(await runRefresh(prisma, { manifest: await loadRefreshManifest(prisma, manifest.planHash) })).toMatchObject({ closedSources: 1, closedJobs: 1 });
});
