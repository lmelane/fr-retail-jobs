import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient, type Source } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { maintainSourceAccess } from '../connectors/sourceAccessQualification.js';
import { recordSourceAccessDecision, requireSourceAccess } from '../connectors/sourceAccess.js';
import * as certification from '../connectors/sourceCertification.js';
import * as revision from '../capture/revision.js';
import * as accessModule from '../connectors/sourceAccess.js';
import { captureExtraction } from '../capture/batch.js';
import { fetchAtsJobs } from '../ats/index.js';
import { ingestAllBySource } from './ingestOrchestrator.js';
import { loadActiveSources } from '../connectors/sourceStore.js';
import { runIngest } from './ingest.js';
import { ingestionIssue } from '../lib/ingestionIssue.js';

// Keep native qualification, archive, replay, decisions, admission and SQL real.
// Only downstream publication is replaced in the orchestration-isolation witness.
vi.mock('./ingest.js', () => ({ KIND_TO_ATS: { ashby: 'ASHBY' }, runIngest: vi.fn(async (_db, options) => [{ source: options.only, errors: 0, fetched: 0, created: 0, updated: 0 }]) }));
vi.mock('../connectors/sourceStore.js', async importOriginal => ({
  ...await importOriginal<typeof import('../connectors/sourceStore.js')>(), loadActiveSources: vi.fn(),
}));
vi.mock('./health.js', () => ({ checkSourceHealth: vi.fn(async () => ({ incidents: [], broken: 0, degraded: 0 })) }));

