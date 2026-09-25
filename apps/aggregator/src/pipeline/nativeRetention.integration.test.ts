import '../test/setup-integration.js';
import { PrismaClient, type Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { ingestSyntheticFeed, qualifiedSource, releaseQualifiedSources, resolvedCompany, syntheticFeed } from '../test/ingestionFixture.js';
import { checkSourceHealth, FULL_RUN_MARKER } from './health.js';
import { issuesFromResult } from '../lib/ingestionIssue.js';
import { summarizeOrchestration } from '../lib/runSummary.js';
import { ingestAllBySource } from './ingestOrchestrator.js';
import { runIngest, type IngestStats } from './ingest.js';
import { deactivateCapturedPublication } from './deactivateSources.js';
import { installLogger, log, OperationalLogger } from '../observability/logger.js';
import { readRawBlob } from '../capture/store.js';
import type { CompletionReport } from '../capture/completion.js';

// Pass-through: one witness below lets a held posting keep its earlier publication, as a reason without disposition does.
vi.mock('./deactivateSources.js', async importOriginal => {
  const original = await importOriginal<typeof import('./deactivateSources.js')>();
  return { ...original, deactivateCapturedPublication: vi.fn(original.deactivateCapturedPublication) };
});

const db = new PrismaClient();
afterAll(async () => { await releaseQualifiedSources(db); await db.$disconnect(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.INGEST_ONLY_KEYS; });

/** A certified single-brand portal, as in the other synthetic ingestions: identity is not what these witnesses measure. */
async function establishedSource(key: string) {
  await qualifiedSource(db, key);
  await db.source.update({ where: { key }, data: { portalScope: 'SINGLE_BRAND' } });
  await resolvedCompany(db, key);
}

/**
 * D-453 §1 through the production ingestion: the retention is counted by reason where it is decided,
 * and its SOURCE attribution points to the sealed end-of-ingestion report that names each HELD fate.
 */
it('counts a native retention by reason and proves it by the sealed completion report', async () => {
  const key = `native-retention-${randomUUID()}`;
  await establishedSource(key);
  // The previous productive run: the source's own reference for the negative-proof guard.
  const baseline = await ingestSyntheticFeed(db, key, [{ id: 'listed-1', title: 'Client Advisor' }, { id: 'listed-2', title: 'Store Manager' }]);
  await checkSourceHealth(db, [baseline]);
  const stats = await ingestSyntheticFeed(db, key, [
    { id: 'listed-1', title: 'Client Advisor' }, { id: 'listed-2', title: 'Store Manager' }, { id: 'unlisted', title: 'Visual Merchandiser', listed: false },
  ]);
  expect(stats).toMatchObject({ errors: 0, held: 1, heldReasons: { SOURCE_UNLISTED: 1 }, enumerationReading: 'PROVEN' });
  const health = await checkSourceHealth(db, [stats]);
  expect(health.incidents).toMatchObject([{ source: key, status: 'DEGRADED', nonBlockingRetentionOnly: true, retained: 1,
    retention: { collected: 3, byReason: { SOURCE_UNLISTED: 1 } } }]);
  const issues = issuesFromResult([stats], health.incidents);
  expect(issues).toEqual([{ origin: 'SOURCE', code: 'NATIVE_RETENTION', count: 1,
    captureBatchId: stats.captureBatchId, completionReportHash: stats.completionReportHash }]);
  const completion = await db.sourceIngestionCompletion.findUniqueOrThrow({ where: { batchId: stats.captureBatchId! } });
  expect(completion).toMatchObject({ reportHash: stats.completionReportHash, held: 1, writeFailed: 0 });
  const report = JSON.parse((await readRawBlob(db, completion.reportHash)).toString('utf8')) as CompletionReport;
  expect(report.fates).toEqual([{ ordinal: 2, externalId: 'unlisted', disposition: 'HELD', reason: 'SOURCE_UNLISTED' }]);
  const run = await db.sourceRun.findFirstOrThrow({ where: { sourceKey: key }, orderBy: { ranAt: 'desc' } });
  expect(run.note).toContain('1 sur preuve de la source (SOURCE_UNLISTED=1)');
});

it('on a first run too, a positive native proof does not block: only the Workday negative proof is guarded', async () => {
  const key = `native-retention-first-${randomUUID()}`;
  await establishedSource(key);
  const stats = await ingestSyntheticFeed(db, key, [{ id: 'listed-1', title: 'Client Advisor' }, { id: 'unlisted', title: 'Visual Merchandiser', listed: false }]);
  const health = await checkSourceHealth(db, [stats]);
  expect(health.incidents).toMatchObject([{ nonBlockingRetentionOnly: true }]);
  expect(health.incidents[0]?.guardWithoutReference).toBeUndefined();
  expect(issuesFromResult([stats], health.incidents)).toEqual([expect.objectContaining({ origin: 'SOURCE', code: 'NATIVE_RETENTION', count: 1 })]);
});

/**
 * Through the REAL orchestrator (targeted run): the incident is annotated non-blocking by `ingestOne` itself, the
 * failure line says so, a RUN whose only source retains completes with errors instead of ALL_SOURCES_FAILED, and a
 * targeted run never emits the complete-RUN marker the guard takes its reference from.
 */
it('a targeted RUN of a retaining source completes with errors, annotated non-blocking, and is no guard reference', async () => {
  const key = `native-retention-run-${randomUUID()}`;
  await establishedSource(key);
  const feed = syntheticFeed([{ id: 'listed-1', title: 'Client Advisor' }, { id: 'unlisted', title: 'Visual Merchandiser', listed: false }]);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return url.pathname === '/robots.txt' ? new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } }) : new Response(feed);
  }));
  const events = vi.spyOn(log, 'info');
  process.env.INGEST_ONLY_KEYS = key;
  const result = await ingestAllBySource(db);
  // Premise: one source, zero "ok" — the former rule read that as every source failing.
  expect(result).toMatchObject({ total: 1, ok: 0, failed: 1 });
  expect(result.incidents).toMatchObject([{ source: key, blocking: false, nonBlockingRetentionOnly: true }]);
  expect(result.failures).toEqual([`${key} (non bloquant : retenue sur preuve de la source, 1 offre)`]);
  expect(summarizeOrchestration(result)).toMatchObject({ outcome: 'COMPLETED_WITH_ERRORS', blockingReasons: [], nativeRetentions: { postings: 1 } });
  expect(events.mock.calls.map(([event]) => event)).not.toContain(FULL_RUN_MARKER);
});

