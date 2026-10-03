import '../test/setup-integration.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { publicJobSql, publicJobWhere } from '@catwalks/db/availability';
import { publicationFixture } from '../test/publication-fixture.js';
import { ingestSyntheticFeed, qualifiedSource, releaseQualifiedSources, resolvedCompany, syntheticFeed, type SyntheticPosting } from '../test/ingestionFixture.js';
import { lightPassDeadline, lightPassHasIncidents, lightPassRefusal, runLightPass, significantSources, LEFT_TO_RUN, LIGHT_PASS_BUDGET_MS } from './lightPass.js';
import { runAvailabilityReview } from './availability.js';
import { INCREMENTAL_READING_REASON, readAttestingCapture } from './attestingCapture.js';
import { sendHealthAlert } from './alert.js';
import { checkSourceHealth } from './health.js';
import { installLogger, OperationalLogger } from '../observability/logger.js';
import { readExtractionManifest } from '../capture/manifest.js';
import { buildHealthReport } from './healthReport.js';
import { ingestOne } from './ingestOrchestrator.js';
import { withIncrementalPass } from '../lib/incrementalReading.js';
import { readCoverageState } from '../coverage/coverageReading.js';
import { knownPostings } from './knownPostings.js';

// L'alerte e-mail du RUN (Brevo) : une passe ne doit jamais l'envoyer.
vi.mock('./alert.js', async importOriginal => ({ ...await importOriginal<typeof import('./alert.js')>(), sendHealthAlert: vi.fn(async () => true) }));

/**
 * R-143 §1, D-517 — la passe de découverte en LECTURE INCRÉMENTALE, par la vraie étape du RUN (`ingestOne` : accès,
 * collecte scellée et validée, écriture, santé) ; seul le réseau amont est synthétique. Chaque témoin affirme d'abord
 * que sa situation REMPLIT la condition du défaut (une revue du RUN retiendrait l'offre manquée, un RUN est en cours…),
 * puis que la passe ne le commet pas. Avant D-517, la passe relisait et réécrivait tout, et sa collecte était crédible.
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
/** Runs `work` under a real `ingest-light` PipelineRun and its logger, as the CLI does in production. */
async function underLightRun<T>(work: (runId: string) => Promise<T>): Promise<T> {
  const light = randomUUID();
  await db.pipelineRun.create({ data: { id: light, command: 'ingest-light' } });
  installLogger(new OperationalLogger({ runId: light, write: async () => undefined, delay: async () => undefined,
    persist: async record => { await db.pipelineEvent.create({ data: { ...record, payload: record.payload as Prisma.InputJsonValue } }); } }));
  try { return await work(light); } finally {
    installLogger(new OperationalLogger({ runId: `local-${randomUUID()}` }));
    vi.unstubAllGlobals();
    await db.pipelineRun.update({ where: { id: light }, data: { finishedAt: new Date(), status: 'COMPLETED' } });
  }
}
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

