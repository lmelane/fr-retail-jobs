import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient, type Source } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ingestAllBySource, retryDeadline, retryExcluded, retryTransientFailures, RUN_RETRY_MAX_SOURCES, type OrchestratorResult } from './ingestOrchestrator.js';
import { loadActiveSources } from '../connectors/sourceStore.js';
import { runIngest, type IngestStats } from './ingest.js';
import { FULL_RUN_MARKER } from './fullRunMarker.js';

/**
 * D-520 — la reprise unique des échecs passagers dans le RUN. Qualification native, décisions d'accès, archives et
 * SQL réels ; seules la publication (`runIngest`) et la santé sont remplacées, comme dans `sourceAccessMaintenance`.
 */
vi.mock('./ingest.js', () => ({ KIND_TO_ATS: { ashby: 'ASHBY' }, runIngest: vi.fn() }));
vi.mock('../connectors/sourceStore.js', async importOriginal => ({
  ...await importOriginal<typeof import('../connectors/sourceStore.js')>(), loadActiveSources: vi.fn(),
}));
vi.mock('./health.js', () => ({ checkSourceHealth: vi.fn(async () => ({ incidents: [], broken: 0, degraded: 0 })) }));

const db = new PrismaClient();
const keys: string[] = [];
const runs: string[] = [];
const create = async () => {
  const key = `transient-retry-${randomUUID()}`; keys.push(key);
  return db.source.create({ data: { key, maison: 'Transient retry witness', kind: 'ashby', config: { board: key },
    tier: 'EMPLOYER_DIRECT', tenantKey: key, status: 'ACTIVE' } });
};
const native = () => vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } });
  return new Response('{"apiVersion":"1","jobs":[]}', { headers: { 'content-type': 'application/json' } });
}));
const active = (...sources: Source[]) => vi.mocked(loadActiveSources).mockResolvedValue(sources.map(source => ({ ...source,
  config: source.config as Record<string, unknown>, revisionId: source.currentRevisionId })));
const published = (options?: { only?: string }) => [{ source: options?.only ?? '', errors: 0, fetched: 0, created: 0, updated: 0 }] as unknown as IngestStats[];
/** RUN du 01/10/2026, browns-shoes : la panne est absorbée par `runIngest` (`source.ingest_failed`) et remonte dans les
 * statistiques de la source, la branche « collectée » de `ingestOne` — le chemin de production des pannes mesurées. */
const failedStats = (options: { only?: string } | undefined, code: string, origin: 'INTERNAL' | 'UNKNOWN', errorNote: string, detail?: string) =>
  [{ source: options?.only ?? '', errors: 1, fetched: 0, created: 0, updated: 0, errorNote,
    issues: [{ origin, code, count: 1, ...(detail ? { detail } : {}) }] }] as unknown as IngestStats[];
const databaseDown = (options?: { only?: string }) => failedStats(options, 'DATABASE_FAILURE', 'INTERNAL',
  'Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction.');

/** Un RUN complet antérieur où la source portait déjà `cause`. */
const previousRun = async (key: string, cause: string) => {
  const id = `previous-run-${randomUUID()}`; runs.push(id);
  await db.pipelineRun.create({ data: { id, command: 'ingest-all', startedAt: new Date(Date.now() - 86_400_000), status: 'COMPLETED' } });
  const event = (event: string, sourceKey: string | null, payload: Prisma.InputJsonValue) => db.pipelineEvent.create({ data: {
    id: randomUUID(), runId: id, level: 'info', event, sourceKey, fingerprint: randomUUID(), payload } });
  await event('source.issue_classified', key, { sourceKey: key, issues: [{ origin: 'INTERNAL', code: 'DATABASE_FAILURE', count: 1 }],
    remediation: [{ cause }] });
  await event(FULL_RUN_MARKER, null, {});
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); delete process.env.RUN_TRANSIENT_RETRY; });
afterAll(async () => {
  await db.pipelineEvent.deleteMany({ where: { runId: { in: runs } } });
  await db.pipelineRun.deleteMany({ where: { id: { in: runs } } });
  await db.$executeRaw`TRUNCATE "SourceIngestionAdmission", "SourceIdentityReview"`;
  await db.source.deleteMany({ where: { key: { in: keys } } }); await db.$disconnect();
});

