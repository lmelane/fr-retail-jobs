import '../test/setup-integration.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { publicJobSql, publicJobWhere } from '@catwalks/db/availability';
import { publicationFixture } from '../test/publication-fixture.js';
import { ingestSyntheticFeed, qualifiedSource, releaseQualifiedSources, resolvedCompany, syntheticFeed, type SyntheticPosting } from '../test/ingestionFixture.js';
import { lightPassDeadline, lightPassHasIncidents, lightPassRefusal, runLightPass, LIGHT_PASS_BUDGET_MS, LIGHT_PASS_SOURCES } from './lightPass.js';
import { runAvailabilityReview } from './availability.js';
import { readAttestingCapture } from './attestingCapture.js';
import { sendHealthAlert } from './alert.js';
import { checkSourceHealth } from './health.js';
import { installLogger, OperationalLogger } from '../observability/logger.js';

// L'alerte e-mail du RUN (Brevo) : une passe ne doit jamais l'envoyer.
vi.mock('./alert.js', async importOriginal => ({ ...await importOriginal<typeof import('./alert.js')>(), sendHealthAlert: vi.fn(async () => true) }));

/**
 * R-143 §1 — la passe légère de découverte, par la vraie étape du RUN (`ingestOne` : accès, collecte scellée,
 * écriture, santé) ; seul le réseau amont est synthétique. Chaque témoin affirme d'abord que sa situation REMPLIT la
 * condition du défaut (une revue du RUN retiendrait l'offre manquée, un RUN est en cours…), puis que la passe ne le
 * commet pas. Avant ce lot, aucune passe n'existait : l'offre publiée à 10 h attendait le RUN de 16 h.
 */
const db = new PrismaClient();
const GENERATION = 'light-pass-witness';
const keys: string[] = [];

/** A certified single-brand Ashby source, as in the other synthetic ingestions. */
async function establishedSource(prefix: string) {
  const key = `${prefix}-${randomUUID().slice(0, 8)}`;
  keys.push(key);
  await qualifiedSource(db, key);
  await db.source.update({ where: { key }, data: { portalScope: 'SINGLE_BRAND' } });
  await resolvedCompany(db, key);
  return key;
}