/**
 * The enumeration reading is recorded by the production ingestion from the sealed extraction (D-453 §1): an
 * Ashby feed with one explained rejection among twenty-one rows is NOT PROVEN — the adapter declines its proof,
 * nothing refutes it — and stays a blocking failure to instruct; the same rejection among three rows leaves the
 * published total unreached, which REFUTES it.
 */
it('records not proven and refuted enumerations apart, both blocking', async () => {
  const listed = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `posting-${i}`, title: `Poste ${i}` }));
  const notProvenKey = `enumeration-not-proven-${randomUUID()}`;
  await establishedSource(notProvenKey);
  const notProven = await ingestSyntheticFeed(db, notProvenKey, [...listed(20), { id: 'untitled', title: null }]);
  // Premise: the sealed adapter output still says `complete: false` — only the RUN's reading differs.
  expect(notProven).toMatchObject({ complete: false, enumerationReading: 'NOT_PROVEN', created: 20 });
  const notProvenHealth = await checkSourceHealth(db, [notProven]);
  expect(notProvenHealth.incidents).toMatchObject([{ status: 'DEGRADED', finding: 'ENUMERATION_NOT_PROVEN' }]);
  expect(issuesFromResult([notProven], notProvenHealth.incidents)).toEqual([{ origin: 'UNKNOWN', code: 'ENUMERATION_NOT_PROVEN', count: 1 }]);

  const refutedKey = `enumeration-refuted-${randomUUID()}`;
  await establishedSource(refutedKey);
  const refuted = await ingestSyntheticFeed(db, refutedKey, [...listed(2), { id: 'untitled', title: null }]);
  expect(refuted).toMatchObject({ complete: false, enumerationReading: 'REFUTED', truncated: true });
  expect(refuted.enumerationRefutedBy).toEqual(expect.arrayContaining(['TRUNCATED', 'DECLARED_TOTAL_NOT_REACHED']));
  const refutedHealth = await checkSourceHealth(db, [refuted]);
  expect(refutedHealth.incidents).toMatchObject([{ status: 'DEGRADED', note: expect.stringContaining('troncature') }]);
  expect(issuesFromResult([refuted], refutedHealth.incidents).every(issue => issue.origin === 'UNKNOWN')).toBe(true);
});

