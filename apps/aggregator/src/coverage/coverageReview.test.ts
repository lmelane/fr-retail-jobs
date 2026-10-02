import '../test/setup-integration.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { readCoverageBefore } from './coverageReading.js';
import { runCoverageReview, withCoverageReview } from './coverageReview.js';

/**
 * R-143 §11, D-516 §2 — la revue de couverture sur une base réelle : l'avant des étapes qui masquent, ce qu'elles
 * retirent par cause (retenue de disponibilité, fermeture), la menace d'une collecte que le RUN n'a pas revue, la
 * photographie écrite après l'envoi, et la référence relue au RUN suivant. L'envoi Brevo est intercepté (aucun réseau).
 */
const prisma = new PrismaClient();
const HOUR = 3_600_000;
const ago = (h: number) => new Date(Date.now() - h * HOUR);
const KEYS = ['cov-hm', 'cov-dip', 'cov-sw', 'cov-pl'];
let mails: Array<{ subject: string; htmlContent: string }> = [];
let runId = '';

async function wipe() {
  await prisma.coverageSnapshot.deleteMany({});
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.company.deleteMany({ where: { mergedIntoId: { not: null } } });
  await prisma.company.deleteMany({});
  await prisma.sourceRun.deleteMany({});
  await prisma.pipelineRun.deleteMany({ where: { command: { in: ['ingest-all', 'ingest-light'] }, events: { none: {} } } });
}
/** Une fusion de sociétés n'existe que relue (contrainte `Company_identity_relationship_review`), comme R-143 §5 l'écrit. */
async function company(key: string, name: string, mergedIntoId?: string) {
  const review = mergedIntoId ? await prisma.employerIdentityReview.create({ data: { id: `cov-${randomUUID()}`, statement: 'Entité rattachée à sa Maison (test)',
    evidence: [], planHash: 'coverage-test', reviewedBy: 'integration-test', reviewedAt: new Date() } }) : null;
  return prisma.company.create({ data: { name, canonicalKey: key, fashionjobsUrl: `cov:${key}`,
    ...(mergedIntoId ? { mergedIntoId, identityReviewId: review!.id } : {}) } });
}
let n = 0;
async function offer(companyId: string, sourceKey: string, seenHoursAgo: number) {
  const ext = `${sourceKey}-${n++}`;
  return prisma.job.create({ data: { companyId, externalId: ext, source: 'GENERIC_JSONLD', title: 'Conseiller de vente',
    url: `https://x/${ext}`, countryCode: 'FR', canonicalSourceKey: sourceKey, firstSeenAt: ago(240), sources: { create: [{ sourceKey,
      sourceTier: 'EMPLOYER_DIRECT', externalId: ext, url: `https://x/${ext}`, lastSeenAt: ago(seenHoursAgo) }] } }, include: { sources: true } });
}
/** Ce que posent les étapes qui retirent : la retenue de disponibilité (R-143 §2) et la fermeture prouvée. */
async function hold(jobs: Array<{ sources: Array<{ id: string }> }>, rule: string) {
  await prisma.jobSource.updateMany({ where: { id: { in: jobs.flatMap(j => j.sources.map(s => s.id)) } },
    data: { availabilityHold: 'NOT_RECONFIRMED', availabilityHoldAt: new Date(), availabilityEvidence: { rule } } });
}
async function close(jobs: Array<{ id: string }>) {
  for (const job of jobs) {
    await prisma.jobSource.updateMany({ where: { jobId: job.id }, data: { isActive: false } });
    await prisma.job.update({ where: { id: job.id }, data: { isActive: false, closedAt: new Date() } });
    await prisma.jobEvent.create({ data: { jobId: job.id, type: 'CLOSED', at: new Date() } });
  }
}
async function snapshot(hoursAgo: number, rows: Array<[string, string, number, string?]>) {
  await prisma.coverageSnapshot.createMany({ data: rows.map(([scope, key, served, label]) =>
    ({ takenAt: ago(hoursAgo), scope, key, label: label ?? key, served })) });
}

beforeEach(async () => {
  await wipe();
  mails = [];
  process.env.BREVO_API_KEY = 'test-key';
  process.env.BREVO_SENDER_EMAIL = 'alertes@example.test';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    mails.push(JSON.parse(String(init?.body)));
    return new Response('{}', { status: 201 });
  });
  for (const key of KEYS) {
    if (!await prisma.source.findUnique({ where: { key } })) await prisma.source.create({ data: { key, maison: key, tenantKey: `ashby:${key}`,
      kind: 'ashby', config: { board: key }, tier: 'EMPLOYER_DIRECT', status: 'ACTIVE' } });
  }
  // Le RUN a commencé il y a une heure : H&M et Swatch ont été revues par lui, Diptyque non (collecte en échec).
  runId = randomUUID();
  await prisma.pipelineRun.create({ data: { id: runId, command: 'ingest-all', startedAt: ago(1) } });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BREVO_API_KEY;
  delete process.env.BREVO_SENDER_EMAIL;
});
afterAll(async () => { await wipe(); await prisma.$disconnect(); });

