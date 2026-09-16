import { publicationFixture } from '../test/publication-fixture.js';
import { loadRefreshManifest, storeRefreshManifest } from './refreshManifest.js';
import '../test/setup-integration.js';
import { attestSyntheticFeed, collectAdmittedWithoutCompletion, ingestSyntheticFeed, releaseQualifiedSources, resolvedCompany } from '../test/ingestionFixture.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runRefresh, readRefreshPlan, createRefreshManifest } from './refresh.js';
import { lockCompanyRows } from '../lib/writeLocks.js';

/**
 * Integration tests for the refresh lifecycle pass (against the local audit DB).
 *
 * Refresh closes offers no source reports any more — but it must NOT close the
 * offers of a source that just broke (a rotated key, a WAF), because those
 * offers still exist; the source simply went silent. And a run that would close
 * a large share of the whole base at once is a signal of a systemic failure, not
 * a normal lifecycle event, so it is refused.
 *
 * Every proof here is a genuine admitted, sealed and completed collection produced
 * by the production ingestion against a synthetic native feed. No health row and no
 * diagnostic log can stand in for it.
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
      canonicalSourceKey: sourceKey, canonicalExternalId: `s-${externalId}`, canonicalTier: 'ATS_OFFICIAL',
      isActive: true,
      lastSeenAt: seen,
      sources: {
        create: {
          sourceKey,
          sourceTier: 'ATS_OFFICIAL',
          externalId: `s-${externalId}`,
          ...publicationFixture({ sourceKey, externalId: `s-${externalId}`, url: `https://x/${externalId}`, title: 'Vendeur' }),
          url: `https://x/${externalId}`,
          isActive: true,
          lastSeenAt: seen,
        },
      },
    },
  });
}

/** A complete, proven collection of the given native ids: attesting from its second run. */
const attest = (sourceKey: string, ids: string[] = []) => attestSyntheticFeed(prisma, sourceKey, ids.map(id => ({ id })));
/** A collection that failed before any sealed result: the source went silent. */
const broken = (sourceKey: string, body = '{}') => ingestSyntheticFeed(prisma, sourceKey, body);

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await releaseQualifiedSources(prisma);
  await prisma.$disconnect();
});