describe('D-517 — une lecture incrémentale ne lit, n’écrit et ne rend que le neuf ; elle ne ferme, ne retient et n’atteste rien', () => {
  it('l’offre absente de la liste reste servie, les connues ne sont pas réécrites, la nouvelle est servie', async () => {
    const key = await establishedSource('passe');
    // Deux collectes productives du RUN : la source a un passé, une collecte complète de la passe pourrait attester.
    await ingestSyntheticFeed(db, key, [{ id: 'a' }, { id: 'b' }, { id: 'manquee' }]);
    await ingestSyntheticFeed(db, key, [{ id: 'a' }, { id: 'b' }, { id: 'manquee' }]);
    await db.source.update({ where: { key }, data: { lastRunJobs: 3, lastRunStatus: 'OK' } });
    // Une source ACTIVE hors de la passe, dont l'offre n'a pas été revue depuis 80 h : le plafond du RUN la retiendrait.
    const other = await establishedSource('hors-passe');
    const company = await resolvedCompany(db, other);
    const stale = new Date(Date.now() - 80 * 3_600_000);
    await db.job.create({ data: { companyId: company.id, externalId: 'ancienne', source: 'ASHBY', title: 'Conseiller de vente',
      url: `https://x/${other}/ancienne`, isActive: true, lastSeenAt: stale, sources: { create: [{ sourceKey: other, sourceTier: 'EMPLOYER_DIRECT',
        externalId: 'ancienne', url: `https://x/${other}/ancienne`, isActive: true, lastSeenAt: stale,
        ...publicationFixture({ sourceKey: other, externalId: 'ancienne', url: `https://x/${other}/ancienne`, title: 'Conseiller de vente' }) }] } } });
    expect(await served()).toEqual(['a', 'ancienne', 'b', 'manquee']);
    const seenBefore = await db.jobSource.findFirstOrThrow({ where: { sourceKey: key, externalId: 'a' }, select: { lastSeenAt: true } });
    const missedBefore = await db.jobSource.findFirstOrThrow({ where: { sourceKey: key, externalId: 'manquee' }, select: { lastSeenAt: true } });
    // Audit r6 (F2) : « b » porte une retenue du plafond posée avant la passe ; la passe la voit listée.
    const heldAt = new Date(Date.now() - 60_000);
    await db.jobSource.updateMany({ where: { sourceKey: key, externalId: 'b' }, data: { availabilityHold: 'NOT_RECONFIRMED', availabilityHoldAt: heldAt,
      availabilityEvidence: { rule: 'CEILING_72H' }, lastSeenAt: new Date(heldAt.getTime() - 80 * 3_600_000) } });
    expect(await served()).toEqual(['a', 'ancienne', 'manquee']);

    const transport = network([{ id: 'a' }, { id: 'b' }, { id: 'nouvelle', title: 'Visual Merchandiser' }]);
    const pass = await runLightPass(db, { runId: null, sources: [key], now: () => at(10) });
    expect(pass).toMatchObject({ refused: null, stoppedBy: null, collected: [key], ok: 1, failed: 0, created: 1, qualificationDue: [] });
    expect(feedCalls(transport)).toBeGreaterThan(0);

    // La collecte de la passe est scellée incrémentale : elle ne rend que « nouvelle » et nomme les connues qu'elle a vues.
    const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: key, purpose: 'JOBS', attemptOrdinal: { not: null } }, orderBy: { attemptOrdinal: 'desc' }, include: { outcome: true } });
    expect(await db.sourceExtraction.findMany({ where: { batchId: batch.id }, select: { externalId: true } })).toEqual([{ externalId: 'nouvelle' }]);
    const manifest = await readExtractionManifest(db, batch.id);
    expect(manifest.metadata).toMatchObject({ complete: false, truncated: true, incremental: { knownSkipped: ['a', 'b'] } });
    // Elle est validée (rejeu exact sous l'ensemble scellé) : la chaîne de qualification du RUN continue.
    expect(await db.sourceValidation.findFirstOrThrow({ where: { captureBatchId: batch.id } })).toMatchObject({ verdict: 'VALIDATED' });

    // Prémisse : « manquee » n'est pas dans la lecture. La revue du RUN ne la juge pas crédible : rien n'est retenu.
    const plan = await runAvailabilityReview(db, { dryRun: true });
    expect(plan.sources.find(source => source.sourceKey === key)).toMatchObject({ credible: false, missed: 0, held: 0, reason: INCREMENTAL_READING_REASON });
    expect(plan.sources.find(source => source.sourceKey === other)).toMatchObject({ ceilingHeld: 1 });
    const latest = await readAttestingCapture(db, key, new Date());
    expect(latest).toMatchObject({ ok: false, captureBatchId: batch.id, reasons: [INCREMENTAL_READING_REASON] });

    // La passe n'a rien fermé ni retenu, et n'a pas relu les connues. Audit r6 (F2) : celles qu'elle a VUES listées sont
    // reconfirmées (preuve positive) — « a » revue à l'instant de la capture, la retenue de « b » tombée ; « manquee »,
    // absente de la liste, n'est ni revue ni retenue (une passe n'atteste aucune absence).
    expect(await db.jobSource.findFirstOrThrow({ where: { sourceKey: key, externalId: 'manquee' } }))
      .toMatchObject({ isActive: true, availabilityHold: null, publisherClosedAt: null, lastSeenAt: missedBefore.lastSeenAt });
    expect((await db.jobSource.findFirstOrThrow({ where: { sourceKey: key, externalId: 'a' }, select: { lastSeenAt: true } })).lastSeenAt)
      .toEqual(batch.startedAt);
    expect(batch.startedAt.getTime()).toBeGreaterThan(seenBefore.lastSeenAt.getTime());
    expect(await db.jobSource.findFirstOrThrow({ where: { sourceKey: key, externalId: 'b' } }))
      .toMatchObject({ availabilityHold: null, availabilityHoldAt: null, lastSeenAt: batch.startedAt });
    expect(await db.jobSource.findFirstOrThrow({ where: { sourceKey: other } })).toMatchObject({ isActive: true, availabilityHold: null });
    expect(await db.job.count({ where: { isActive: false } })).toBe(0);
    // La nouvelle offre est servie dès la fin de la passe, et mise en file d'indexation de la recherche.
    expect(await served()).toEqual(['a', 'ancienne', 'b', 'manquee', 'nouvelle']);
    expect(await servedSql()).toEqual(['a', 'ancienne', 'b', 'manquee', 'nouvelle']);
    expect(pass.collected).toEqual([key]);
    const created = await db.job.findFirstOrThrow({ where: { externalId: 'nouvelle' } });
    expect(await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "SearchPending" WHERE version=${GENERATION} AND id=${created.id}`)
      .toEqual([{ n: 1n }]);
    // Sa santé ne se compare à rien, n'atteste rien, et le résumé du catalogue reste celui du RUN.
    expect(await db.sourceRun.findFirstOrThrow({ where: { sourceKey: key }, orderBy: { ranAt: 'desc' } }))
      .toMatchObject({ status: 'OK', jobs: 1, fetched: 1, previousJobs: null, canAttestAbsence: false, complete: false });
    expect(await db.source.findUniqueOrThrow({ where: { key } })).toMatchObject({ lastRunJobs: 3, lastRunStatus: 'OK' });
  });

  it('rien de nouveau : la collecte est validée (« rien de neuf »), rien n’est écrit, la passe suivante peut encore lire', async () => {
    const key = await establishedSource('rien-de-neuf');
    await ingestSyntheticFeed(db, key, [{ id: 'a' }, { id: 'b' }]);
    network([{ id: 'a' }, { id: 'b' }]);
    expect(await runLightPass(db, { runId: null, sources: [key], now: () => at(4) })).toMatchObject({ collected: [key], ok: 1, failed: 0, created: 0 });
    const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: key, purpose: 'JOBS', attemptOrdinal: { not: null } }, orderBy: { attemptOrdinal: 'desc' } });
    expect(await db.sourceExtraction.count({ where: { batchId: batch.id } })).toBe(0);
    // Sans la règle « rien de neuf », ce lot vide serait REJETÉ (flux vide non prouvé) et retirerait la qualification.
    expect(await db.sourceValidation.findFirstOrThrow({ where: { captureBatchId: batch.id } }))
      .toMatchObject({ verdict: 'VALIDATED', report: expect.objectContaining({ incrementalNothingNew: 2 }) });
    // La passe de 10:00 lit encore la source, et y trouve la nouvelle.
    network([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(await runLightPass(db, { runId: null, sources: [key], now: () => at(10) })).toMatchObject({ collected: [key], ok: 1, created: 1 });
  });

  it('D-523 : une source vide lue par une passe : sa liste vide est validée sans être prouvée, rien n’est écrit, la passe suivante découvre sa première offre', async () => {
    const key = await establishedSource('vide');
    // Le dernier RUN a prouvé le zéro : c'est ce résumé que lit `provenEmptySources` pour la mettre dans les passes.
    await db.source.update({ where: { key }, data: { lastRunStatus: 'OK', lastRunJobs: 0 } });
    // Prémisse : la source ne sert rien et n'a rien de connu ; la liste lue sera vide.
    expect(await db.jobSource.count({ where: { sourceKey: key } })).toBe(0);
    network([]);
    expect(await runLightPass(db, { runId: null, sources: [key], now: () => at(4) })).toMatchObject({ collected: [key], ok: 1, failed: 0, created: 0 });
    const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: key, purpose: 'JOBS', attemptOrdinal: { not: null } }, orderBy: { attemptOrdinal: 'desc' } });
    // Avant D-523, ce lot vide était REJETÉ : la source perdait sa qualification et sortait des passes du jour.
    expect(await db.sourceValidation.findFirstOrThrow({ where: { captureBatchId: batch.id } }))
      .toMatchObject({ verdict: 'VALIDATED', report: expect.objectContaining({ observed: 0, nativeEmpty: false }) });
    network([{ id: 'premiere' }]);
    expect(await runLightPass(db, { runId: null, sources: [key], now: () => at(10) })).toMatchObject({ collected: [key], ok: 1, created: 1 });
    // Régression : une passe n'écrit jamais le résumé du RUN, ni sur une liste vide non prouvée, ni sur une offre trouvée.
    expect(await db.source.findUniqueOrThrow({ where: { key } })).toMatchObject({ lastRunStatus: 'OK', lastRunJobs: 0 });
  });

  it('une nouvelle seulement retenue (non listée) : la collecte est validée, rien n’est publié, la passe suivante la relit', async () => {
    const key = await establishedSource('retenue');
    await ingestSyntheticFeed(db, key, [{ id: 'a' }, { id: 'r-cachee', listed: false }]);
    // Prémisse : une sortie du RUN non publiée est connue (sa fiche n'est pas relue à chaque passe).
    const knownBefore = await knownPostings(db, key);
    expect(knownBefore.has('a') && knownBefore.has('r-cachee')).toBe(true);
    await underLightRun(async light => {
      network([{ id: 'a' }, { id: 'r-cachee', listed: false }, { id: 'p-cachee', listed: false }]);
      expect(await runLightPass(db, { runId: light, sources: [key], now: () => at(5) })).toMatchObject({ collected: [key], ok: 1, failed: 0, created: 0 });
    });
    const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: key, purpose: 'JOBS', attemptOrdinal: { not: null } }, orderBy: { attemptOrdinal: 'desc' } });
    expect(await db.sourceExtraction.findMany({ where: { batchId: batch.id }, select: { externalId: true } })).toEqual([{ externalId: 'p-cachee' }]);
    // Sans la tolérance « rien de neuf à publier », ce lot serait REJETÉ et la source sortirait des passes du jour.
    expect(await db.sourceValidation.findFirstOrThrow({ where: { captureBatchId: batch.id } }))
      .toMatchObject({ verdict: 'VALIDATED', report: expect.objectContaining({ held: 1, incrementalNothingNew: 2 }) });
    // La sortie retenue d'une passe n'est pas « connue » : la passe suivante relira sa fiche.
    expect([...await knownPostings(db, key)].sort()).toEqual([...knownBefore].sort());
    expect(knownBefore.has('p-cachee')).toBe(false);
  });

  it('une qualification qui expire dans l’heure : la source est laissée au RUN, sans requête', async () => {
    const key = await establishedSource('qualif');
    await ingestSyntheticFeed(db, key, [{ id: 'a' }]);
    // La validation courante a 23 h 30 : elle expirerait pendant la lecture, et la renouveler est une lecture complète.
    const current = await db.sourceValidation.findFirstOrThrow({ where: { sourceRevision: { sourceKey: key } }, orderBy: { sequence: 'desc' } });
    await db.$executeRaw`ALTER TABLE "CaptureBatch" DISABLE TRIGGER USER`;
    try { await db.$executeRaw`UPDATE "CaptureBatch" SET "startedAt" = now() - interval '23 hours 30 minutes' WHERE id = ${current.captureBatchId}`; }
    finally { await db.$executeRaw`ALTER TABLE "CaptureBatch" ENABLE TRIGGER USER`; }
    const transport = network([{ id: 'a' }, { id: 'b' }]);
    const pass = await runLightPass(db, { runId: null, sources: [key], now: () => at(10) });
    expect(pass).toMatchObject({ collected: [], qualificationDue: [{ source: key, code: 'CAPTURE_STALE' }] });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('D-517 — l’état d’une source se lit au RUN, jamais à une passe', () => {
  it('une passe en échec laisse sa ligne SourceRun, mais le résumé du catalogue reste celui du RUN', async () => {
    const key = await establishedSource('echec');
    await ingestSyntheticFeed(db, key, [{ id: 'a' }]);
    await db.source.update({ where: { key }, data: { lastRunJobs: 1, lastRunStatus: 'OK' } });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
      return new Response('upstream down', { status: 500 });
    }));
    const pass = await runLightPass(db, { runId: null, sources: [key], now: () => at(22) });
    // Prémisse : la passe a bien échoué sur cette source, et l'a inscrit.
    expect(pass.failed + pass.timedOut).toBe(1);
    expect(await db.sourceRun.findFirstOrThrow({ where: { sourceKey: key }, orderBy: { ranAt: 'desc' } })).toMatchObject({ status: 'BROKEN', jobs: 0, canAttestAbsence: false });
    expect(await db.source.findUniqueOrThrow({ where: { key } })).toMatchObject({ lastRunJobs: 1, lastRunStatus: 'OK' });
  });

  it('une source coupée par l’échéance de la passe : ligne TIMEOUT, résumé du catalogue inchangé', async () => {
    const key = await establishedSource('coupee');
    await ingestSyntheticFeed(db, key, [{ id: 'a' }]);
    await db.source.update({ where: { key }, data: { lastRunJobs: 1, lastRunStatus: 'OK' } });
    // Un éditeur qui ne répond plus : seule l'échéance arrête la lecture.
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === '/robots.txt') return Promise.resolve(new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } }));
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    }));
    const result = { total: 1, ok: 0, failed: 0, timedOut: 0, failures: [], incidents: [], issues: [] };
    await withIncrementalPass(() => ingestOne(db, key, result, 1_500));
    // Prémisse : la source est bien passée par la coupure (le chemin d'échec de `ingestOne`).
    expect(result.timedOut).toBe(1);
    expect(await db.sourceRun.findFirstOrThrow({ where: { sourceKey: key }, orderBy: { ranAt: 'desc' } })).toMatchObject({ status: 'TIMEOUT', jobs: 0 });
    expect(await db.source.findUniqueOrThrow({ where: { key } })).toMatchObject({ lastRunJobs: 1, lastRunStatus: 'OK' });
  });

  it('l’alerte de couverture garde la qualification du RUN pour référence, jamais celle d’une passe sans rien de neuf', async () => {
    const key = await establishedSource('couverture');
    const stock = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}` }));
    await ingestSyntheticFeed(db, key, stock);
    // La passe de 21:00, sous son propre PipelineRun `ingest-light`, ne voit que les 12 connues.
    const light = randomUUID();
    await db.pipelineRun.create({ data: { id: light, command: 'ingest-light' } });
    installLogger(new OperationalLogger({ runId: light, write: async () => undefined, delay: async () => undefined,
      persist: async record => { await db.pipelineEvent.create({ data: { ...record, payload: record.payload as Prisma.InputJsonValue } }); } }));
    try {
      network(stock);
      expect(await runLightPass(db, { runId: light, sources: [key], now: () => at(21) })).toMatchObject({ collected: [key], created: 0 });
    } finally {
      installLogger(new OperationalLogger({ runId: `local-${randomUUID()}` }));
      vi.unstubAllGlobals();
      await db.pipelineRun.update({ where: { id: light }, data: { finishedAt: new Date(), status: 'COMPLETED' } });
    }
    // Prémisse : la dernière validation de la source est celle de la passe, qui ne qualifie rien (rien de neuf).
    const latest = await db.sourceValidation.findFirstOrThrow({ where: { captureBatch: { sourceKey: key } }, orderBy: { sequence: 'desc' }, include: { captureBatch: true } });
    expect(latest).toMatchObject({ verdict: 'VALIDATED', report: expect.objectContaining({ qualified: 0 }), captureBatch: { runId: light } });
    const { knownSources } = await readCoverageState(db, { at: new Date(), horizons: {} });
    expect(knownSources.find(source => source.sourceKey === key)).toMatchObject({ qualified: 12 });
  });

  it('le rapport de santé lit la dernière ligne du RUN, pas celle de la passe qui a suivi', async () => {
    const key = await establishedSource('rapport');
    await ingestSyntheticFeed(db, key, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const light = randomUUID();
    await db.pipelineRun.create({ data: { id: light, command: 'ingest-light', finishedAt: new Date(), status: 'COMPLETED' } });
    await db.sourceRun.create({ data: { sourceKey: key, status: 'OK', jobs: 3, fetched: 3, accepted: 3, canAttestAbsence: true, complete: true, ranAt: new Date(Date.now() - 60_000) } });
    await db.sourceRun.create({ data: { sourceKey: key, runId: light, status: 'OK', jobs: 1, fetched: 1, accepted: 1, canAttestAbsence: false, complete: false, ranAt: new Date() } });
    const report = await buildHealthReport(db);
    const row = report.sources.find(source => source.sourceKey === key);
    expect(row).toMatchObject({ fetched: 3, canAttestAbsence: true, complete: true });
  });
});