/** H&M : 30 offres ; Diptyque : 12 offres que le RUN n'a pas revues ; Swatch : 20 offres. Chaque perte de la scène
 * atteint le plancher de la règle d'anomalie (D-518, `ANOMALY.floor`). */
async function scene() {
  const hm = await company('hm', 'H&M'), dip = await company('dip', 'Diptyque'), sw = await company('sw', 'Swatch');
  const hmJobs = [], swJobs = [];
  for (let i = 0; i < 30; i++) hmJobs.push(await offer(hm.id, 'cov-hm', 0.5));
  for (let i = 0; i < 12; i++) await offer(dip.id, 'cov-dip', 30);
  for (let i = 0; i < 20; i++) swJobs.push(await offer(sw.id, 'cov-sw', 0.5));
  await prisma.sourceRun.create({ data: { sourceKey: 'cov-dip', status: 'ERROR', jobs: 0, note: 'Access qualification refused', ranAt: ago(0.8) } });
  return { hm, dip, sw, hmJobs, swJobs };
}

describe('le premier RUN qui masque, sans aucune photographie (CoverageSnapshot vide)', () => {
  it('voit ce que ses étapes retirent, par cause, et la menace d’une collecte non revue', async () => {
    const { hm, sw, hmJobs, swJobs } = await scene();
    expect(await prisma.coverageSnapshot.count()).toBe(0);
    const before = await readCoverageBefore(prisma);
    await hold(hmJobs.slice(0, 12), 'MISSED_BY_CREDIBLE_COLLECTION');
    await close(swJobs.slice(0, 12));
    const review = await runCoverageReview(prisma, { before });
    expect(review.evaluation.referenceRuns).toBe(0);
    const byKey = new Map(review.evaluation.findings.map(f => [f.key, f]));
    expect(byKey.get(hm.id)).toMatchObject({ kind: 'PERTE', basis: 'RUN', reference: 30, served: 18, lost: 12, cause: 'NON_REVUE',
      gravity: 'A_VERIFIER', sources: [{ sourceKey: 'cov-hm', count: 12 }] });
    expect(byKey.get(sw.id)).toMatchObject({ kind: 'PERTE', basis: 'RUN', lost: 12, cause: 'FERMETURE_SOURCE', gravity: 'INFORMATION' });
    expect(byKey.get('cov-dip')).toMatchObject({ scope: 'SOURCE', kind: 'MENACE', lost: 12, cause: 'COLLECTE', gravity: 'A_REPARER',
      sources: [expect.objectContaining({ status: 'ERROR' })] });
    expect(review.evaluation.runExits).toEqual({ NON_REVUE: 12, FERMETURE_SOURCE: 12 });
    // Le marché France perd 24 offres sur 62, dont 12 masquées : anormal, à vérifier. Les sources cov-hm et cov-sw, qui ne
    // portent qu'une Maison chacune, ne sont pas redites ; leur ligne de photographie compte leurs offres servies.
    expect(byKey.get('FR')).toMatchObject({ scope: 'MARCHE', lost: 24, gravity: 'A_VERIFIER' });
    expect(review.evaluation.findings.filter(f => f.scope === 'SOURCE' && f.kind === 'PERTE')).toEqual([]);
    expect(review.evaluation.rows.find(r => r.scope === 'SOURCE' && r.key === 'cov-hm')).toMatchObject({ served: 18 });
    expect(review.masked.total).toBe(12);
    // Le bulletin part, puis la photographie porte l'alerte.
    expect(review.sent).toBe(true);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe('[Catwalks] Couverture : 1 à réparer, 2 à vérifier (1 pour information) · boucle candidat');
    const row = await prisma.coverageSnapshot.findFirstOrThrow({ where: { takenAt: review.at, scope: 'MAISON', key: hm.id } });
    expect(row).toMatchObject({ served: 18, reference: 30, cause: 'NON_REVUE', gravity: 'A_VERIFIER' });
  });

  it('une étape hors RUN qui masque part avec son bulletin (commandes `availability`, `probe-apply-links`)', async () => {
    const { hm, hmJobs } = await scene();
    const outcome = await withCoverageReview(prisma, () => hold(hmJobs.slice(0, 12), 'MISSED_BY_CREDIBLE_COLLECTION'));
    expect(outcome.sent).toBe(true);
    expect(outcome.review!.evaluation.findings.find(f => f.key === hm.id)).toMatchObject({ basis: 'RUN', lost: 12, gravity: 'A_VERIFIER' });
    expect(mails).toHaveLength(1);
  });

  it('un bulletin qui ne part pas ne marque aucune alerte : le RUN suivant la redit comme nouvelle', async () => {
    const { hm, hmJobs } = await scene();
    const before = await readCoverageBefore(prisma);
    await hold(hmJobs.slice(0, 12), 'MISSED_BY_CREDIBLE_COLLECTION');
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('quota', { status: 429 }));
    const failed = await runCoverageReview(prisma, { before });
    expect(failed.sent).toBe(false);
    expect(await prisma.coverageSnapshot.findFirstOrThrow({ where: { takenAt: failed.at, scope: 'MAISON', key: hm.id } }))
      .toMatchObject({ served: 18, cause: null, gravity: null });
  });
});

