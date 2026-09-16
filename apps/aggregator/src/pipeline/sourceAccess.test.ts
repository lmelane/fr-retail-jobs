import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { accessFixture } from '../test/sourceAccessFixture.js';
import { captureExtraction } from '../capture/batch.js';
import { readRequestData } from '../capture/requestDataRead.js';
import { noteUnsupportedTransport } from '../capture/context.js';
import { requireCurrentCaptureRevision } from '../connectors/sourceRevision.js';
import { assertSourceAccess, readLatestSourceAccess, recordSourceAccessDecision, requireSourceAccess } from '../connectors/sourceAccess.js';
import { captureSourceEvidence } from '../capture/sourceEvidence.js';
import { fetchJson } from '../lib/http.js';
import { sourceStatus } from '../onboarding/status.js';

const db = new PrismaClient(); const keys: string[] = [];
const url = 'https://access-witness.example/boards/maison/jobs?tenant=maison';
const config = { origin: 'https://access-witness.example' };
const reader = async () => ({ jobs: [], complete: true, declaredTotal: 0, diagnostic: await fetchJson(url) });
const create = async () => {
  const key = `access-${randomUUID()}`; keys.push(key);
  return db.source.create({ data: { key, maison: 'Synthetic access witness', kind: 'generic-listing', config,
    tier: 'EMPLOYER_DIRECT', tenantKey: key, status: 'DRAFT' } });
};
const capture = (source: Awaited<ReturnType<typeof create>>, work = reader, active = false) => captureExtraction(db,
  source.key, config, undefined, work, 'GENERIC_JSONLD', { revisionId: source.currentRevisionId, requireActive: active });
const native = () => { const fetch = vi.fn(async () => new Response('{"jobs":[]}')); vi.stubGlobal('fetch', fetch); return fetch; };
const prepared = async () => {
  const source = await create(); native(); const batch = await capture(source);
  const review = await accessFixture(db, source, batch.captureBatchId);
  return { source, batch, ...review };
};
const deny = (source: Awaited<ReturnType<typeof create>>) => recordSourceAccessDecision(db, {
  sourceKey: source.key, sourceRevisionId: source.currentRevisionId, captureBatchId: null, verdict: 'NOT_AUTHORIZED',
  scopes: [], robotsCaptureIds: [], statement: 'Synthetic reviewer explicitly revokes the scope for this source.', reviewer: 'test', checkedAt: new Date().toISOString(),
}, true);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await db.source.deleteMany({ where: { key: { in: keys } } }); await db.$disconnect(); });

