import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient, type Source } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CaptureUnavailableError } from '../capture/context.js';
import { HttpStatusError } from '../lib/http.js';
import { ingestAllBySource, retryTransientFailures, RUN_RETRY_MAX_SOURCES, type OrchestratorResult } from './ingestOrchestrator.js';
import { loadActiveSources } from '../connectors/sourceStore.js';
import { runIngest, type IngestStats } from './ingest.js';
import { FULL_RUN_MARKER } from './fullRunMarker.js';

/**
 * D-520 — la reprise unique des échecs passagers dans le RUN. Qualification native, décisions d'accès, archives et
 * SQL réels ; seules la publication (`runIngest`) et la santé sont remplacées, comme dans `sourceAccessMaintenance`.
 * RUN du 29/09/2026 : 14 sources tombées pour « Native response capture unavailable », toutes revenues au RUN suivant.
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
const captureDown = () => new CaptureUnavailableError(new Error('object store write timed out'));

/** Un RUN complet antérieur où la source portait déjà `cause` : ce qui la fait passer à réparer. */
const previousRun = async (key: string, cause: string) => {
  const id = `previous-run-${randomUUID()}`; runs.push(id);
  await db.pipelineRun.create({ data: { id, command: 'ingest-all', startedAt: new Date(Date.now() - 86_400_000), status: 'COMPLETED' } });
  const event = (event: string, sourceKey: string | null, payload: Prisma.InputJsonValue) => db.pipelineEvent.create({ data: {
    id: randomUUID(), runId: id, level: 'info', event, sourceKey, fingerprint: randomUUID(), payload } });
  await event('source.issue_classified', key, { sourceKey: key, issues: [{ origin: 'INTERNAL', code: 'CaptureUnavailableError', count: 1 }],
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

describe('D-520 : un échec passager est repris une fois dans le RUN', () => {
  it('une capture indisponible puis disponible : la source finit saine, la première tentative reste au journal', async () => {
    const source = await create(); native(); active(source);
    vi.mocked(runIngest).mockRejectedValueOnce(captureDown()).mockImplementation(async (_db, options) => published(options));
    const result = await ingestAllBySource(db);
    expect(result).toMatchObject({ total: 1, ok: 1, failed: 0, timedOut: 0, failures: [], issues: [], incidents: [] });
    expect(result.retries).toEqual([{ source: source.key, cause: 'TRANSIENT_CAPTURE', absorbed: true }]);
    expect(runIngest).toHaveBeenCalledTimes(2);
    // La première tentative n'est pas effacée : son SourceRun en erreur reste, avec sa cause.
    expect(await db.sourceRun.findMany({ where: { sourceKey: source.key }, select: { status: true, note: true } }))
      .toEqual([{ status: 'ERROR', note: 'Native response capture unavailable; extraction stopped' }]);
  });

  it('reprise échouée : un seul échec au bilan, nommé avec sa trajectoire', async () => {
    const source = await create(); native(); active(source);
    vi.mocked(runIngest).mockRejectedValue(captureDown());
    const result = await ingestAllBySource(db);
    expect(result).toMatchObject({ total: 1, ok: 0, failed: 1 });
    expect(result.retries).toEqual([{ source: source.key, cause: 'TRANSIENT_CAPTURE', absorbed: false }]);
    expect(runIngest).toHaveBeenCalledTimes(2);
    expect(result.failures).toEqual([`${source.key} (bloquant : échec · capture native indisponible → revient seule)`]);
    expect(result.issues).toHaveLength(1);
    expect(result.incidents).toHaveLength(1);
  });

  it('un refus de l’éditeur n’est jamais relu dans le même RUN', async () => {
    const source = await create(); native(); active(source);
    vi.mocked(runIngest).mockRejectedValue(new HttpStatusError(403, 'https://example.test/jobs'));
    const result = await ingestAllBySource(db);
    expect(result).toMatchObject({ ok: 0, failed: 1 });
    expect(result.retries).toBeUndefined();
    expect(runIngest).toHaveBeenCalledTimes(1);
    expect(result.failures[0]).toContain('refus de l’éditeur (403, 406, 429, anti-robot) → revient seule');
  });

  it('la même cause au RUN complet précédent : à réparer, pas de reprise', async () => {
    const source = await create(); native(); active(source);
    await previousRun(source.key, 'TRANSIENT_CAPTURE');
    vi.mocked(runIngest).mockRejectedValueOnce(captureDown()).mockImplementation(async (_db, options) => published(options));
    const result = await ingestAllBySource(db);
    expect(result).toMatchObject({ ok: 0, failed: 1 });
    expect(runIngest).toHaveBeenCalledTimes(1);
    expect(result.failures).toEqual([`${source.key} (bloquant : échec · capture native indisponible → à réparer, 2e RUN de suite)`]);
  });

  it('interrupteur RUN_TRANSIENT_RETRY=off : comportement d’avant', async () => {
    process.env.RUN_TRANSIENT_RETRY = 'off';
    const source = await create(); native(); active(source);
    vi.mocked(runIngest).mockRejectedValueOnce(captureDown()).mockImplementation(async (_db, options) => published(options));
    const result = await ingestAllBySource(db);
    expect(result).toMatchObject({ ok: 0, failed: 1 });
    expect(runIngest).toHaveBeenCalledTimes(1);
  });

  it('une panne de masse n’est pas ordinaire : au-delà du plafond, aucune reprise et le RUN reste rouge', async () => {
    const pending = Array.from({ length: RUN_RETRY_MAX_SOURCES + 1 }, (_, i) => ({ source: `mass-${i}`, cause: 'TRANSIENT_CAPTURE' as const }));
    const result: OrchestratorResult = { total: pending.length, ok: 0, failed: pending.length, timedOut: 0,
      failures: pending.map(p => `${p.source} (bloquant : échec)`), incidents: [], issues: [], pendingRetry: pending };
    await retryTransientFailures(db, result);
    expect(result).toMatchObject({ failed: pending.length, pendingRetry: [] });
    expect(result.retries).toBeUndefined();
    expect(result.failures).toHaveLength(pending.length);
    expect(runIngest).not.toHaveBeenCalled();
  });
});