describe('la référence d’habitude, relue au RUN suivant', () => {
  it('suit la Maison absorbante, et reconnaît l’alerte en cours', async () => {
    const { hm, hmJobs } = await scene();
    const gmbh = await company('hm-gmbh', 'H & M Hennes & Mauritz GmbH', hm.id);
    // Avant le rattachement (R-143 §5), H&M était photographiée en deux sociétés : 22 + 8.
    for (const h of [72, 48, 24]) await snapshot(h, [['MAISON', hm.id, 22], ['MAISON', gmbh.id, 8]]);
    await hold(hmJobs.slice(0, 12), 'MISSED_BY_CREDIBLE_COLLECTION');
    const first = await runCoverageReview(prisma, {});
    expect(first.evaluation.findings.find(f => f.key === hm.id)).toMatchObject({ basis: 'LAST', reference: 30, lost: 12, cause: 'NON_REVUE', ongoing: false });
    const second = await runCoverageReview(prisma, { dryRun: true });
    expect(second.written).toBe(0);
    // La perte d'habitude reste (médiane 30) ; elle est « en cours », plus nouvelle.
    expect(second.evaluation.findings.find(f => f.key === hm.id)).toMatchObject({ ongoing: true });
  });

  it('une Maison qui ne sert plus rien et dont aucune sortie n’est connue est une perte inexpliquée', async () => {
    const ghost = await company('ghost', 'Maison disparue');
    for (const h of [72, 48, 24]) await snapshot(h, [['MAISON', ghost.id, 12, 'Maison disparue']]);
    const review = await runCoverageReview(prisma, { dryRun: true });
    expect(review.evaluation.findings).toEqual([expect.objectContaining({ key: ghost.id, label: 'Maison disparue', served: 0, lost: 12,
      cause: 'INEXPLIQUEE', gravity: 'A_REPARER' })]);
    expect(mails).toHaveLength(0);
  });
});

describe('une passe légère (R-143 §1) entre deux RUN', () => {
  it('une passe à 40 entre deux RUN à 100 ne fausse ni la référence ni l’alerte', async () => {
    const pl = await company('pl', 'Passe Légère');
    const jobs = [];
    for (let i = 0; i < 100; i++) jobs.push(await offer(pl.id, 'cov-pl', 30));
    for (const h of [72, 48, 24]) await snapshot(h, [['MAISON', pl.id, 100]]);
    // Le RUN : collecte en échec. Puis une passe légère, plus récente, OK, qui ne revoit que 40 offres.
    await prisma.sourceRun.create({ data: { runId, sourceKey: 'cov-pl', status: 'ERROR', jobs: 0, note: 'HTTP 406', ranAt: ago(0.8) } });
    const pass = randomUUID();
    await prisma.pipelineRun.create({ data: { id: pass, command: 'ingest-light', startedAt: ago(0.5) } });
    await prisma.sourceRun.create({ data: { runId: pass, sourceKey: 'cov-pl', status: 'OK', jobs: 40, previousJobs: 100, note: 'passe', ranAt: ago(0.4) } });
    await prisma.jobSource.updateMany({ where: { jobId: { in: jobs.slice(0, 40).map(j => j.id) } }, data: { lastSeenAt: ago(0.4) } });
    const review = await runCoverageReview(prisma, { runId, dryRun: true });
    // La référence reste celle des RUN (100) : aucune perte, la passe n'a rien retiré ni photographié.
    expect(review.evaluation.findings.filter(f => f.key === pl.id)).toEqual([]);
    expect(review.evaluation.rows.find(r => r.key === pl.id)).toMatchObject({ served: 100, reference: 100 });
    // La menace compte les 60 offres que ni le RUN ni la passe n'ont revues, et dit l'état du RUN, pas celui de la passe.
    expect(review.evaluation.findings.find(f => f.key === 'cov-pl')).toMatchObject({ kind: 'MENACE', lost: 60,
      sources: [expect.objectContaining({ status: 'ERROR', note: 'HTTP 406' })] });
  });
});
