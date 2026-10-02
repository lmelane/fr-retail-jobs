import '../test/setup-integration.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { qualifiedSource, releaseQualifiedSources, resolvedCompany, syntheticFeed, type SyntheticPosting } from '../test/ingestionFixture.js';
import { installLogger, OperationalLogger } from '../observability/logger.js';
import { ingestOne, type OrchestratorResult } from './ingestOrchestrator.js';
import { withIncrementalPass } from '../lib/incrementalReading.js';
import { readSourceStatesReport, reconcileSourceStates, recordVerification } from './sourceStateStore.js';
import { verifySource } from './verifySource.js';
import { stateReportText } from './sourceStateReport.js';

/**
 * D-520 — l'état opérationnel est écrit après chaque collecte, par la vraie étape du RUN (`ingestOne`), et lu sans
 * écriture. Seul le réseau amont est synthétique. Avant D-520, aucune collecte n'écrivait d'état : chaque témoin
 * ci-dessous lit une ligne `SourceOperationalState` qui n'existait pas.
 */
const db = new PrismaClient();
const keys: string[] = [];

async function establishedSource(prefix: string) {
  const key = `${prefix}-${randomUUID().slice(0, 8)}`;
  keys.push(key);
  await qualifiedSource(db, key);
  await db.source.update({ where: { key }, data: { portalScope: 'SINGLE_BRAND' } });
  await resolvedCompany(db, key);
  return key;
}

/** Robots allowed; the feed answers `status` (200 by default). */
function network(feed: readonly SyntheticPosting[], status = 200) {
  const body = syntheticFeed(feed);
  const transport = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
    return status === 200 ? new Response(body, { headers: { 'content-type': 'application/json' } })
      : new Response('upstream unavailable', { status, headers: { 'content-type': 'text/plain' } });
  });
  vi.stubGlobal('fetch', transport);
  return transport;
}

/** Runs `work` under a real PipelineRun and its logger, as the CLI does. */
async function underRun<T>(command: string, work: (runId: string) => Promise<T>): Promise<T> {
  const id = randomUUID();
  await db.pipelineRun.create({ data: { id, command } });
  installLogger(new OperationalLogger({ runId: id, write: async () => undefined, delay: async () => undefined,
    persist: async record => { await db.pipelineEvent.create({ data: { ...record, payload: record.payload as Prisma.InputJsonValue } }); } }));
  try { return await work(id); } finally {
    installLogger(new OperationalLogger({ runId: `local-${randomUUID()}` }));
    vi.unstubAllGlobals();
    await db.pipelineRun.update({ where: { id }, data: { finishedAt: new Date(), status: 'COMPLETED' } });
  }
}
const fresh = (): OrchestratorResult => ({ total: 1, ok: 0, failed: 0, timedOut: 0, failures: [], incidents: [], issues: [] });
const at = (hh: number, mm = 0) => { const d = new Date(); d.setUTCHours(hh, mm, 0, 0); return d; };
const stateOf = (key: string) => db.sourceOperationalState.findUnique({ where: { sourceKey: key } });

async function wipe() {
  await db.sourceOperationalState.deleteMany({ where: { sourceKey: { in: keys } } });
  await db.pipelineEvent.deleteMany({ where: { run: { command: { in: ['ingest-all', 'ingest-light', 'verifier-source'] } } } });
  await db.pipelineRun.deleteMany({ where: { command: { in: ['ingest-all', 'ingest-light', 'verifier-source'] } } });
  await db.jobSource.deleteMany({});
  await db.job.deleteMany({});
}
beforeEach(wipe);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => {
  await wipe();
  await db.sourceOperationalState.deleteMany({});
  await releaseQualifiedSources(db);
  await db.$disconnect();
});

describe('D-520 — l’état est écrit après chaque collecte du RUN', () => {
  it('une collecte réussie écrit NORMALE, une collecte en échec écrit sa cause classée, et la suivante réussie la lève', async () => {
    const key = await establishedSource('etat-run');
    expect(await stateOf(key)).toBeNull();

    network([{ id: 'a' }, { id: 'b' }]);
    const ok = fresh();
    await underRun('ingest-all', () => ingestOne(db, key, ok));
    expect(ok.states?.map(s => [s.sourceKey, s.state, s.lastCollectionKind])).toEqual([[key, 'NORMALE', 'RUN']]);
    expect(await stateOf(key)).toMatchObject({ state: 'NORMALE', cause: null, trajectory: null, lastCollectionKind: 'RUN' });

    network([], 503);
    const failed = fresh();
    await underRun('ingest-all', () => ingestOne(db, key, failed));
    // Prémisse : la collecte a bien échoué (sinon le témoin ne teste rien).
    expect(failed.issues?.length).toBeGreaterThan(0);
    const row = await stateOf(key);
    expect(row?.state).not.toBe('NORMALE');
    expect(row?.cause).not.toBe('NON_CLASSEE');
    expect(row?.trajectory).toBeTruthy();
    expect(row?.missing).toBeTruthy();
    expect(row?.codes.length).toBeGreaterThan(0);

    network([{ id: 'a' }, { id: 'b' }]);
    await underRun('ingest-all', () => ingestOne(db, key, fresh()));
    expect(await stateOf(key)).toMatchObject({ state: 'NORMALE', cause: null });
  });

  it('une passe incrémentale écrit une collecte PASSE', async () => {
    const key = await establishedSource('etat-passe');
    network([{ id: 'a' }]);
    await underRun('ingest-light', () => withIncrementalPass(() => ingestOne(db, key, fresh())));
    expect(await stateOf(key)).toMatchObject({ state: 'NORMALE', lastCollectionKind: 'PASSE' });
  });
});