describe('D-520 : une panne passagère par sa classe est reprise une fois dans le RUN', () => {
  it('panne de base absorbée par la collecte (chemin de production), puis disponible : la source finit saine', async () => {
    const source = await create(); native(); active(source);
    vi.mocked(runIngest).mockImplementationOnce(async (_db, options) => databaseDown(options)).mockImplementation(async (_db, options) => published(options));
    const result = await ingestAllBySource(db);
    expect(result).toMatchObject({ total: 1, ok: 1, failed: 0, timedOut: 0, failures: [], issues: [], incidents: [] });
    expect(result.retries).toEqual([{ source: source.key, cause: 'TRANSIENT_DATABASE', absorbed: true }]);
    expect(runIngest).toHaveBeenCalledTimes(2);
  });

  it('panne de base levée hors de la collecte (branche d’échec) : reprise aussi, la première tentative reste en SourceRun', async () => {
    const source = await create(); native(); active(source);
    vi.mocked(runIngest).mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Transaction already closed', { code: 'P2028', clientVersion: 'test' }))
      .mockImplementation(async (_db, options) => published(options));
    const result = await ingestAllBySource(db);
    expect(result).toMatchObject({ ok: 1, failed: 0, failures: [] });
    expect(result.retries).toEqual([{ source: source.key, cause: 'TRANSIENT_DATABASE', absorbed: true }]);
    expect(await db.sourceRun.findMany({ where: { sourceKey: source.key }, select: { status: true } })).toEqual([{ status: 'ERROR' }]);
  });

  it('reprise échouée : un seul échec au bilan, à instruire', async () => {
    const source = await create(); native(); active(source);
    vi.mocked(runIngest).mockImplementation(async (_db, options) => databaseDown(options));
    const result = await ingestAllBySource(db);
    expect(result).toMatchObject({ total: 1, ok: 0, failed: 1 });
    expect(result.retries).toEqual([{ source: source.key, cause: 'TRANSIENT_DATABASE', absorbed: false }]);
    expect(runIngest).toHaveBeenCalledTimes(2);
    expect(result.failures).toEqual([`${source.key} (bloquant : erreurs d’ingestion · base de données indisponible ou lente (reprise échouée) → à instruire)`]);
    expect(result.issues).toHaveLength(1);
  });

  it.each([
    ['une capture refusée par la politique d’accès', 'CaptureUnavailableError', 'INTERNAL', 'Native response capture unavailable; extraction stopped', undefined],
    ['un refus 403', 'HttpStatusError', 'UNKNOWN', 'HTTP 403 for https://example.test/jobs', 'HTTP_403'],
  ] as const)('%s n’est jamais relue dans le même RUN', async (_, code, origin, note, detail) => {
    const source = await create(); native(); active(source);
    vi.mocked(runIngest).mockImplementation(async (_db, options) => failedStats(options, code, origin, note, detail));
    const result = await ingestAllBySource(db);
    expect(result).toMatchObject({ ok: 0, failed: 1 });
    expect(result.retries).toBeUndefined();
    expect(runIngest).toHaveBeenCalledTimes(1);
    expect(result.failures[0]).toContain('→ à instruire');
  });

  it('la même cause au RUN complet précédent : à instruire, pas de reprise', async () => {
    const source = await create(); native(); active(source);
    await previousRun(source.key, 'TRANSIENT_DATABASE');
    vi.mocked(runIngest).mockImplementationOnce(async (_db, options) => databaseDown(options)).mockImplementation(async (_db, options) => published(options));
    const result = await ingestAllBySource(db);
    expect(result).toMatchObject({ ok: 0, failed: 1 });
    expect(runIngest).toHaveBeenCalledTimes(1);
    expect(result.failures).toEqual([`${source.key} (bloquant : erreurs d’ingestion · base de données indisponible ou lente → à instruire, déjà là au RUN complet précédent)`]);
  });

  it('interrupteur RUN_TRANSIENT_RETRY=off : comportement d’avant', async () => {
    process.env.RUN_TRANSIENT_RETRY = 'off';
    const source = await create(); native(); active(source);
    vi.mocked(runIngest).mockImplementationOnce(async (_db, options) => databaseDown(options)).mockImplementation(async (_db, options) => published(options));
    const result = await ingestAllBySource(db);
    expect(result).toMatchObject({ ok: 0, failed: 1 });
    expect(runIngest).toHaveBeenCalledTimes(1);
  });

  it('à moins de 2 minutes de la fin de la fenêtre du RUN, aucune reprise n’est commencée', async () => {
    const source = await create();
    const line = `${source.key} (bloquant : échec)`;
    const result: OrchestratorResult = { total: 1, ok: 0, failed: 1, timedOut: 0, failures: [line], incidents: [], issues: [],
      pendingRetry: [{ source: source.key, cause: 'TRANSIENT_DATABASE' }] };
    await retryTransientFailures(db, result, () => new Date('2026-10-02T18:28:30Z'));
    expect(runIngest).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1, failures: [line], retries: [] });
  });

  it('une panne de masse n’est pas ordinaire : au-delà du plafond, aucune reprise et le RUN reste rouge', async () => {
    const pending = Array.from({ length: RUN_RETRY_MAX_SOURCES + 1 }, (_, i) => ({ source: `mass-${i}`, cause: 'TRANSIENT_DATABASE' as const }));
    const result: OrchestratorResult = { total: pending.length, ok: 0, failed: pending.length, timedOut: 0,
      failures: pending.map(p => `${p.source} (bloquant : échec)`), incidents: [], issues: [], pendingRetry: pending };
    await retryTransientFailures(db, result);
    expect(result).toMatchObject({ failed: pending.length, pendingRetry: [] });
    expect(result.retries).toBeUndefined();
    expect(result.failures).toHaveLength(pending.length);
    expect(runIngest).not.toHaveBeenCalled();
  });
});

describe('les bornes de la reprise (pures)', () => {
  it('elle finit avant la fin de la fenêtre du RUN, puis avant la prochaine passe', () => {
    expect(new Date(retryDeadline(new Date('2026-10-02T16:10:00Z'))).toISOString()).toBe('2026-10-02T18:30:00.000Z');
    expect(new Date(retryDeadline(new Date('2026-10-02T18:40:00Z'))).toISOString()).toBe('2026-10-02T21:00:00.000Z');
    expect(new Date(retryDeadline(new Date('2026-10-02T22:00:00Z'))).toISOString()).toBe('2026-10-03T01:00:00.000Z');
    expect(new Date(retryDeadline(new Date('2026-10-02T12:30:00Z'))).toISOString()).toBe('2026-10-02T13:00:00.000Z');
  });

  it('Avature et l’amorçage anti-robot ne sont jamais repris (D-483, lecture D-492 de D-516 §1)', () => {
    expect(retryExcluded('ralph-lauren-avature', 'avature')).toBe(true);
    expect(retryExcluded('l-oreal-professionnel', 'avature')).toBe(true);
    expect(retryExcluded('ralph-lauren-avature', 'other')).toBe(true);
    expect(retryExcluded('browns-shoes', 'smartrecruiters')).toBe(false);
  });
});