describe('D-517 — une ligne illisible dans une lecture incrémentale : nommée, tolérée comme au RUN, rien d’attesté ni de retenu', () => {
  it('lecture avec une ligne rejetée : validée sur la liste lue, la revue du RUN ne la juge pas crédible, rien de fermé ni retenu, aucune alerte', async () => {
    const key = await establishedSource('tronquee');
    const stock = Array.from({ length: 4 }, (_, i) => ({ id: `o${i}` }));
    await ingestSyntheticFeed(db, key, stock);
    await ingestSyntheticFeed(db, key, stock);
    // La passe ne voit que o0 (connue), puis une ligne sans intitulé : une ligne illisible, nommée dans la preuve.
    network([{ id: 'o0' }, { id: 'sans-intitule', title: null }]);
    const pass = await runLightPass(db, { runId: null, sources: [key], now: () => at(4) });
    expect(pass).toMatchObject({ collected: [key], ok: 1, created: 0 });
    // Prémisse : la dernière collecte de la source EST celle de la passe, scellée, et elle ne voit pas o1, o2, o3.
    const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: key, purpose: 'JOBS', attemptOrdinal: { not: null } }, orderBy: { attemptOrdinal: 'desc' } });
    expect((await readExtractionManifest(db, batch.id)).metadata).toMatchObject({ incremental: { knownSkipped: ['o0'] },
      rejectedRows: [expect.objectContaining({ canonicalId: 'sans-intitule' })] });
    // La tolérance des lignes illisibles se calcule sur la liste lue (comme au RUN), pas sur le seul neuf (zéro ici).
    expect(await db.sourceValidation.findFirstOrThrow({ where: { captureBatchId: batch.id } }))
      .toMatchObject({ verdict: 'VALIDATED', report: expect.objectContaining({ incrementalKnown: 1, inputUnqualified: 1 }) });
    // Elle n'atteste rien, et la revue du RUN qui la lirait ne retiendrait rien.
    expect(await readAttestingCapture(db, key, new Date())).toMatchObject({ ok: false, captureBatchId: batch.id, reasons: [INCREMENTAL_READING_REASON] });
    const plan = await runAvailabilityReview(db, { dryRun: true });
    expect(plan.sources.find(source => source.sourceKey === key)).toMatchObject({ credible: false, held: 0, missed: 0 });
    expect(await db.jobSource.count({ where: { sourceKey: key, isActive: true, availabilityHold: null } })).toBe(4);
    expect(await served()).toEqual(['o0', 'o1', 'o2', 'o3']);
    // Aucune alerte e-mail ; un incident de source ferait finir la commande COMPLETED_WITH_ERRORS (cli.ts).
    expect(lightPassHasIncidents({ failed: 1, timedOut: 0 })).toBe(true);
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
    // La passe de 04:00, sous son propre PipelineRun `ingest-light`, ne voit plus que 8 offres.
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
    // Prémisse : la passe a bien laissé sa ligne de santé et sa collecte sous son run (lecture incrémentale : rien de
    // neuf parmi les 8, toutes connues).
    expect(await db.sourceRun.findFirstOrThrow({ where: { sourceKey: key }, orderBy: { ranAt: 'desc' } })).toMatchObject({ runId: light, jobs: 0, canAttestAbsence: false });
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
    const pass = await runLightPass(db, { runId: null, sources: [first, second], now: () => at(10), concurrency: 1 });
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
  it('la passe finit au plus tard 90 minutes après son début, et jamais après 15:30 UTC', () => {
    expect(lightPassDeadline(at(10)) - at(10).getTime()).toBe(LIGHT_PASS_BUDGET_MS);
    expect(lightPassDeadline(at(22)) - at(22).getTime()).toBe(LIGHT_PASS_BUDGET_MS);
    expect(lightPassDeadline(at(15, 0))).toBe(at(15, 30).getTime());
    expect(lightPassDeadline(at(14, 30))).toBe(at(15, 30).getTime());
  });
  it('refuse dans la fenêtre, pendant un RUN, pendant une autre passe ; accepte sinon', () => {
    expect(lightPassRefusal(at(15, 29), [])).toBeNull();
    expect(lightPassRefusal(at(18, 30), [])).toBeNull();
    expect(lightPassRefusal(at(16, 45), [])).toBe('RUN_WINDOW');
    expect(lightPassRefusal(at(20), [{ id: 'r', command: 'ingest-all', startedAt: at(16) }])).toBe('RUN_IN_PROGRESS');
    expect(lightPassRefusal(at(4), [{ id: 'p', command: 'ingest-light', startedAt: at(4) }])).toBe('LIGHT_PASS_IN_PROGRESS');
  });

});