describe('runRefresh', () => {
  it('un compteur de santé ne remplace pas une capture attestante', async () => {
    const c = await company();
    await job(c.id, 'health-only', 'not-proven-absent', 72);
    await prisma.sourceRun.create({ data: { sourceKey: 'health-only', status: 'OK', jobs: 1,
      canAttestAbsence: true, complete: true, errors: 0, truncated: false, runId: 'health-row' } });
    const plan = await readRefreshPlan(prisma, { onlyKeys: ['health-only'] });
    expect(plan.absencePlan.eligibility[0]).toMatchObject({ source: 'health-only', eligible: false, reasons: ['source absente du registre'] });
    expect(await runRefresh(prisma)).toMatchObject({ closedSources: 0, closedJobs: 0 });
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(1);
  });

  it('seule l’absence prouvée ferme ; un retrait natif n’est jamais converti en fermeture employeur', async () => {
    const c = await company();
    const present = await job(c.id, 'proven', 'present', 72);
    const absent = await job(c.id, 'proven', 'absent', 72);
    // The publisher still lists `present` but unlisted: a native withdrawal, sealed in the capture.
    // The feed also carries a qualified publication; a feed made only of holds is rejected by validation.
    const stats = await attestSyntheticFeed(prisma, 'proven', [{ id: 's-present', listed: false }, { id: 's-kept' }]);
    expect(stats).toMatchObject({ errors: 0, held: 1 });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: present.id } })).toMatchObject({ isActive: false, closedAt: null, withdrawalReason: 'SOURCE_UNLISTED' });
    const plan = await readRefreshPlan(prisma, { onlyKeys: ['proven'] });
    expect(plan.absencePlan.eligibility[0]).toMatchObject({ source: 'proven', eligible: true });
    expect(plan.absencePlan.deactivations.map(source => source.jobId)).toEqual([absent.id]);
    expect(await runRefresh(prisma, { onlyKeys: ['proven'] })).toMatchObject({ closedSources: 1, closedJobs: 1 });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: absent.id } })).toMatchObject({ isActive: false, closedAt: expect.any(Date), withdrawnAt: null });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: present.id } })).toMatchObject({ isActive: false, closedAt: null, withdrawalReason: 'SOURCE_UNLISTED' });
    const closed = await prisma.jobSource.findMany({ where: { isActive: false, sourceKey: 'proven', externalId: 's-absent' }, select: { id: true } });
    expect(closed.map(source => source.id)).toEqual(plan.absencePlan.deactivations.map(source => source.jobSourceId));
  });

  it('refuse une preuve dès qu’une tentative plus récente n’a pas achevé sa publication', async () => {
    const c = await company();
    await job(c.id, 'proof-cycle', 'old', 72);
    await attest('proof-cycle');
    await collectAdmittedWithoutCompletion(prisma, 'proof-cycle', [{ id: 's-old' }]);
    const plan = await readRefreshPlan(prisma, { onlyKeys: ['proof-cycle'] });
    expect(plan.absencePlan.eligibility[0].reasons).toEqual(['publication inachevée : aucun rapport de fin d’ingestion']);
    expect(await runRefresh(prisma)).toMatchObject({ closedJobs: 0, closedSources: 0 });
  });

  it.each(['reattestation', 'newer-attempt'] as const)('revalide après attente du verrou : %s plus récente que le plan', async change => {
    const c = await company();
    const target = await job(c.id, 'race', 'race', 72);
    await attest('race');
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
      else await collectAdmittedWithoutCompletion(prisma, 'race', [{ id: 's-race' }]);
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
    await attest('kering'); // kering enumerates an empty, proven board: this offer is gone

    const result = await runRefresh(prisma);

    expect(result.closedJobs).toBe(1);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(0);
  });

  it('ferme : closedAt posé + CLOSED ; ré-ouvre : closedAt null, reopenedCount 1 + REOPENED', async () => {
    const c = await company();
    const j = await job(c.id, 'kering', 'k1', 72);
    await attest('kering');
    const before = Date.now();
    expect((await runRefresh(prisma)).closedJobs).toBe(1);
    const afterClose = await prisma.job.findUniqueOrThrow({ where: { id: j.id } });
    expect(afterClose).toMatchObject({ isActive: false, reopenedCount: 0 });
    expect(afterClose.closedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const events = () => prisma.jobEvent.findMany({ where: { jobId: j.id }, orderBy: { at: 'asc' }, select: { type: true } });
    expect((await events()).map(event => event.type)).toEqual(['CLOSED']);
    // The source lists the offer again (ingestion reactivates the JobSource): the refresh reopens it.
    await prisma.jobSource.updateMany({ where: { jobId: j.id }, data: { isActive: true, lastSeenAt: new Date() } });
    expect((await runRefresh(prisma)).reopened).toBe(1);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: j.id } })).toMatchObject({ isActive: true, closedAt: null, reopenedCount: 1 });
    expect((await events()).map(event => event.type)).toEqual(['CLOSED', 'REOPENED']);
  });

  it('écrit un CLOSED par offre fermée, en lot', async () => {
    const c = await company();
    for (const id of ['k1', 'k2', 'k3']) await job(c.id, 'kering', id, 72);
    await attest('kering');
    expect((await runRefresh(prisma)).closedJobs).toBe(3);
    expect(await prisma.jobEvent.count({ where: { type: 'CLOSED' } })).toBe(3);
    expect(await prisma.job.count({ where: { closedAt: { not: null } } })).toBe(3);
  });

  it('writes exactly one closure event when several refreshes overlap', async () => {
    const c = await company();
    const j = await job(c.id, 'healthy', 'concurrent', 72);
    await attest('healthy');
    const results = await Promise.all(Array.from({ length: 4 }, () => runRefresh(prisma)));
    expect(results.reduce((n, r) => n + r.closedJobs, 0)).toBe(1);
    expect(await prisma.jobEvent.count({ where: { jobId: j.id, type: 'CLOSED' } })).toBe(1);
  });

  /**
   * A source that went silent proves nothing: an invalid feed (rotated key, moved path), a
   * transport error (timeout, reset) or an anti-bot challenge page (the L'Oréal case, D51)
   * all leave the collection FAILED, without sealed result or completion. Its offers survive.
   */
  it.each([
    ['invalid-feed', '{}'],
    ['transport-error', () => Promise.reject(new Error('ECONNRESET'))],
    ['anti-bot-challenge', '<html><body>Checking your browser</body></html>'],
  ] as const)('does NOT close offers of a source that just broke: %s', async (_case, feed) => {
    const c = await company();
    await job(c.id, 'kering', 'k1', 72);
    await job(c.id, 'kering', 'k2', 72);
    expect((await ingestSyntheticFeed(prisma, 'kering', feed)).errors).toBe(1);
    const result = await runRefresh(prisma);
    expect(result.closedJobs).toBe(0);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(2);
    expect(result.unverifiableSources).toContain('kering');
  });

  it('keeps a multi-source offer while any source still reports it', async () => {
    // The job belongs to the Maison loreal's ingestion resolves, so its feed can re-attest it.
    const c = await resolvedCompany(prisma, 'loreal');
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
            { sourceKey: 'loreal', sourceTier: 'ATS_OFFICIAL', externalId: 's-l', url: 'https://x/shared', ...publicationFixture({ sourceKey: 'loreal', externalId: 's-l', url: 'https://x/shared', title: 'Vendeur' }), isActive: true, lastSeenAt: seenNew },
          ],
        },
      },
    });
    await attest('kering');
    await attest('loreal', ['s-l']);

    const result = await runRefresh(prisma);

    expect(result.closedJobs).toBe(0);
    const still = await prisma.job.findUnique({ where: { id: j.id } });
    expect(still?.isActive).toBe(true);
  });

  // Dix attestations synthétiques, chacune une ingestion complète (~0,45 s mesurée le 16/09/2026) :
  // le plafond implicite de 5 s est dépassé dès que la machine est chargée, et un témoin qui expire
  // rend la main pendant que son `withNetwork` restaure le fetch réel sous le témoin suivant.
  it('refuses a mass closure that would empty most of the base', async () => {
    const c = await company();
    // 10 offers, all stale, all from proven-empty sources -> would close all 10.
    for (let i = 0; i < 10; i++) {
      await job(c.id, `src${i}`, `mass${i}`, 72);
      await attest(`src${i}`);
    }

    // A guard rail: closing 100% of the base at once is a systemic failure.
    // minCloseForGuard lowered so the mechanism is exercised without seeding 50.
    const result = await runRefresh(prisma, { maxCloseRatio: 0.5, minCloseForGuard: 2 });

    expect(result.refused).toBe(true);
    // Nothing was actually closed.
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(10);
  }, 30_000);
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
    await attest('allowed');
    await attest('outside');
    await broken('broken');
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
    await attest('allowed');
    await broken('broken');
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
    await attest('allowed');
    expect(await runRefresh(prisma, { onlyKeys: ['allowed'], minCloseForGuard: 2 })).toMatchObject({ refused: true, closedJobs: 0 });
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(11);
  });

  it('ne ferme QUE les offres des sources autorisées, même si les autres sont périmées et dignes d\'attester', async () => {
    const c = await company();
    await job(c.id, 'vague', 'dans-la-vague', 72);      // périmée, DANS le périmètre
    await job(c.id, 'hors-vague', 'hors-de-la-vague', 72); // périmée aussi, HORS périmètre
    // Les deux sources ont un droit de fermer parfaitement valide : seul le périmètre les sépare.
    await attest('vague');
    await attest('hors-vague');

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
    const c = await resolvedCompany(prisma, 'hors-vague');
    const j = await job(c.id, 'vague', 'partagee', 72);
    // La seconde source, hors périmètre, l'atteste encore : l'offre doit vivre.
    await prisma.jobSource.create({ data: { jobId: j.id, sourceKey: 'hors-vague', sourceTier: 'ATS_OFFICIAL',
      externalId: 's-partagee-2', url: 'https://x/partagee', ...publicationFixture({ sourceKey: 'hors-vague', externalId: 's-partagee-2', url: 'https://x/partagee', title: 'Vendeur' }), isActive: true, lastSeenAt: new Date() } });
    await attest('vague');
    await attest('hors-vague', ['s-partagee-2']);

    const result = await runRefresh(prisma, { onlyKeys: ['vague'] });

    expect(result.closedJobs).toBe(0);
    expect((await prisma.job.findUnique({ where: { id: j.id } }))!.isActive).toBe(true);
  });

  it('sans allowlist, le comportement historique est inchangé', async () => {
    const c = await company();
    await job(c.id, 'vague', 'a', 72);
    await job(c.id, 'hors-vague', 'b', 72);
    await attest('vague');
    await attest('hors-vague');

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
  it('rejects a changed publication projection after a maintenance preview', async () => {
    const c = await company(), target = await job(c.id, 'vague', 'projection-revision', 72);
    await attest('vague');
    const manifest = await createRefreshManifest(prisma, await readRefreshPlan(prisma, { onlyKeys: ['vague'] }));
    const source = await prisma.jobSource.findFirstOrThrow({ where: { jobId: target.id } });
    const presentation = JSON.parse(JSON.stringify(source.presentation));
    presentation.values.description = 'Reviewed corrected description';
    await prisma.jobSource.update({ where: { id: source.id }, data: { presentation } });
    expect(await runRefresh(prisma, { manifest })).toMatchObject({ closedJobs: 0, closedSources: 0 });
    expect((await prisma.job.findUniqueOrThrow({ where: { id: target.id } })).isActive).toBe(true);
    expect((await prisma.jobSource.findUniqueOrThrow({ where: { id: source.id } })).isActive).toBe(true);
  });

  it('ne touche QUE les lignes du manifeste, même si d\'autres sont périmées et fermables', async () => {
    const c = await company();
    const inManifest = await job(c.id, 'vague', 'dans-le-manifeste', 72);
    await job(c.id, 'vague', 'hors-manifeste', 72);   // périmée, même source, même droit
    await attest('vague');

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
    await attest('vague');

    const result = await runRefresh(prisma, { onlyKeys: ['vague'], onlySourceIds: [] });

    expect(result.closedJobs).toBe(0);
    expect((await prisma.job.findFirstOrThrow({ where: { externalId: 'perimee' } })).isActive).toBe(true);
  });

  /** Une ligne du manifeste appartenant à une source hors allowlist ne passe pas : les deux bornes se cumulent. */
  it('manifeste et allowlist se cumulent, ils ne se remplacent pas', async () => {
    const c = await company();
    await job(c.id, 'hors-vague', 'intruse', 72);
    await attest('hors-vague');

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
      externalId: 's-partagee-2', url: 'https://x/partagee', ...publicationFixture({ sourceKey: 'hors-vague', externalId: 's-partagee-2', url: 'https://x/partagee', title: 'Vendeur' }), isActive: true, lastSeenAt: new Date() } });
    await attest('vague');

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
    await attest('manifest-cycle');
    const otherBefore = await prisma.job.findMany({ where: { id: { in: [orphan.id, reopen.id] } }, include: { sources: true, events: true }, orderBy: { id: 'asc' } });
    const manifest = await createRefreshManifest(prisma, await readRefreshPlan(prisma, { onlyKeys: ['manifest-cycle'] }));
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]).toMatchObject({ jobId: absent.id, state: 'ABSENT_FROM_PROVEN_ENUMERATION', proof: { kind: 'ENUMERATION', captureBatchId: expect.any(String) } });
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
    await attest('manifest-change');
    const manifest = await createRefreshManifest(prisma, await readRefreshPlan(prisma, { onlyKeys: ['manifest-change'] }));
    expect(manifest.entries).toHaveLength(1);
    if (change === 'reattested') await prisma.jobSource.updateMany({ where: { jobId: absent.id }, data: { lastSeenAt: new Date() } });
    else await attest('manifest-change');
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
    await attest('manifest-invalid');
    const manifest = await createRefreshManifest(prisma, await readRefreshPlan(prisma, { onlyKeys: ['manifest-invalid'] }));
    await expect(runRefresh(prisma, { manifest, staleHours: manifest.limits.staleHours + 1 })).rejects.toThrow('Manifest limit mismatch');
    manifest.entries[0].proof.hash = '0'.repeat(64);
    await expect(runRefresh(prisma, { manifest })).rejects.toThrow('invalid plan hash');
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(1);
  });
});