const db = new PrismaClient();
const keys: string[] = [];
const create = async () => {
  const key = `maintain-access-${randomUUID()}`; keys.push(key);
  return db.source.create({ data: { key, maison: 'Access maintenance witness', kind: 'ashby', config: { board: key },
    tier: 'EMPLOYER_DIRECT', tenantKey: key, status: 'ACTIVE' } });
};
const native = (robots = 'User-agent: *\nAllow: /', beforeRobots?: () => Promise<void>) => {
  const transport = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === '/robots.txt') {
      await beforeRobots?.();
      return new Response(robots, { headers: { 'content-type': 'text/plain' } });
    }
    return new Response('{"apiVersion":"1","jobs":[]}', { headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', transport); return transport;
};
const maintain = (source: Source) => maintainSourceAccess(db, source.key, 15000);
const collect = (source: Source) => captureExtraction(db, source.key, source.config as Record<string, unknown>, undefined,
  config => fetchAtsJobs('ASHBY', config), 'ASHBY', { revisionId: source.currentRevisionId, requireActive: true });
const deny = (source: Source) => recordSourceAccessDecision(db, {
  sourceKey: source.key, sourceRevisionId: source.currentRevisionId, verdict: 'NOT_AUTHORIZED', captureBatchId: null,
  scopes: [], robotsCaptureIds: [], statement: 'Explicit denial witnessed by the access maintenance test.',
  reviewer: 'integration-test', checkedAt: new Date().toISOString(),
}, true);

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
afterAll(async () => {
  await db.$executeRaw`TRUNCATE "SourceIngestionAdmission", "SourceIdentityReview"`;
  await db.source.deleteMany({ where: { key: { in: keys } } }); await db.$disconnect();
});

describe('normal run maintains its access prerequisite through the Golden Path', () => {
  it('accepts a native server failure only after qualification and admission of the exact request', async () => {
    const source = await create(); native(); await maintain(source);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Service unavailable', { status: 503 })));
    let failure: unknown;
    try { await collect(source); } catch (error) { failure = error; }
    const issue = ingestionIssue(failure);
    expect(issue).toMatchObject({ origin: 'SOURCE', code: 'HTTP_503' });
    expect(issue.captureBatchId).toBeTruthy(); expect(issue.rawCaptureId).toBeTruthy();
    expect(await db.sourceIngestionAdmission.findUnique({ where: { batchId: issue.captureBatchId! } })).toBeTruthy();
    expect(await db.rawCapture.findUniqueOrThrow({ where: { id: issue.rawCaptureId! } })).toMatchObject({
      batchId: issue.captureBatchId, status: 503, complete: true, failure: null,
    });
  });
  it('qualifies missing access from native evidence, then admits a separate collection', async () => {
    const source = await create(); const transport = native();
    const result = await maintain(source);
    expect(result.renewed).toBe(true);
    expect(transport).toHaveBeenCalledTimes(2); // Native feed + robots; replay is offline.
    const { decision } = await requireSourceAccess(db, source);
    expect(decision.id).toBe(result.decisionId);
    expect(await db.sourceValidation.count({ where: { sourceRevisionId: source.currentRevisionId, verdict: 'VALIDATED' } })).toBe(1);
    expect(await db.sourceIngestionAdmission.count({ where: { batch: { sourceKey: source.key } } })).toBe(0);
    expect(await db.jobSource.count({ where: { sourceKey: source.key } })).toBe(0);
    const collected = await collect(source);
    expect(await db.captureBatch.findUniqueOrThrow({ where: { id: collected.captureBatchId } })).toMatchObject({ accessDecisionId: decision.id });
    expect(collected.captureBatchId).not.toBe(decision.captureBatchId);
  });

  it('does not renew a valid decision or perform qualification network calls', async () => {
    const source = await create(); const transport = native();
    const first = await maintain(source); transport.mockClear();
    expect(await maintain(source)).toEqual({ renewed: false, decisionId: first.decisionId });
    expect(transport).not.toHaveBeenCalled();
    expect(await db.sourceAccessDecision.count({ where: { sourceKey: source.key } })).toBe(1);
    await collect(source); expect(transport).toHaveBeenCalledTimes(1);
  });

  it('renews expired native qualification while retaining a valid access grant', async () => {
    const source = await create(); const transport = native();
    const first = await maintain(source); transport.mockClear();
    await expect(certification.requireSourceValidation(db, source.currentRevisionId, new Date(Date.now() + 25 * 3600_000)))
      .rejects.toMatchObject({ code: 'CAPTURE_STALE' });
    vi.spyOn(certification, 'requireSourceValidation').mockRejectedValueOnce(
      new certification.SourceValidationGateError('CAPTURE_STALE', '24-hour native qualification expired'));
    // The day's capture is handed to the ingestion, which adopts it instead of reading again (lecture unique).
    const renewed = await maintain(source);
    expect(renewed).toEqual({ renewed: false, decisionId: first.decisionId, qualificationCaptureId: expect.any(String) });
    expect(transport).toHaveBeenCalledTimes(1); // Native evidence; no redundant robots request.
    expect(await db.sourceAccessDecision.count({ where: { sourceKey: source.key } })).toBe(1);
    expect(await db.sourceValidation.count({ where: { sourceRevisionId: source.currentRevisionId } })).toBe(2);
    await collect(source);
  });

  it('re-derives a grant that the day\'s native qualification outgrows, then admits the collection (29/09/2026)', async () => {
    const source = await create(); native();
    const first = await maintain(source);
    // The publisher moves its feed: the address the first day's grant was derived from now redirects elsewhere.
    const moved = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
      if (!url.pathname.endsWith('/v2')) return new Response(null, { status: 301, headers: { location: `${url.pathname}/v2${url.search}` } });
      return new Response('{"apiVersion":"1","jobs":[]}', { headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', moved);
    // Premise: the first grant does not cover the new address, and the refusal names its motive instead of
    // `CaptureUnavailableError` (the 14 sources of the RUN of 29/09/2026 were reported that way).
    let refusal: unknown;
    try { await collect(source); } catch (error) { refusal = error; }
    expect(refusal).toMatchObject({ name: 'SourceAccessGateError', code: 'ACCESS_SCOPE' });
    expect(ingestionIssue(refusal)).toEqual({ origin: 'INTERNAL', code: 'ACCESS_SCOPE', count: 1 });
    vi.spyOn(certification, 'requireSourceValidation').mockRejectedValueOnce(
      new certification.SourceValidationGateError('CAPTURE_STALE', '24-hour native qualification expired'));
    const renewed = await maintain(source);
    expect(renewed.renewed).toBe(true); expect(renewed.decisionId).not.toBe(first.decisionId);
    expect(await db.sourceAccessDecision.count({ where: { sourceKey: source.key } })).toBe(2);
    // Derived from the day's qualification capture: no second collection, only the robots of the origin.
    expect(moved.mock.calls.map(([input]) => new URL(String(input)).pathname).filter(path => path === '/robots.txt')).toHaveLength(1);
    const collected = await collect(source);
    expect(await db.captureBatch.findUniqueOrThrow({ where: { id: collected.captureBatchId } })).toMatchObject({ accessDecisionId: renewed.decisionId });
  });

  it('hors passe, une validation venue d\'une passe de découverte ne remplace pas la qualification du RUN (audit r6, F1)', async () => {
    const source = await create(); const transport = native();
    const first = await maintain(source); transport.mockClear();
    // Prémisse : la validation courante est fraîche et vient d'une passe `ingest-light` (capture incrémentale).
    const current = await certification.requireSourceValidation(db, source.currentRevisionId);
    const passRun = randomUUID();
    await db.pipelineRun.create({ data: { id: passRun, command: 'ingest-light', status: 'COMPLETED' } });
    vi.spyOn(certification, 'requireSourceValidation').mockResolvedValueOnce({ ...current, captureBatch: { ...current.captureBatch, runId: passRun } });
    const renewed = await maintain(source);
    // Le RUN refait la qualification complète (donc le contrôle de périmètre du jour) et la remet à l'ingestion.
    expect(renewed).toEqual({ renewed: false, decisionId: first.decisionId, qualificationCaptureId: expect.any(String) });
    expect(transport).toHaveBeenCalledTimes(1);
    // Contre-épreuve : une validation venue d'un RUN reste gardée, sans requête.
    transport.mockClear();
    expect(await maintain(source)).toEqual({ renewed: false, decisionId: first.decisionId });
    expect(transport).not.toHaveBeenCalled();
    await db.pipelineRun.delete({ where: { id: passRun } });
  });

  it('renews stale reader evidence through capture/replay/robots without rewriting history', async () => {
    const source = await create(); native();
    const oldReader = vi.spyOn(revision, 'captureReaderRevision').mockReturnValue('git:' + '1'.repeat(40));
    const previous = await maintain(source); oldReader.mockRestore();
    await expect(requireSourceAccess(db, source)).rejects.toMatchObject({ code: 'ACCESS_STALE' });
    const transport = native(); const renewed = await maintain(source);
    expect(renewed.renewed).toBe(true); expect(renewed.decisionId).not.toBe(previous.decisionId);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(await db.sourceAccessDecision.count({ where: { sourceKey: source.key } })).toBe(2);
    await collect(source); expect(transport).toHaveBeenCalledTimes(3);
  });

  it('leaves failed technical qualification retryable without fabricating a permanent denial', async () => {
    const source = await create(); native('<html>Sign in</html>');
    await expect(maintain(source)).rejects.toMatchObject({ code: 'ACCESS_INVALID' });
    await expect(requireSourceAccess(db, source)).rejects.toMatchObject({ code: 'ACCESS_MISSING' });
    expect(await db.sourceAccessDecision.count({ where: { sourceKey: source.key } })).toBe(0);
    native();
    expect((await maintain(source)).renewed).toBe(true);
    await expect(requireSourceAccess(db, source)).resolves.toMatchObject({ decision: { verdict: 'ALLOWED' } });
  });

  it('never retries an explicit denial automatically', async () => {
    const source = await create(); await deny(source);
    const transport = native();
    await expect(maintain(source)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    // A registry revision does not erase a refusal either.
    await db.source.update({ where: { key: source.key }, data: { config: { board: source.key, country: 'FR' } } });
    await db.source.update({ where: { key: source.key }, data: { status: 'ACTIVE' } });
    await expect(maintain(source)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(transport).not.toHaveBeenCalled();
    expect(await db.sourceIngestionAdmission.count({ where: { batch: { sourceKey: source.key } } })).toBe(0);
  });

  it('does not overwrite a denial arriving while qualification is in flight', async () => {
    const source = await create(); native('User-agent: *\nAllow: /', async () => { await deny(source); });
    await expect(maintain(source)).rejects.toMatchObject({ code: 'ACCESS_INVALID' });
    await expect(requireSourceAccess(db, source)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(await db.sourceAccessDecision.count({ where: { sourceKey: source.key } })).toBe(1);
  });

  it('stops qualification before network when the source is not ACTIVE', async () => {
    const source = await create(); await db.source.update({ where: { key: source.key }, data: { status: 'PAUSED' } });
    const transport = native();
    await expect(maintain(source)).rejects.toMatchObject({ code: 'ADMISSION_MISSING' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('names a transport failure of qualification UNKNOWN and keeps its cause in capture and SourceRun (D-453)', async () => {
    const source = await create();
    // Rolex, RUN of 24/09/2026: robots.txt timed out at connect after a valid qualification collection.
    const cause = Object.assign(new Error('Connect Timeout Error (attempted address: robots.example:443, timeout: 12000ms)'),
      { name: 'ConnectTimeoutError', code: 'UND_ERR_CONNECT_TIMEOUT' });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === '/robots.txt') throw new TypeError('fetch failed', { cause });
      return new Response('{"apiVersion":"1","jobs":[]}', { headers: { 'content-type': 'application/json' } });
    }));
    vi.mocked(loadActiveSources).mockResolvedValue([{ ...source, config: source.config as Record<string, unknown>, revisionId: source.currentRevisionId }]);
    const result = await ingestAllBySource(db);
    expect(result).toMatchObject({ total: 1, ok: 0, failed: 1 });
    expect(result.issues).toEqual([{ source: source.key, origin: 'UNKNOWN', code: 'TRANSPORT_UND_ERR_CONNECT_TIMEOUT', count: 1 }]);
    const run = await db.sourceRun.findFirstOrThrow({ where: { sourceKey: source.key } });
    expect(run).toMatchObject({ status: 'ERROR', note: 'fetch failed [UND_ERR_CONNECT_TIMEOUT]' });
    const access = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: source.key, purpose: 'SOURCE_ACCESS' }, include: { outcome: true, captures: true } });
    expect(access.outcome).toMatchObject({ status: 'FAILED', failure: 'TypeError__UND_ERR_CONNECT_TIMEOUT' });
    expect(access.captures.map(capture => [capture.complete, capture.failure])).toEqual([[false, 'TypeError__UND_ERR_CONNECT_TIMEOUT']]);
  });

  it('isolates a refused source and continues the normal run on other ACTIVE sources', async () => {
    const blocked = await create(); await deny(blocked); const allowed = await create(); const transport = native();
    const previous = new Date('2026-01-01T00:00:00Z');
    await db.source.update({ where: { key: blocked.key }, data: {
      lastRunAt: previous, lastRunStatus: 'OK', lastRunJobs: 42,
      descriptionRate: 1, dateRate: 1, countryRate: 1, urlRate: 1,
    } });
    vi.mocked(loadActiveSources).mockResolvedValue([blocked, allowed].map(source => ({ ...source,
      config: source.config as Record<string, unknown>, revisionId: source.currentRevisionId })));
    const result = await ingestAllBySource(db);
    expect(result).toMatchObject({ total: 2, ok: 1, failed: 1, timedOut: 0 });
    // The allowed source was qualified in this turn: its ingestion receives that capture to adopt (lecture unique).
    expect(runIngest).toHaveBeenCalledExactlyOnceWith(db, { only: allowed.key, skipGeocode: true, adoptCaptureId: expect.any(String) });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(await db.sourceRun.findFirst({ where: { sourceKey: blocked.key } })).toMatchObject({ status: 'ERROR', canAttestAbsence: false });
    const summary = await db.source.findUniqueOrThrow({ where: { key: blocked.key } });
    expect(summary).toMatchObject({ status: 'ACTIVE', lastRunStatus: 'ERROR', lastRunJobs: 0,
      descriptionRate: null, dateRate: null, countryRate: null, urlRate: null });
    expect(summary.lastRunAt!.getTime()).toBeGreaterThan(previous.getTime());
    await expect(requireSourceAccess(db, allowed)).resolves.toMatchObject({ decision: { verdict: 'ALLOWED' } });
  });
});

/**
 * RUN du 01/10/2026 : deux sources tombées pour une transaction courte close par le délai par défaut de Prisma (5 s) —
 * browns-shoes à 5 066 ms, diptyque-workday à 7 446 ms, la seconde rapportée comme un refus d'accès.
 */
describe('les transactions du chemin d\'une source survivent à une attente de quelques secondes (RUN du 01/10/2026)', () => {
  const sourceLock = (key: string) => JSON.stringify(['source-write', key]);

  it('une autre session tient le verrou de la source 6 s : la qualification attend et aboutit', async () => {
    const source = await create(); native();
    const holder = new PrismaClient();
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { locked = resolve; });
    const holding = holder.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${sourceLock(source.key)}, 0))`;
      locked(); await gate;
    }, { timeout: 60_000 });
    try {
      await acquired;
      // Prémisse : le verrou de la source est bien tenu ailleurs quand la qualification commence.
      const [{ free }] = await db.$transaction(tx => tx.$queryRaw<{ free: boolean }[]>`
        SELECT pg_try_advisory_xact_lock_shared(hashtextextended(${sourceLock(source.key)}, 0)) AS free`);
      expect(free).toBe(false);
      const started = Date.now();
      setTimeout(release, 6_000);
      await expect(maintain(source)).resolves.toMatchObject({ renewed: true });
      // Prémisse : la qualification a réellement attendu plus que le délai par défaut de Prisma.
      expect(Date.now() - started).toBeGreaterThan(5_500);
    } finally { release(); await holding; await holder.$disconnect(); }
  }, 30_000);

  it('aucune transaction interactive de la qualification et de la collecte ne tourne au délai par défaut', async () => {
    const source = await create(); native();
    const spy = vi.spyOn(db, '$transaction');
    await maintain(source); await collect(source);
    const interactive = spy.mock.calls.filter(([work]) => typeof work === 'function');
    // Prémisse : le chemin a bien ouvert ses transactions (capture, validation, décision d'accès, preuve, collecte).
    expect(interactive.length).toBeGreaterThanOrEqual(5);
    const unbounded = interactive.filter(([, options]) => !((options as { timeout?: number } | undefined)?.timeout! >= 30_000));
    expect(unbounded.map(([work]) => String(work).slice(0, 160))).toEqual([]);
  });

  it('une panne de base pendant la décision d\'accès reste une panne interne, jamais un refus d\'accès', async () => {
    const source = await create(); native();
    const expired = new Prisma.PrismaClientKnownRequestError(
      'Transaction already closed: A commit cannot be executed on an expired transaction.', { code: 'P2028', clientVersion: Prisma.prismaVersion.client });
    vi.spyOn(accessModule, 'recordSourceAccessDecision').mockRejectedValueOnce(expired);
    let failure: unknown;
    try { await maintain(source); } catch (error) { failure = error; }
    expect(failure).toBe(expired);
    expect(ingestionIssue(failure)).toEqual({ origin: 'INTERNAL', code: 'DATABASE_FAILURE', count: 1 });
  });
});