describe('D-517 — la sélection par l’importance pour le candidat (toute source qui a du neuf), pas par le coût', () => {
  /** `n` publications vues pour la première fois aux instants `hoursAgo` (le flux d'une source). */
  async function seen(key: string, hoursAgo: readonly number[]) {
    const company = await resolvedCompany(db, key);
    for (const [i, h] of hoursAgo.entries()) {
      const when = new Date(Date.now() - h * 3_600_000);
      const id = `${key}-${i}`;
      await db.job.create({ data: { companyId: company.id, externalId: id, source: 'ASHBY', title: 'Conseiller de vente', url: `https://x/${id}`,
        isActive: true, firstSeenAt: when, lastSeenAt: when, sources: { create: [{ sourceKey: key, sourceTier: 'EMPLOYER_DIRECT', externalId: id,
          url: `https://x/${id}`, isActive: true, firstSeenAt: when, lastSeenAt: when,
          ...publicationFixture({ sourceKey: key, externalId: id, url: `https://x/${id}`, title: 'Conseiller de vente' }) }] } } });
    }
  }
  const days = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i * 24);

  it('toute source qui a fait paraître une nouvelle publication dans la semaine est retenue, de la plus productive à la moins productive ; le stock d’une source nouvelle ne compte pas', async () => {
    const busy = await establishedSource('volume');      // un stock ancien, puis 14 nouvelles en 7 jours
    await seen(busy, [400, ...days(14).map(h => h / 2 + 1)]);
    const calm = await establishedSource('luxe-calme');   // un stock ancien, puis 2 nouvelles en 7 jours (Patek, Mulberry…)
    await seen(calm, [400, 30, 100]);
    const mute = await establishedSource('muette');      // un stock ancien, rien de nouveau depuis 8 jours
    await seen(mute, [400, 200]);
    const loaded = await establishedSource('chargee');   // enregistrée il y a 3 jours : 40 en stock, rien de nouveau depuis
    await seen(loaded, Array(40).fill(72));
    const fresh = await establishedSource('enregistree'); // enregistrée il y a 50 h : 30 en stock, puis 5 nouvelles le lendemain
    await seen(fresh, [...Array(30).fill(50), 20, 18, 16, 14, 12]);
    const today = await establishedSource('du-jour');     // enregistrée il y a 20 h : pas encore un jour de flux
    await seen(today, [...Array(30).fill(20), 5]);
    const ours = new Set([busy, calm, mute, loaded, fresh, today]);
    const selected = (await significantSources(db)).filter(source => ours.has(source.key));
    // Prémisse : le stock des sources nouvelles est dans la fenêtre de 7 jours, et bien plus gros que leur flux.
    expect(await db.jobSource.count({ where: { sourceKey: loaded, firstSeenAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } })).toBe(40);
    expect(selected.map(source => source.key)).toEqual([fresh, busy, calm]);
    expect(selected.find(source => source.key === calm)).toMatchObject({ newPostings: 2 });
  });

  it('une source à amorçage anti-robot (Ralph Lauren) reste au RUN tant que D-483 et D-516 jugent ses collectes', async () => {
    expect(LEFT_TO_RUN.has('ralph-lauren-avature')).toBe(true);
    const key = await establishedSource('amorcage');
    await seen(key, [400, ...days(7, 1)]);
    // Prémisse : la source a du neuf, elle est retenue sans la garde.
    expect((await significantSources(db, new Date(), new Set())).map(source => source.key)).toContain(key);
    expect((await significantSources(db, new Date(), new Set([key]))).map(source => source.key)).not.toContain(key);
  });

  it('D-523 : une source au zéro prouvé (dernier RUN sain et vide) est lue à chaque passe ; un zéro non prouvé reste au RUN', async () => {
    const vide = await establishedSource('zero-prouve');
    const doute = await establishedSource('zero-doute');
    await db.source.update({ where: { key: vide }, data: { lastRunStatus: 'OK', lastRunJobs: 0 } });
    await db.source.update({ where: { key: doute }, data: { lastRunStatus: 'BROKEN', lastRunJobs: 0 } });
    // Prémisse : aucune publication nouvelle sur 7 jours ; la règle de nouveauté seule ne les retiendrait pas.
    expect(await db.jobSource.count({ where: { sourceKey: { in: [vide, doute] } } })).toBe(0);
    const selected = await significantSources(db);
    expect(selected.find(source => source.key === vide)).toMatchObject({ newPostings: 0, perDay: 0 });
    expect(selected.map(source => source.key)).not.toContain(doute);
    // L'intention fait foi : en pause, la source vide n'est plus lue.
    await db.source.update({ where: { key: vide }, data: { status: 'PAUSED' } });
    expect((await significantSources(db)).map(source => source.key)).not.toContain(vide);
  });

  it('une source en pause n’est jamais lue, même productive', async () => {
    const paused = await establishedSource('pause');
    await seen(paused, [400, ...days(10, 1)]);
    expect((await significantSources(db)).map(source => source.key)).toContain(paused);
    await db.source.update({ where: { key: paused }, data: { status: 'PAUSED' } });
    expect((await significantSources(db)).map(source => source.key)).not.toContain(paused);
  });
});