describe('persisted enumeration dispositions', () => {
  /**
   * With this family, a row the adapter cannot turn into a posting refutes the enumeration
   * and the technical validation rejects the collection. Neither a named nor an anonymous
   * rejection can therefore establish an absence: the source stays unverifiable, and the
   * disposition itself is never mistaken for a disappearance.
   */
  it.each([
    ['named', { id: 's-rejected', title: null }],
    ['anonymous', { title: 'No identifier at all' }],
  ] as const)('a %s rejected row cannot establish absence', async (_case, rejected) => {
    const c = await company();
    const target = await job(c.id, 'rejected-proof', 'rejected', 72);
    await job(c.id, 'rejected-proof', 'absent', 72);
    expect((await ingestSyntheticFeed(prisma, 'rejected-proof', [rejected])).errors).toBe(1);
    const plan = await readRefreshPlan(prisma, { onlyKeys: ['rejected-proof'] });
    expect(plan.absencePlan.eligibility[0].eligible).toBe(false);
    expect(await runRefresh(prisma, { onlyKeys: ['rejected-proof'] })).toMatchObject({ closedSources: 0, closedJobs: 0 });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ isActive: true });
  });
});


it('archives the exact manifest immutably and loads it by hash for a worker restart', async () => {
  const c = await company();
  await job(c.id, 'stored-manifest', 'stored', 72);
  await attest('stored-manifest');
  const manifest = await createRefreshManifest(prisma, await readRefreshPlan(prisma, { onlyKeys: ['stored-manifest'] }));
  await storeRefreshManifest(prisma, manifest, 'a'.repeat(40));
  await storeRefreshManifest(prisma, manifest, 'a'.repeat(40));
  expect(await loadRefreshManifest(prisma, manifest.planHash)).toEqual(manifest);
  await expect(prisma.maintenancePlan.update({ where: { id: manifest.planHash }, data: { body: {} } })).rejects.toThrow('MaintenancePlan is immutable');
  expect(await loadRefreshManifest(prisma, manifest.planHash)).toEqual(manifest);
  expect(await runRefresh(prisma, { manifest: await loadRefreshManifest(prisma, manifest.planHash) })).toMatchObject({ closedSources: 1, closedJobs: 1 });
});