describe('immutable native access decisions', () => {
  it('keeps DISALLOWED observed while applying the existing owner authorization, without activating or publishing', async () => {
    const { source, result } = await prepared();
    expect(result).toMatchObject({ verdict: 'ALLOWED', observations: { DISALLOWED: 1 }, requestCount: 1 });
    expect(await db.source.findUniqueOrThrow({ where: { key: source.key } })).toEqual(source);
    expect(await db.jobSource.count({ where: { sourceKey: source.key } })).toBe(0);
    expect(await sourceStatus(db, source.key)).toMatchObject({ access: { passed: true, revisionBound: true }, promotionGatesPass: false });
  });
  it('preview performs no decision write and replayed application cannot supersede a newer denial', async () => {
    const { source, document, result } = await prepared();
    const preview = await recordSourceAccessDecision(db, { ...document, statement: document.statement + ' Additional review.' });
    expect(preview).toMatchObject({ written: 0, isLatestDecision: null });
    expect(await db.sourceAccessDecision.count({ where: { sourceKey: source.key } })).toBe(1);
    await deny(source);
    const latest = await readLatestSourceAccess(db, [source.key]);
    expect([...latest.keys()]).toEqual([source.key]);
    expect(latest.get(source.key)?.verdict).toBe('NOT_AUTHORIZED');
    expect((await readLatestSourceAccess(db, [])).size).toBe(0);
    expect(await recordSourceAccessDecision(db, document, true)).toMatchObject({ decisionId: result.decisionId, written: 0, isLatestDecision: false });
    await expect(requireSourceAccess(db, source)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
  it('rejects stale revision, reader, expiry and a forged stored projection', async () => {
    const { source, result } = await prepared();
    const decision = await db.sourceAccessDecision.findUniqueOrThrow({ where: { id: result.decisionId } });
    for (const changed of [{ sourceRevisionId: 'other' }, { readerRevision: 'old' }, { validUntil: new Date(0) }, { policyVersion: 'unknown' }]) {
      expect(() => assertSourceAccess(source, { ...decision, ...changed })).toThrow();
    }
    expect(() => assertSourceAccess(source, { ...decision, report: {} })).toThrow();
    expect(() => assertSourceAccess(source, { ...decision, report: { ...(decision.report as Prisma.JsonObject), observations: { ALLOWED: 1, DISALLOWED: 0, NO_ROBOTS: 0, UNREACHABLE: 0 } } })).toThrow();
    await db.source.update({ where: { key: source.key }, data: { config: { origin: 'https://another.example' } } });
    await db.source.update({ where: { key: source.key }, data: { config } });
    const current = await db.source.findUniqueOrThrow({ where: { key: source.key } });
    await expect(requireSourceAccess(db, current)).rejects.toMatchObject({ code: 'ACCESS_STALE' });
    await expect(recordSourceAccessDecision(db, documentFor(decision), true)).rejects.toThrow();
  });
  it('requires the same revision and native purpose for every robots proof', async () => {
    const { source, document } = await prepared();
    const other = await create(); native(); const foreign = await capture(other);
    const otherReview = await accessFixture(db, other, foreign.captureBatchId);
    await expect(recordSourceAccessDecision(db, { ...document, robotsCaptureIds: otherReview.document.robotsCaptureIds })).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } })));
    const identity = await captureSourceEvidence(db, source.key, { revisionId: source.currentRevisionId, purpose: 'SOURCE_IDENTITY', url: config.origin + '/robots.txt', deadlineMs: 15000 });
    await expect(recordSourceAccessDecision(db, { ...document, robotsCaptureIds: [identity.captureBatchId] })).rejects.toThrow();
  });
  it.each(['method', 'query'] as const)('refuses an unobserved %s added inside an otherwise witnessed scope', async extra => {
    const { document } = await prepared();
    const scopes = structuredClone(document.scopes);
    if (extra === 'method') scopes[0].methods.push('POST');
    else scopes[0].query.variable.push('candidateId');
    await expect(recordSourceAccessDecision(db, { ...document, scopes })).rejects.toThrow();
  });
  it('refuses unsupported browser bootstrap even when the extracted result contains only HTTP responses', async () => {
    const source = await create(); native();
    const batch = await capture(source, async () => { noteUnsupportedTransport(); return reader(); });
    expect(await db.captureOutcome.findUniqueOrThrow({ where: { batchId: batch.captureBatchId } })).toMatchObject({ transportCoverage: 'UNSUPPORTED_TRANSPORT' });
    await expect(accessFixture(db, source, batch.captureBatchId)).rejects.toThrow(/HTTP-only/);
  });
  it.each(['html', 'invalid-utf8', 'oversize'])('rejects invalid robots bodies: %s', async mode => {
    const { source, document } = await prepared();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(mode === 'html' ? '<html>Sign in</html>' : mode === 'invalid-utf8' ? Buffer.from([0xff]) : 'x'.repeat(512001), { headers: { 'content-type': 'text/plain' } })));
    const proof = await captureSourceEvidence(db, source.key, { revisionId: source.currentRevisionId, purpose: 'SOURCE_ACCESS', url: config.origin + '/robots.txt', deadlineMs: 15000 });
    await expect(recordSourceAccessDecision(db, { ...document, robotsCaptureIds: [proof.captureBatchId] }, true)).rejects.toThrow();
  });
  it('retains NO_ROBOTS and UNREACHABLE as distinct observations', async () => {
    const { source, document } = await prepared();
    for (const [status, observation] of [[404, 'NO_ROBOTS'], [403, 'UNREACHABLE']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('Native response', { status })));
      const proof = await captureSourceEvidence(db, source.key, { revisionId: source.currentRevisionId, purpose: 'SOURCE_ACCESS', url: config.origin + '/robots.txt', deadlineMs: 15000 });
      expect(await recordSourceAccessDecision(db, { ...document, robotsCaptureIds: [proof.captureBatchId] })).toMatchObject({ observations: { [observation]: 1 } });
    }
  });
});

const documentFor = (decision: { document: Prisma.JsonValue }) => decision.document;