/**
 * A retention keeps THIS RUN from publishing; it withdraws an earlier publication only when its reason carries a
 * disposition (`publicationHold.ts`). The ingestion counts, per reason and in the database, the held postings still
 * online once every hold is archived — it withdraws nothing itself.
 */
it('counts, per reason, the held postings an earlier collection keeps online, and only those', async () => {
  const key = `held-online-${randomUUID()}`;
  await establishedSource(key);
  const titles = { kept: 'Client Advisor', stays: 'Store Manager', gone: 'Visual Merchandiser', lapsed: 'Stock Associate' };
  await ingestSyntheticFeed(db, key, Object.entries(titles).map(([id, title]) => ({ id, title })));
  // Premise: the four postings are published before the retention run.
  expect(await db.jobSource.count({ where: { sourceKey: key, isActive: true } })).toBe(4);
  // 'lapsed' keeps an active representation whose declared deadline has passed: the site no longer shows it.
  await db.jobSource.update({ where: { sourceKey_externalId: { sourceKey: key, externalId: 'lapsed' } }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
  const deactivate = vi.mocked(deactivateCapturedPublication);
  const original = deactivate.getMockImplementation()!;
  // 'stays' and 'lapsed' keep their earlier publication (PRESENT_BUT_HELD, as for a reason without disposition);
  // 'gone' is withdrawn by the real deactivation.
  deactivate.mockImplementation(async (prisma, input) => input.externalId === 'gone' ? original(prisma, input)
    : { sourcesDeactivated: 0, jobsClosed: 0, jobsWithdrawn: 0, jobsKept: 0, urlsReassigned: 0 });
  let stats: IngestStats;
  try {
    stats = await ingestSyntheticFeed(db, key, Object.entries(titles).map(([id, title]) => ({ id, title, listed: id === 'kept' })));
  } finally { deactivate.mockImplementation(original); }
  expect(stats).toMatchObject({ errors: 0, held: 3, heldReasons: { SOURCE_UNLISTED: 3 } });
  const active = await db.jobSource.findMany({ where: { sourceKey: key, isActive: true }, select: { externalId: true }, orderBy: { externalId: 'asc' } });
  // Premise: two held representations are still active, and their offers too — only availability tells them apart.
  expect(active.map(row => row.externalId)).toEqual(['kept', 'lapsed', 'stays']);
  expect(await db.job.count({ where: { isActive: true, mergedIntoId: null, sources: { some: { sourceKey: key, externalId: { in: ['lapsed', 'stays'] } } } } })).toBe(2);
  // Online as the site sees it: 'stays' alone.
  expect(stats.heldOnline).toEqual({ SOURCE_UNLISTED: 1 });
  const health = await checkSourceHealth(db, [stats]);
  expect(health.incidents).toMatchObject([{ retention: { byReason: { SOURCE_UNLISTED: 3 }, online: { SOURCE_UNLISTED: 1 } } }]);
});

/**
 * The negative-proof guard reads its reference in the database: the last SourceRun of a COMPLETE RUN, recognised by
 * the marker that only a complete RUN emits. Through the real ingestion, under a persisting logger as in production.
 */
it('the guard finds its reference in the database: a complete RUN emits the marker, a later Workday jump blocks', async () => {
  const key = `guard-reference-${randomUUID()}`, targetedKey = `guard-targeted-${randomUUID()}`;
  await establishedSource(key);
  await establishedSource(targetedKey);
  const completeRun = randomUUID(), targetedRun = randomUUID();
  const feed = syntheticFeed(Array.from({ length: 30 }, (_, i) => ({ id: `posting-${i}`, title: `Poste ${i}` })));
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return url.pathname === '/robots.txt' ? new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } }) : new Response(feed);
  }));
  const persisting = (runId: string) => new OperationalLogger({ runId, write: async () => undefined, delay: async () => undefined,
    persist: async record => { await db.pipelineEvent.create({ data: { ...record, payload: record.payload as Prisma.InputJsonValue } }); } });
  // The complete RUN collects every ACTIVE source: the other suites' sources are paused for its duration, then restored.
  const others = (await db.source.findMany({ where: { status: 'ACTIVE', key: { notIn: [key, targetedKey] } }, select: { key: true } })).map(row => row.key);
  try {
    await db.pipelineRun.createMany({ data: [{ id: completeRun, command: 'ingest' }, { id: targetedRun, command: 'ingest' }] });
    await db.source.updateMany({ where: { key: { in: [...others, targetedKey] } }, data: { status: 'PAUSED' } });
    installLogger(persisting(completeRun));
    await checkSourceHealth(db, await runIngest(db, { skipGeocode: true }));
    await db.source.updateMany({ where: { key: targetedKey }, data: { status: 'ACTIVE' } });
    installLogger(persisting(targetedRun));
    await checkSourceHealth(db, await runIngest(db, { only: targetedKey, skipGeocode: true }));
  } finally {
    installLogger(new OperationalLogger({ runId: `local-${randomUUID()}` }));
    await db.source.updateMany({ where: { key: { in: [...others, targetedKey] } }, data: { status: 'ACTIVE' } });
  }
  try {
    // Premise: only the complete RUN carries the marker, and each run left the source's SourceRun under its own id.
    expect(await db.pipelineEvent.count({ where: { runId: completeRun, event: FULL_RUN_MARKER } })).toBe(1);
    expect(await db.pipelineEvent.count({ where: { runId: targetedRun, event: FULL_RUN_MARKER } })).toBe(0);
    expect(await db.sourceRun.findFirstOrThrow({ where: { sourceKey: key, runId: completeRun } })).toMatchObject({ fetched: 30, accepted: 30 });
    expect(await db.sourceRun.findFirstOrThrow({ where: { sourceKey: targetedKey, runId: targetedRun } })).toMatchObject({ fetched: 30, accepted: 30 });
    // The next collection: 12 of 30 postings name no employer (0 % → 40 %), 18 published — no collapse.
    const jumped = (source: string): IngestStats => ({ source, complete: true, enumerationReading: 'PROVEN', fetched: 30, inSector: 18, france: 0,
      created: 0, merged: 0, updated: 18, errors: 0, withDescription: 18, withDate: 18, withCountry: 18, withUrl: 18, declaredTotal: 30,
      held: 12, heldUnresolved: 12, heldReasons: { WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 12 }, captureBatchId: `batch-${source}`, completionReportHash: `report-${source}` });
    const guarded = await checkSourceHealth(db, [jumped(key)]);
    expect(guarded.incidents).toMatchObject([{ finding: 'NATIVE_RETENTION_JUMP' }]);
    expect(guarded.incidents[0]?.guardWithoutReference).toBeUndefined();
    expect(issuesFromResult([jumped(key)], guarded.incidents)).toEqual([{ origin: 'UNKNOWN', code: 'NATIVE_RETENTION_JUMP', count: 1 }]);
    // Collected by a targeted run only: no reference, the retention does not block and the guard says so.
    const unreferenced = await checkSourceHealth(db, [jumped(targetedKey)]);
    expect(unreferenced.incidents).toMatchObject([{ guardWithoutReference: true, nonBlockingRetentionOnly: true }]);
    expect(issuesFromResult([jumped(targetedKey)], unreferenced.incidents).map(issue => issue.code)).toEqual(['NATIVE_RETENTION']);
  } finally {
    await db.pipelineEvent.deleteMany({ where: { runId: { in: [completeRun, targetedRun] } } });
    await db.pipelineRun.deleteMany({ where: { id: { in: [completeRun, targetedRun] } } });
  }
});