describe('D-520 §4 — la vérification ciblée', () => {
  it('refusée dans la fenêtre du RUN : rien n’est collecté ; hors fenêtre, l’état est écrit tout de suite', async () => {
    const key = await establishedSource('etat-verif');
    const transport = network([{ id: 'a' }]);
    const refused = await underRun('verifier-source', runId => verifySource(db, key, { runId, now: at(16) }));
    expect(refused).toMatchObject({ refused: 'RUN_WINDOW', after: null, ok: false });
    expect(transport).not.toHaveBeenCalled();
    expect(await stateOf(key)).toBeNull();

    network([{ id: 'a' }]);
    const verified = await underRun('verifier-source', runId => verifySource(db, key, { runId, now: at(10) }));
    expect(verified).toMatchObject({ refused: null, ok: true, after: { state: 'NORMALE', lastCollectionKind: 'VERIFICATION' } });
    expect(await stateOf(key)).toMatchObject({ state: 'NORMALE', lastCollectionKind: 'VERIFICATION' });
  });

  it('refusée pendant un RUN en cours', async () => {
    const key = await establishedSource('etat-verif-run');
    const transport = network([{ id: 'a' }]);
    await db.pipelineRun.create({ data: { id: randomUUID(), command: 'ingest-all' } });
    const refused = await underRun('verifier-source', runId => verifySource(db, key, { runId, now: at(10) }));
    expect(refused.refused).toBe('RUN_IN_PROGRESS');
    expect(transport).not.toHaveBeenCalled();
  });

  it('`ingest --source` en échec écrit aussi l’état de la source', async () => {
    const key = await establishedSource('etat-ingest');
    const state = await recordVerification(db, key, { error: Object.assign(new Error('HTTP 503 for https://x'), { name: 'HttpStatusError' }) });
    expect(state).toMatchObject({ state: 'EN_ATTENTE', cause: 'INDISPONIBILITE_PASSAGERE', lastCollectionKind: 'VERIFICATION' });
    expect(await stateOf(key)).toMatchObject({ state: 'EN_ATTENTE', cause: 'INDISPONIBILITE_PASSAGERE' });
  });
});

describe('D-520 — la réconciliation de fin de RUN et la lecture', () => {
  it('une source active non collectée devient NON_COLLECTEE ; une pause sans motif est MOTIF_ABSENT ; un RUN ciblé ne touche pas les autres', async () => {
    const collected = await establishedSource('etat-collectee');
    const forgotten = await establishedSource('etat-oubliee');
    const paused = await establishedSource('etat-pause');
    await db.source.update({ where: { key: paused }, data: { status: 'PAUSED', note: null } });
    network([{ id: 'a' }]);
    await underRun('ingest-all', () => ingestOne(db, collected, fresh()));
    // Prémisse : la source oubliée avait un état normal avant ce RUN.
    await recordVerification(db, forgotten, { issues: [], stats: [] });
    expect(await stateOf(forgotten)).toMatchObject({ state: 'NORMALE' });

    const targeted = await reconcileSourceStates(db, { collected: new Set([collected]), partial: true });
    expect(targeted.find(s => s.sourceKey === forgotten)).toMatchObject({ state: 'NORMALE' });

    const states = await reconcileSourceStates(db, { collected: new Set([collected]) });
    expect(states.find(s => s.sourceKey === collected)).toMatchObject({ state: 'NORMALE' });
    expect(states.find(s => s.sourceKey === forgotten)).toMatchObject({ state: 'BLOQUEE', cause: 'NON_COLLECTEE', trajectory: 'A_REPARER' });
    expect(states.find(s => s.sourceKey === paused)).toMatchObject({ state: 'EN_PAUSE', cause: 'MOTIF_ABSENT', trajectory: 'REVUE_HUMAINE' });
    expect(await stateOf(forgotten)).toMatchObject({ cause: 'NON_COLLECTEE' });

    await db.source.update({ where: { key: paused }, data: { note: 'D-516 : pause décidée' } });
    const report = await readSourceStatesReport(db);
    expect(report.sources.find(s => s.sourceKey === paused)).toMatchObject({ state: 'EN_PAUSE', cause: 'PAUSE_DECIDEE', decision: 'D-516' });
    expect(report.sources.find(s => s.sourceKey === forgotten)).toMatchObject({ cause: 'NON_COLLECTEE' });
    const text = stateReportText(report).join('\n');
    expect(text).toContain(`${forgotten} (${forgotten}) : BLOQUEE, NON_COLLECTEE`);
    expect(text).not.toContain('—');
    await db.source.update({ where: { key: paused }, data: { status: 'ACTIVE' } });
  });
});
