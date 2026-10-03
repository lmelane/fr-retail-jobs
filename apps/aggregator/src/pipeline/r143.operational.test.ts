import { publicationFixture } from '../test/publication-fixture.js';
import '../test/setup-integration.js';
import { attestSyntheticFeed, ingestSyntheticFeed, qualifiedSource, releaseQualifiedSources, resolvedCompany } from '../test/ingestionFixture.js';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { publicJobWhere, publicJobSql } from '@catwalks/db/availability';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { runRefresh } from './refresh.js';
import { runAvailabilityReview } from './availability.js';
import * as availabilityModule from './availability.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runApplyLinkProbe } from './applyLinkProbe.js';

/**
 * R-143 §2, §3 et la garde du zéro annoncé (D-513, 02/10/2026), de bout en bout : chaque preuve est une collecte réelle,
 * admise, scellée et achevée, d'un flux natif synthétique. Chaque scénario échoue sur la révision d'avant (279e2ec).
 */
const prisma = new PrismaClient();

async function wipe() {
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.company.deleteMany({});
  await prisma.sourceRun.deleteMany({});
}

type Rep = { sourceKey: string; ext: string; hoursAgo?: number; tier?: string; isActive?: boolean; publisherClosedAt?: Date | null };
/** An offer with one or more representations; `ext` is the native id a synthetic feed lists. */
async function offer(companyId: string, reps: Rep[]) {
  const seen = (h = 0) => new Date(Date.now() - h * 3_600_000);
  const [first] = reps;
  return prisma.job.create({ data: {
    companyId, externalId: first.ext, source: 'GENERIC_JSONLD', title: 'Conseiller de vente', url: `https://x/${first.sourceKey}/${first.ext}`,
    isActive: true, lastSeenAt: seen(first.hoursAgo),
    sources: { create: reps.map(rep => ({
      sourceKey: rep.sourceKey, sourceTier: rep.tier ?? 'ATS_OFFICIAL', externalId: rep.ext, url: `https://x/${rep.sourceKey}/${rep.ext}`,
      ...publicationFixture({ sourceKey: rep.sourceKey, externalId: rep.ext, url: `https://x/${rep.sourceKey}/${rep.ext}`, title: 'Conseiller de vente' }),
      isActive: rep.isActive ?? true, lastSeenAt: seen(rep.hoursAgo), publisherClosedAt: rep.publisherClosedAt ?? null,
    })) },
  } });
}
/** A qualified source whose portal owner is certified, so a re-observation is really written (as in publisher-follow). */
async function writableSource(key: string) {
  await qualifiedSource(prisma, key);
  await prisma.source.update({ where: { key }, data: { portalScope: 'SINGLE_BRAND' } });
  return resolvedCompany(prisma, key);
}
const served = async () => (await prisma.job.findMany({ where: publicJobWhere(), select: { id: true } })).map(job => job.id).sort();
const servedSql = async () => (await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT j.id FROM "Job" j WHERE ${publicJobSql(Prisma.sql`j`)}`)).map(row => row.id).sort();

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await releaseQualifiedSources(prisma);
  await prisma.$disconnect();
});

describe('garde du zéro annoncé — une source au stock significatif qui annonce 0 ne ferme rien', () => {
  it('12 offres, board annoncé vide et prouvé : rien n’est fermé, la source est une anomalie', async () => {
    const c = await resolvedCompany(prisma, 'zero-board');
    for (let i = 0; i < 12; i++) await offer(c.id, [{ sourceKey: 'zero-board', ext: `z${i}`, hoursAgo: 72 }]);
    await attestSyntheticFeed(prisma, 'zero-board', []);
    const refresh = await runRefresh(prisma);
    // Prémisse : sans la garde, le frein global laissait passer (12 < 50 fermetures) et tout fermait.
    expect(refresh.refused).toBe(false);
    expect(refresh.closedJobs).toBe(0);
    expect(refresh.anomalousSources).toEqual(['zero-board']);
    expect(await prisma.job.count({ where: { isActive: true } })).toBe(12);
  });

  it('une petite source (3 offres) qui annonce 0 ferme toujours ses offres', async () => {
    const c = await resolvedCompany(prisma, 'small-board');
    for (let i = 0; i < 3; i++) await offer(c.id, [{ sourceKey: 'small-board', ext: `s${i}`, hoursAgo: 72 }]);
    await attestSyntheticFeed(prisma, 'small-board', []);
    const refresh = await runRefresh(prisma);
    expect(refresh.anomalousSources).toEqual([]);
    expect(refresh.closedJobs).toBe(3);
  });
});

describe('R-143 §3 — la fermeture prouvée par la source officielle ferme l’offre ; sa republication la rouvre', () => {
  it('un job board qui liste encore l’offre ne la maintient plus en vie', async () => {
    const c = await resolvedCompany(prisma, 'estee');
    const job = await offer(c.id, [
      { sourceKey: 'estee', ext: 'o1', hoursAgo: 72, tier: 'EMPLOYER_DIRECT' },
      { sourceKey: 'board-secondaire', ext: 'w1', hoursAgo: 1, tier: 'SPECIALIST_JOBBOARD' },
    ]);
    // L'officiel prouve un board sans cette offre (petite source : la garde du zéro annoncé ne s'applique pas).
    await attestSyntheticFeed(prisma, 'estee', []);
    const refresh = await runRefresh(prisma);
    expect(refresh.authorityClosed).toBe(1);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ isActive: false });
    const official = await prisma.jobSource.findFirstOrThrow({ where: { sourceKey: 'estee' } });
    expect(official.publisherClosedAt).not.toBeNull();
    // Le job board la liste encore le lendemain : il ne la rouvre pas.
    await prisma.jobSource.updateMany({ where: { sourceKey: 'board-secondaire' }, data: { lastSeenAt: new Date() } });
    expect((await runRefresh(prisma)).reopened).toBe(0);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ isActive: false });

    // L'officiel la republie (ce que fait l'écrivain, `dedup/upsert.ts`, témoin suivant) : le refresh la rouvre.
    await prisma.jobSource.updateMany({ where: { sourceKey: 'estee' }, data: { isActive: true, publisherClosedAt: null, lastSeenAt: new Date() } });
    expect((await runRefresh(prisma)).reopened).toBe(1);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ isActive: true });
  });

  it('la source qui republie une représentation dont elle avait prouvé la fin efface cette preuve et rouvre l’offre', async () => {
    const c = await writableSource('lacoste');
    const job = await offer(c.id, [{ sourceKey: 'lacoste', ext: 'r1', hoursAgo: 72 }]);
    await attestSyntheticFeed(prisma, 'lacoste', [{ id: 'autre' }]);
    expect((await runRefresh(prisma)).closedJobs).toBe(1);
    expect((await prisma.jobSource.findFirstOrThrow({ where: { externalId: 'r1' } })).publisherClosedAt).not.toBeNull();
    await ingestSyntheticFeed(prisma, 'lacoste', [{ id: 'autre' }, { id: 'r1' }]);
    expect(await prisma.jobSource.findFirstOrThrow({ where: { externalId: 'r1' } })).toMatchObject({ isActive: true, publisherClosedAt: null });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ isActive: true });
  });

  it('le stock d’avant la règle : une fin officielle déjà prouvée ferme l’offre au refresh suivant', async () => {
    const c = await resolvedCompany(prisma, 'richemont-like');
    const job = await offer(c.id, [
      { sourceKey: 'agregateur', ext: 'a1', hoursAgo: 1, tier: 'AGGREGATOR' },
      { sourceKey: 'groupe-portail', ext: 'g1', hoursAgo: 90, tier: 'GROUP_OFFICIAL', isActive: false, publisherClosedAt: new Date(Date.now() - 80 * 3_600_000) },
    ]);
    const refresh = await runRefresh(prisma);
    expect(refresh.authorityClosed).toBe(1);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ isActive: false });
  });

  it('deux canaux officiels qui se contredisent (le cas Richemont) : l’offre reste ouverte, c’est une question au CEO', async () => {
    // Mesuré le 02/10 : `richemont-workday` (GROUP_OFFICIAL, site « Richemont ») a retiré 16 offres que `richemont`
    // (ATS_OFFICIAL, site « broadbean_external » du MÊME tenant Workday) publie encore.
    const c = await resolvedCompany(prisma, 'richemont-like');
    const job = await offer(c.id, [
      { sourceKey: 'richemont-like', ext: 'r1', hoursAgo: 1, tier: 'ATS_OFFICIAL' },
      { sourceKey: 'groupe-portail', ext: 'g1', hoursAgo: 90, tier: 'GROUP_OFFICIAL', isActive: false, publisherClosedAt: new Date(Date.now() - 80 * 3_600_000) },
    ]);
    expect((await runRefresh(prisma)).authorityClosed).toBe(0);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ isActive: true });
  });

  it('un retrait administratif (sans preuve de la source) ne ferme rien', async () => {
    const c = await resolvedCompany(prisma, 'portail-retire');
    const job = await offer(c.id, [
      { sourceKey: 'portail-retire', ext: 'p1', hoursAgo: 1, tier: 'ATS_OFFICIAL' },
      { sourceKey: 'groupe-retire', ext: 'g1', hoursAgo: 90, tier: 'GROUP_OFFICIAL', isActive: false, publisherClosedAt: null },
    ]);
    expect((await runRefresh(prisma)).authorityClosed).toBe(0);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ isActive: true });
  });
});

describe('R-143 §2 — une offre non reconfirmée sort de l’expérience sans être fermée, et y revient', () => {
  it('manquée par une collecte crédible : retenue, puis rendue quand la source la revoit', async () => {
    const c = await writableSource('lacoste');
    const [a, b, gone] = [await offer(c.id, [{ sourceKey: 'lacoste', ext: 'a', hoursAgo: 30 }]),
      await offer(c.id, [{ sourceKey: 'lacoste', ext: 'b', hoursAgo: 30 }]), await offer(c.id, [{ sourceKey: 'lacoste', ext: 'c', hoursAgo: 30 }])];
    await attestSyntheticFeed(prisma, 'lacoste', [{ id: 'a' }, { id: 'b' }]);
    // Prémisse : la représentation manquée est récente (30 h < 72 h) et le refresh ne la ferme pas (< 48 h).
    expect((await runRefresh(prisma)).closedJobs).toBe(0);
    expect(await served()).toEqual([a.id, b.id, gone.id].sort());

    const review = await runAvailabilityReview(prisma);
    expect(review.held).toBe(1);
    expect(await served()).toEqual([a.id, b.id].sort());
    expect(await servedSql()).toEqual([a.id, b.id].sort());
    // Jamais fermée.
    expect(await prisma.job.findUniqueOrThrow({ where: { id: gone.id } })).toMatchObject({ isActive: true });
    expect(await prisma.jobSource.findFirstOrThrow({ where: { externalId: 'c' } })).toMatchObject({ isActive: true, availabilityHold: 'NOT_RECONFIRMED' });

    // La source la revoit : la retenue tombe, l'offre revient.
    await ingestSyntheticFeed(prisma, 'lacoste', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(await prisma.jobSource.findFirstOrThrow({ where: { externalId: 'c' } })).toMatchObject({ availabilityHold: null });
    expect(await served()).toEqual([a.id, b.id, gone.id].sort());
  });

  it('une collecte qui manque plus de la moitié d’un stock significatif ne retient rien', async () => {
    const c = await resolvedCompany(prisma, 'dispo-garde');
    for (let i = 0; i < 12; i++) await offer(c.id, [{ sourceKey: 'dispo-garde', ext: `g${i}`, hoursAgo: 30 }]);
    await attestSyntheticFeed(prisma, 'dispo-garde', [{ id: 'g0' }, { id: 'g1' }]);
    const review = await runAvailabilityReview(prisma);
    expect(review.held).toBe(0);
    expect(review.sources.find(source => source.sourceKey === 'dispo-garde')).toMatchObject({ missed: 10, credible: false });
    expect(await prisma.job.count({ where: publicJobWhere() })).toBe(12);
  });

  it('le plafond : une source active qui n’a plus revu une représentation depuis 72 h la retient, sans rien fermer', async () => {
    await qualifiedSource(prisma, 'silencieuse');
    const c = await resolvedCompany(prisma, 'silencieuse');
    const fresh = await offer(c.id, [{ sourceKey: 'silencieuse', ext: 'f', hoursAgo: 47 }]);
    const old = await offer(c.id, [{ sourceKey: 'silencieuse', ext: 'o', hoursAgo: 73 }]);
    // Aucun délai n'est lu à la requête : avant la revue du RUN, les deux sont servies (un RUN arrêté ne retire rien).
    expect(await served()).toEqual([fresh.id, old.id].sort());
    expect(await servedSql()).toEqual([fresh.id, old.id].sort());
    const review = await runAvailabilityReview(prisma);
    expect(review.sources.find(source => source.sourceKey === 'silencieuse')).toMatchObject({ ceilingHeld: 1 });
    expect(await served()).toEqual([fresh.id]);
    expect(await servedSql()).toEqual([fresh.id]);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ isActive: true });
  });

  it('une source en pause DÉCIDÉE garde ses offres servies (D-485, D-493, D-506) ; une pause sans décision suit le plafond (D-520 §2)', async () => {
    await qualifiedSource(prisma, 'en-pause');
    const c = await resolvedCompany(prisma, 'en-pause');
    const old = await offer(c.id, [{ sourceKey: 'en-pause', ext: 'p', hoursAgo: 200 }]);
    // Le registre explicite est appliqué (une revue existe) : une pause sans décision (pas d'explication au registre)
    // suit le plafond, comme une source ACTIVE : l'offre non revue depuis 72 h sort.
    const reviewId = randomBytes(32).toString('hex');
    await prisma.sourceRegistryReview.create({ data: { id: reviewId, plan: {}, before: [], reviewer: 'test D-520' } });
    await prisma.source.update({ where: { key: 'en-pause' }, data: { status: 'PAUSED' } });
    const undecided = await runAvailabilityReview(prisma, { dryRun: true });
    expect(undecided.sources.find(source => source.sourceKey === 'en-pause')).toMatchObject({ status: 'PAUSED', ceilingHeld: 1 });
    // Pause posée par une décision, expliquée au registre : l'offre reste servie.
    await prisma.source.update({ where: { key: 'en-pause' }, data: { statusReviewId: reviewId, statusExplainedFor: 'PAUSED',
      statusIntention: 'COLLECTER', statusTrajectory: 'A_REPARER', statusBasis: 'DECISION', statusDecision: 'D-506 §1',
      statusReason: 'Pause décidée.', statusNextAction: 'Sonder le site.', statusReviewAt: new Date('2026-10-05T00:00:00Z') } });
    expect((await runAvailabilityReview(prisma)).held).toBe(0);
    expect(await served()).toEqual([old.id]);
    // La même pause, sans décision (fondement PREUVE) : masquée.
    await prisma.source.update({ where: { key: 'en-pause' }, data: { statusBasis: 'PREUVE', statusDecision: 'Aucune décision CEO' } });
    expect((await runAvailabilityReview(prisma)).held).toBe(1);
    expect(await served()).toEqual([]);
  });

  it('registre explicite NON appliqué : le plafond de 72 h épargne les sources en pause, pas les actives (audit r6, F3)', async () => {
    await qualifiedSource(prisma, 'pause-avant-registre');
    await qualifiedSource(prisma, 'active-avant-registre');
    const paused = await resolvedCompany(prisma, 'pause-avant-registre');
    const active = await resolvedCompany(prisma, 'active-avant-registre');
    const p = await offer(paused.id, [{ sourceKey: 'pause-avant-registre', ext: 'p', hoursAgo: 200 }]);
    const a = await offer(active.id, [{ sourceKey: 'active-avant-registre', ext: 'a', hoursAgo: 200 }]);
    await prisma.source.update({ where: { key: 'pause-avant-registre' }, data: { status: 'PAUSED' } });
    // Prémisse : aucune revue du registre n'est appliquée (la table est immuable entre fichiers : on la lit vide).
    vi.spyOn(prisma.sourceRegistryReview, 'count').mockResolvedValue(0);
    expect(await prisma.sourceRegistryReview.count()).toBe(0);
    const review = await runAvailabilityReview(prisma);
    expect(review.sources.find(source => source.sourceKey === 'pause-avant-registre')).toMatchObject({ status: 'PAUSED', ceilingHeld: 0 });
    expect(review.sources.find(source => source.sourceKey === 'active-avant-registre')).toMatchObject({ status: 'ACTIVE', ceilingHeld: 1 });
    expect(await served()).toEqual([p.id]);
    expect(a.id).not.toBe(p.id);
    vi.restoreAllMocks();
  });

  it('sans bulletin, les retenues de CE run tombent ; celles d’un run précédent restent (D-516 §2, audit r6)', async () => {
    await qualifiedSource(prisma, 'sans-bulletin');
    const c = await resolvedCompany(prisma, 'sans-bulletin');
    const earlier = await offer(c.id, [{ sourceKey: 'sans-bulletin', ext: 'avant', hoursAgo: 200 }]);
    expect((await runAvailabilityReview(prisma, { runId: 'run-precedent' })).held).toBe(1);
    const now = await offer(c.id, [{ sourceKey: 'sans-bulletin', ext: 'ce-run', hoursAgo: 200 }]);
    expect((await runAvailabilityReview(prisma, { runId: 'run-courant' })).held).toBe(1);
    expect(await prisma.jobSource.findMany({ where: { sourceKey: 'sans-bulletin' }, select: { externalId: true, availabilityEvidence: true }, orderBy: { externalId: 'asc' } }))
      .toMatchObject([{ externalId: 'avant', availabilityEvidence: { runId: 'run-precedent' } }, { externalId: 'ce-run', availabilityEvidence: { runId: 'run-courant' } }]);
    expect(await availabilityModule.releaseHoldsOfRun(prisma, 'run-courant')).toBe(1);
    expect(await served()).toEqual([now.id]);
    expect(earlier.id).not.toBe(now.id);
  });

  it('la commande `availability` sans bulletin remis (aucune clé Brevo) ne laisse aucune retenue (D-516 §2, audit r6)', async () => {
    await qualifiedSource(prisma, 'cli-sans-bulletin');
    const c = await resolvedCompany(prisma, 'cli-sans-bulletin');
    const stale = await offer(c.id, [{ sourceKey: 'cli-sans-bulletin', ext: 'x', hoursAgo: 200 }]);
    // Prémisse : la revue la retiendrait (plafond de 72 h).
    expect((await runAvailabilityReview(prisma, { dryRun: true })).sources.find(s => s.sourceKey === 'cli-sans-bulletin')).toMatchObject({ ceilingHeld: 1 });
    const env = { ...process.env } as Record<string, string | undefined>;
    for (const k of ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'PIPELINE_PAUSED', 'CATWALKS_RUNTIME_PROFILE']) delete env[k];
    const app = fileURLToPath(new URL('../../', import.meta.url));
    const cli = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'availability'], { cwd: app, env: env as NodeJS.ProcessEnv, encoding: 'utf8' });
    expect(cli.status).toBe(1);
    expect(cli.stdout + cli.stderr).toMatch(/availability\.holds_released_without_bulletin/);
    expect(await prisma.jobSource.count({ where: { sourceKey: 'cli-sans-bulletin', availabilityHold: { not: null } } })).toBe(0);
    expect(await served()).toContain(stale.id);
  });

  it('une seconde représentation confirmée garde l’offre servie', async () => {
    await qualifiedSource(prisma, 'double');
    const c = await resolvedCompany(prisma, 'double');
    const job = await offer(c.id, [{ sourceKey: 'double', ext: 'd', hoursAgo: 80 }, { sourceKey: 'double-board', ext: 'w', hoursAgo: 2, tier: 'SPECIALIST_JOBBOARD' }]);
    expect((await runAvailabilityReview(prisma)).held).toBe(1);
    expect(await served()).toEqual([job.id]);
  });
});

describe('R-143 §2 — la sonde : une page morte retient la représentation, une erreur technique jamais', () => {
  it('écrit APPLY_LINK_DEAD avec son motif, et rien sur une erreur technique (sonde sans périmètre d’accès : rien)', async () => {
    const c = await resolvedCompany(prisma, 'sonde');
    await offer(c.id, [{ sourceKey: 'sonde', ext: 'mort', hoursAgo: 30 }]);
    const target = (await prisma.jobSource.findFirstOrThrow({ where: { sourceKey: 'sonde' } }));
    // Sans décision d'accès revue pour cette source, la sonde ne lit rien et ne retient rien.
    const run = await runApplyLinkProbe(prisma, { targets: [{ jobSourceId: target.id, jobId: target.jobId!, sourceKey: 'sonde', url: target.url, lastSeenAt: target.lastSeenAt }],
      fetcher: async () => new Response('', { status: 404 }) });
    expect(run.byVerdict.NON_CONCLUSIVE).toBe(1);
    expect(run.held).toBe(0);
    expect(await prisma.jobSource.findFirstOrThrow({ where: { sourceKey: 'sonde' } })).toMatchObject({ availabilityHold: null });
  });

  it('dans le périmètre revu : 404 avec un témoin ouvert retient, 403 ne retient rien, la source qui revoit l’offre la rend', async () => {
    const c = await resolvedCompany(prisma, 'sonde2');
    const dead = await offer(c.id, [{ sourceKey: 'sonde2', ext: 'mort', hoursAgo: 30 }]);
    await offer(c.id, [{ sourceKey: 'sonde2', ext: 'bloque', hoursAgo: 31 }]);
    await offer(c.id, [{ sourceKey: 'sonde2', ext: 'vivante', hoursAgo: 2 }]);
    const scopes = [{ origin: 'https://x', path: { kind: 'PREFIX' as const, value: '/sonde2/' }, methods: ['GET' as const],
      query: { fixed: {}, variable: [] }, surface: 'PUBLIC_HTML_PAGE' as never }];
    const open = `<html><body><main><h1>Conseiller de vente</h1><p>${'Description du poste. '.repeat(20)}</p><a>Postuler</a></main></body></html>`;
    const run = await runApplyLinkProbe(prisma, { accessScopes: async () => scopes,
      fetcher: async url => url.endsWith('/mort') ? new Response('', { status: 404 }) : url.endsWith('/bloque') ? new Response('', { status: 403 })
        : new Response(open, { status: 200, headers: { 'content-type': 'text/html' } }) });
    expect(run.byVerdict).toMatchObject({ DEAD: 1, TECHNICAL: 1 });
    expect(run.held).toBe(1);
    const held = await prisma.jobSource.findFirstOrThrow({ where: { sourceKey: 'sonde2', externalId: 'mort' } });
    expect(held).toMatchObject({ isActive: true, availabilityHold: 'APPLY_LINK_DEAD' });
    expect(held.availabilityEvidence).toMatchObject({ reason: 'HTTP_404', witness: { verdict: 'OPEN' } });
    expect(await prisma.jobSource.findFirstOrThrow({ where: { sourceKey: 'sonde2', externalId: 'bloque' } })).toMatchObject({ availabilityHold: null });
    expect(await served()).not.toContain(dead.id);
    // Revue par sa source après la sonde : la retenue est dépassée, la revue du RUN la lève.
    await prisma.jobSource.update({ where: { id: held.id }, data: { lastSeenAt: new Date(Date.now() + 1000) } });
    expect((await runAvailabilityReview(prisma, { onlyKeys: [] })).released).toBe(1);
    expect(await served()).toContain(dead.id);
  });
});