/** The production transport of a pass: robots allowed, the source's native feed for everything else. */
function network(feed: readonly SyntheticPosting[], onFeed?: () => Promise<void>) {
  const body = syntheticFeed(feed);
  const transport = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
    await onFeed?.();
    return new Response(body, { headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', transport);
  return transport;
}
const feedCalls = (transport: ReturnType<typeof network>) =>
  transport.mock.calls.filter(([input]) => !String(input instanceof Request ? input.url : input).endsWith('/robots.txt')).length;

const served = async () => (await db.job.findMany({ where: publicJobWhere(), select: { externalId: true } })).map(job => job.externalId).sort();
const servedSql = async () => (await db.$queryRaw<{ externalId: string }[]>(Prisma.sql`SELECT j."externalId" FROM "Job" j WHERE ${publicJobSql(Prisma.sql`j`)}`))
  .map(row => row.externalId).sort();
/** A UTC instant of today at hh:mm, outside of any real clock. */
const at = (hh: number, mm = 0) => { const d = new Date(); d.setUTCHours(hh, mm, 0, 0); return d; };

async function wipe() {
  await db.pipelineEvent.deleteMany({ where: { run: { command: 'ingest-light' } } });
  await db.pipelineRun.deleteMany({ where: { command: { in: ['ingest-all', 'ingest-light'] }, events: { none: {} } } });
  await db.jobSource.deleteMany({});
  await db.job.deleteMany({});
}
beforeEach(async () => {
  await wipe();
  await db.$executeRaw`INSERT INTO "SearchGeneration"(version) VALUES (${GENERATION}) ON CONFLICT DO NOTHING`;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => {
  await wipe();
  await db.$executeRaw`DELETE FROM "SearchGeneration" WHERE version=${GENERATION}`;
  await releaseQualifiedSources(db);
  await db.$disconnect();
});

describe('R-143 §1 — une passe légère ne ferme rien et ne retient rien hors de sa lecture', () => {
  it('l’offre que la passe ne revoit pas reste ouverte et servie, une source hors de la passe aussi ; la nouvelle est servie', async () => {
    const key = await establishedSource('passe');
    // Deux collectes productives : la troisième, celle de la passe, a un passé et peut attester.
    await ingestSyntheticFeed(db, key, [{ id: 'a' }, { id: 'b' }, { id: 'manquee' }]);
    await ingestSyntheticFeed(db, key, [{ id: 'a' }, { id: 'b' }, { id: 'manquee' }]);
    // Une source ACTIVE hors de la passe, dont l'offre n'a pas été revue depuis 80 h : le plafond du RUN la retiendrait.
    const other = await establishedSource('hors-passe');
    const company = await resolvedCompany(db, other);
    const stale = new Date(Date.now() - 80 * 3_600_000);
    await db.job.create({ data: { companyId: company.id, externalId: 'ancienne', source: 'ASHBY', title: 'Conseiller de vente',
      url: `https://x/${other}/ancienne`, isActive: true, lastSeenAt: stale, sources: { create: [{ sourceKey: other, sourceTier: 'EMPLOYER_DIRECT',
        externalId: 'ancienne', url: `https://x/${other}/ancienne`, isActive: true, lastSeenAt: stale,
        ...publicationFixture({ sourceKey: other, externalId: 'ancienne', url: `https://x/${other}/ancienne`, title: 'Conseiller de vente' }) }] } } });
    expect(await served()).toEqual(['a', 'ancienne', 'b', 'manquee']);

    const transport = network([{ id: 'a' }, { id: 'b' }, { id: 'nouvelle', title: 'Visual Merchandiser' }]);
    const pass = await runLightPass(db, { runId: null, sources: [key], now: () => at(10) });
    expect(pass).toMatchObject({ refused: null, stoppedBy: null, collected: [key], ok: 1, failed: 0, created: 1 });
    expect(feedCalls(transport)).toBeGreaterThan(0);

    // Prémisse : la collecte de la passe est crédible et ne voit pas « manquee » ; une revue du RUN la retiendrait,
    // et retiendrait au plafond l'offre de la source hors passe. C'est exactement ce que la passe ne doit pas faire.
    const plan = await runAvailabilityReview(db, { dryRun: true });
    expect(plan.sources.find(source => source.sourceKey === key)).toMatchObject({ credible: true, missed: 1 });
    expect(plan.sources.find(source => source.sourceKey === other)).toMatchObject({ ceilingHeld: 1 });

    // La passe n'a rien fermé ni retenu : seules ses lectures ont écrit.
    expect(await db.jobSource.findFirstOrThrow({ where: { sourceKey: key, externalId: 'manquee' } }))
      .toMatchObject({ isActive: true, availabilityHold: null, publisherClosedAt: null });
    expect(await db.jobSource.findFirstOrThrow({ where: { sourceKey: other } })).toMatchObject({ isActive: true, availabilityHold: null });
    expect(await db.job.count({ where: { isActive: false } })).toBe(0);
    // La nouvelle offre est servie dès la fin de la passe, et mise en file d'indexation de la recherche.
    expect(await served()).toEqual(['a', 'ancienne', 'b', 'manquee', 'nouvelle']);
    expect(await servedSql()).toEqual(['a', 'ancienne', 'b', 'manquee', 'nouvelle']);
    const created = await db.job.findFirstOrThrow({ where: { externalId: 'nouvelle' } });
    expect(await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "SearchPending" WHERE version=${GENERATION} AND id=${created.id}`)
      .toEqual([{ n: 1n }]);
    // La santé de la source est tenue comme au RUN : une ligne SourceRun par collecte.
    expect(await db.sourceRun.findFirstOrThrow({ where: { sourceKey: key }, orderBy: { ranAt: 'desc' } })).toMatchObject({ jobs: 3 });
  });
});

describe('R-143 §1 — une passe à la lecture incomplète (coupée, tronquée) n’atteste rien', () => {
  it('capture tronquée : non attestante pour la revue du RUN, rien de fermé ni retenu, incident sans alerte', async () => {
    const key = await establishedSource('tronquee');
    const stock = Array.from({ length: 4 }, (_, i) => ({ id: `o${i}` }));
    await ingestSyntheticFeed(db, key, stock);
    await ingestSyntheticFeed(db, key, stock);
    // La passe ne lit que o0, puis une ligne sans intitulé : parcours réfuté, collecte tronquée — les mêmes faits
    // scellés qu'une passe arrêtée par son échéance douce (complete: false, truncated: true).
    network([{ id: 'o0' }, { id: 'sans-intitule', title: null }]);
    const pass = await runLightPass(db, { runId: null, sources: [key], now: () => at(4) });
    expect(pass).toMatchObject({ collected: [key], failed: 1 });
    // Prémisse : la dernière collecte de la source EST celle de la passe, scellée, et elle ne voit pas o1, o2, o3.
    const latest = await readAttestingCapture(db, key, new Date());
    expect(latest.ok).toBe(true);
    if (!latest.ok) return;
    expect(latest.capture.facts).toMatchObject({ truncated: true, complete: false, canAttestAbsence: false });
    expect(latest.capture.evidence.canonicalSet).not.toContain('o1');
    // La revue du RUN qui la lirait ne la juge pas crédible : elle ne retiendrait rien.
    const plan = await runAvailabilityReview(db, { dryRun: true });
    expect(plan.sources.find(source => source.sourceKey === key)).toMatchObject({ credible: false, held: 0, reason: 'collecte tronquée' });
    // Et la passe elle-même n'a rien fermé ni retenu.
    expect(await db.jobSource.count({ where: { sourceKey: key, isActive: true, availabilityHold: null } })).toBe(4);
    expect(await served()).toEqual(['o0', 'o1', 'o2', 'o3']);
    // Un incident de source : la commande finit COMPLETED_WITH_ERRORS (cli.ts), sans alerte e-mail.
    expect(lightPassHasIncidents(pass)).toBe(true);
    expect(lightPassHasIncidents({ failed: 0, timedOut: 0 })).toBe(false);
    expect(vi.mocked(sendHealthAlert)).not.toHaveBeenCalled();
  });
});

describe('R-143 §1 — une passe ne devient jamais la référence des gardes du RUN', () => {
  it('passe à 8 sur 20, puis RUN à 8 : la santé et l’attestation du RUN comparent à 20 (le RUN précédent), jamais à 8 (la passe)', async () => {
    const key = await establishedSource('reference');
    const listed = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
    // Deux collectes du RUN à 20 offres (hors passe : sans run de passe légère).
    await checkSourceHealth(db, [await ingestSyntheticFeed(db, key, listed(20))]);
    await checkSourceHealth(db, [await ingestSyntheticFeed(db, key, listed(20))]);
    // La passe de 04:00, sous son propre PipelineRun `ingest-light`, ne lit plus que 8 offres.
    const light = randomUUID();
    await db.pipelineRun.create({ data: { id: light, command: 'ingest-light' } });
    installLogger(new OperationalLogger({ runId: light, write: async () => undefined, delay: async () => undefined,
      persist: async record => { await db.pipelineEvent.create({ data: { ...record, payload: record.payload as Prisma.InputJsonValue } }); } }));
    try {
      network(listed(8));
      expect(await runLightPass(db, { runId: light, sources: [key], now: () => at(4) })).toMatchObject({ collected: [key] });
    } finally {
      installLogger(new OperationalLogger({ runId: `local-${randomUUID()}` }));
      vi.unstubAllGlobals();
      await db.pipelineRun.update({ where: { id: light }, data: { finishedAt: new Date(), status: 'COMPLETED' } });
    }
    // Prémisse : la passe a bien laissé sa ligne de santé et sa collecte, à 8, sous son run.
    expect(await db.sourceRun.findFirstOrThrow({ where: { sourceKey: key }, orderBy: { ranAt: 'desc' } })).toMatchObject({ runId: light, jobs: 8 });
    expect(await db.captureBatch.count({ where: { sourceKey: key, runId: light } })).toBeGreaterThan(0);

    // Le RUN de 16:00 lit aussi 8 offres. Sa référence est le RUN précédent (20), jamais la passe (8) : face à 8, la
    // chute serait invisible. Le flux synthétique annonce son total (8, après 20) : c'est une chute confirmée par
    // l'éditeur (D-484 §2), raisonnée contre 20 ; contre la passe, aucune chute n'aurait été vue du tout.
    const run = await ingestSyntheticFeed(db, key, listed(8));
    const health = await checkSourceHealth(db, [run]);
    expect(health.incidents).toMatchObject([{ source: key, previous: 20, jobs: 8 }]);
    const latest = await readAttestingCapture(db, key, new Date());
    expect(latest.ok && latest.capture.facts).toMatchObject({ previous: 20, published: 8, confirmedDrop: { previousDeclaredTotal: 20 } });
  });
});

describe('R-143 §1 — une passe légère ne tourne jamais pendant le RUN', () => {
  it('un RUN en cours : refusée avant toute requête', async () => {
    const key = await establishedSource('pendant-run');
    await db.pipelineRun.create({ data: { id: randomUUID(), command: 'ingest-all', startedAt: new Date(Date.now() - 60 * 60_000) } });
    const transport = network([{ id: 'x' }]);
    const batches = await db.captureBatch.count({ where: { sourceKey: key } });
    const pass = await runLightPass(db, { runId: null, sources: [key], now: () => at(20) });
    expect(pass).toMatchObject({ refused: 'RUN_IN_PROGRESS', collected: [], notCollected: [key] });
    expect(transport).not.toHaveBeenCalled();
    expect(await db.captureBatch.count({ where: { sourceKey: key } })).toBe(batches);
  });

  it('dans la fenêtre du RUN (15:30-18:30 UTC) : refusée, même sans RUN visible', async () => {
    const key = await establishedSource('fenetre');
    const transport = network([{ id: 'x' }]);
    for (const instant of [at(15, 30), at(16), at(17, 59), at(18, 29)]) {
      expect(await runLightPass(db, { runId: null, sources: [key], now: () => instant })).toMatchObject({ refused: 'RUN_WINDOW', collected: [] });
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it('un RUN qui commence pendant la passe : la passe s’arrête avant la source suivante', async () => {
    const first = await establishedSource('avant-run');
    const second = await establishedSource('apres-run');
    let started = false;
    network([{ id: 'x' }], async () => {
      if (started) return;
      started = true;
      await db.pipelineRun.create({ data: { id: randomUUID(), command: 'ingest-all' } });
    });
    const pass = await runLightPass(db, { runId: null, sources: [first, second], now: () => at(10) });
    expect(pass).toMatchObject({ refused: null, stoppedBy: 'RUN_IN_PROGRESS', collected: [first], notCollected: [second] });
  });

  it('un RUN resté « RUNNING » depuis plus de 12 h (conteneur tué) ne bloque plus ; une autre passe en cours, si', async () => {
    const key = await establishedSource('verrou');
    await db.pipelineRun.create({ data: { id: randomUUID(), command: 'ingest-all', startedAt: new Date(Date.now() - 13 * 3_600_000) } });
    network([{ id: 'x' }]);
    expect(await runLightPass(db, { runId: null, sources: [key], now: () => at(4) })).toMatchObject({ refused: null, collected: [key] });
    await db.pipelineRun.create({ data: { id: randomUUID(), command: 'ingest-light' } });
    expect(await runLightPass(db, { runId: null, sources: [key], now: () => at(4) })).toMatchObject({ refused: 'LIGHT_PASS_IN_PROGRESS' });
  });
});

describe('R-143 §1 — la fenêtre et le budget de la passe (pur)', () => {
  it('la passe finit au plus tard 45 minutes après son début, et jamais après 15:30 UTC', () => {
    expect(lightPassDeadline(at(10)) - at(10).getTime()).toBe(LIGHT_PASS_BUDGET_MS);
    expect(lightPassDeadline(at(22)) - at(22).getTime()).toBe(LIGHT_PASS_BUDGET_MS);
    expect(lightPassDeadline(at(15, 0))).toBe(at(15, 30).getTime());
  });
  it('refuse dans la fenêtre, pendant un RUN, pendant une autre passe ; accepte sinon', () => {
    expect(lightPassRefusal(at(15, 29), [])).toBeNull();
    expect(lightPassRefusal(at(18, 30), [])).toBeNull();
    expect(lightPassRefusal(at(16, 45), [])).toBe('RUN_WINDOW');
    expect(lightPassRefusal(at(20), [{ id: 'r', command: 'ingest-all', startedAt: at(16) }])).toBe('RUN_IN_PROGRESS');
    expect(lightPassRefusal(at(4), [{ id: 'p', command: 'ingest-light', startedAt: at(4) }])).toBe('LIGHT_PASS_IN_PROGRESS');
  });
  it('la liste relue est sans doublon et finit par la source la plus longue (lvmh)', () => {
    expect(new Set(LIGHT_PASS_SOURCES).size).toBe(LIGHT_PASS_SOURCES.length);
    expect(LIGHT_PASS_SOURCES.at(-1)).toBe('lvmh');
  });
});