describe('collection and publication access boundaries', () => {
  it('blocks missing access before transport and batch allocation', async () => {
    const source = await create(); await db.source.update({ where: { key: source.key }, data: { status: 'ACTIVE' } });
    const transport = native();
    await expect(capture(source, reader, true)).rejects.toMatchObject({ code: 'ACCESS_MISSING' });
    expect(transport).not.toHaveBeenCalled();
    expect(await db.captureBatch.count({ where: { sourceKey: source.key } })).toBe(0);
  });
  it('binds the decision before transport and refuses publication after its revocation', async () => {
    const { source, result } = await prepared();
    await db.source.update({ where: { key: source.key }, data: { status: 'ACTIVE' } });
    const collected = await capture(source, reader, true);
    const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: collected.captureBatchId } });
    expect(batch.accessDecisionId).toBe(result.decisionId);
    await expect(requireCurrentCaptureRevision(db, batch)).resolves.toBeUndefined();
    await deny(source);
    await expect(requireCurrentCaptureRevision(db, batch)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    const transport = native();
    await expect(capture(source, reader, true)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('does not publish a qualification probe under a subsequently installed grant', async () => {
    const { source, batch } = await prepared();
    await db.source.update({ where: { key: source.key }, data: { status: 'ACTIVE' } });
    await expect(requireCurrentCaptureRevision(db, await db.captureBatch.findUniqueOrThrow({ where: { id: batch.captureBatchId } }))).rejects.toMatchObject({ code: 'ACCESS_SUPERSEDED' });
  });
  it('blocks an unexpected redirect before dispatch and remains failed when an adapter catches the refusal', async () => {
    const { source } = await prepared();
    await db.source.update({ where: { key: source.key }, data: { status: 'ACTIVE' } });
    const transport = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://unreviewed.example/private' } }));
    vi.stubGlobal('fetch', transport);
    await expect(capture(source, async () => {
      try { await reader(); } catch { /* A broken adapter cannot erase a refusal. */ }
      return { jobs: [], complete: true, declaredTotal: 0, diagnostic: {} };
    }, true)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    const latest = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: source.key, purpose: 'JOBS' }, orderBy: { attemptOrdinal: 'desc' }, include: { outcome: true } });
    expect(latest.outcome?.status).toBe('FAILED');
    const receipts = await db.rawCapture.findMany({ where: { batchId: latest.id } });
    expect(receipts).toHaveLength(1);
    const requestData = await readRequestData(db, receipts[0]);
    expect(requestData?.hops.map(hop => hop.request.url)).toEqual([url]);
    expect(requestData?.hops[0].status).toBe(302);
  });
  it('cannot certify a partial success after a swallowed scope failure', async () => {
    const { source } = await prepared();
    await db.source.update({ where: { key: source.key }, data: { status: 'ACTIVE' } });
    const transport = native();
    await expect(capture(source, async () => {
      await reader();
      try { await fetchJson('https://unreviewed.example/private'); } catch { /* Deliberate adapter defect. */ }
      return { jobs: [], complete: true, declaredTotal: 0, diagnostic: {} };
    }, true)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    const latest = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: source.key, purpose: 'JOBS' }, orderBy: { attemptOrdinal: 'desc' }, include: { outcome: true } });
    expect(latest.outcome?.status).toBe('FAILED');
    expect(await db.rawCapture.count({ where: { batchId: latest.id, complete: true } })).toBe(1);
  });
});

describe('SQL access evidence defenses', () => {
  it('refuses mutable decisions and fabricated native projections', async () => {
    const { result } = await prepared();
    const decision = await db.sourceAccessDecision.findUniqueOrThrow({ where: { id: result.decisionId } });
    await expect(db.sourceAccessDecision.update({ where: { id: decision.id }, data: { verdict: 'NOT_AUTHORIZED' } })).rejects.toThrow('immutable');
    await expect(db.sourceAccessDecision.delete({ where: { id: decision.id } })).rejects.toThrow('immutable');
    const report = decision.report as Prisma.JsonObject;
    for (const changed of [{ captureCount: 999 }, { requestCount: 0 }, { authorizationBasis: 'NONE' }, { robots: [] }, { scopeCounts: [] }]) {
      await expect(db.sourceAccessDecision.create({ data: { ...decision, sequence: undefined, id: randomUUID(), document: decision.document!, report: { ...report, ...changed } } })).rejects.toThrow();
    }
    await expect(db.sourceAccessDecision.create({ data: { ...decision, sequence: undefined, id: randomUUID(), document: decision.document!, report: Prisma.DbNull } })).rejects.toThrow();
  });
  it('rejects a direct collection binding to an older grant and cannot append historical access notes', async () => {
    const { source, result, batch } = await prepared(); await deny(source);
    const stored = await db.captureBatch.findUniqueOrThrow({ where: { id: batch.captureBatchId } });
    const { executionBudget, ...data } = stored;
    await expect(db.captureBatch.create({ data: { ...data, id: randomUUID(), attemptOrdinal: undefined, accessDecisionId: result.decisionId,
      executionBudget: executionBudget === null ? Prisma.DbNull : executionBudget } })).rejects.toThrow(/access decision/);
    await expect(db.sourceAccessArchive.create({ data: { sourceKey: source.key, sourceId: source.id, verdict: 'ALLOWED' } })).rejects.toThrow('immutable');
  });
});
