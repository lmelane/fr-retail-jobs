import '../test/setup-integration.js';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { captureSourceEvidence, readSourceEvidence } from '../capture/sourceEvidence.js';
import { captureExtraction, replayExtraction } from '../capture/batch.js';
import { readExtractionManifest } from '../capture/manifest.js';
import { readCapturedPublication } from '../capture/publication.js';
import { archiveRawBlob, readRawBlob, storeRawBlob } from '../capture/store.js';
import { fetchAtsJobs } from '../ats/index.js';
import { validateCapturedSource } from '../connectors/sourceValidation.js';
import { requireSourceValidation } from '../connectors/sourceCertification.js';
import { sourceStatus } from '../onboarding/status.js';
import type { ObjectStore } from '../retention/objectStore.js';
import { snapshotHosts } from '../observability/httpTelemetry.js';
import { rateLimitHits } from '../observability/rateLimitSignal.js';
import { cooldownRemainingMs } from '../lib/hostGate.js';

const db = new PrismaClient(); const keys: string[] = [];
async function create() {
  const key = `http-evidence-${randomUUID()}`; keys.push(key);
  return db.source.create({ data: { key, maison: 'Synthetic evidence fixture', kind: 'ashby',
    config: { board: key }, tier: 'ATS_OFFICIAL', tenantKey: key, status: 'DRAFT' } });
}
type Source = Awaited<ReturnType<typeof create>>;
const input = (source: Source) => ({ purpose: 'SOURCE_IDENTITY' as const, revisionId: source.currentRevisionId,
  url: `https://official.example/${source.key}`, deadlineMs: 15000 });
async function evidence(source: Source) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`<a href="https://jobs.ashbyhq.com/${source.key}">Careers</a>`, { headers: { 'content-type': 'text/html' } })));
  return captureSourceEvidence(db, source.key, input(source));
}
/** Model a structurally valid immutable journal with a dishonest manifest. The
 * reader must compare their content instead of trusting either shape alone. */
async function forgedManifest(change: (manifest: Record<string, any>) => void) {
  const source = await create(); const receipt = await evidence(source);
  const actual = await readSourceEvidence(db, receipt.captureBatchId);
  const batch = await db.captureBatch.create({ data: { purpose: 'SOURCE_IDENTITY', sourceKey: source.key,
    sourceRevisionId: source.currentRevisionId, sourceKind: actual.batch.sourceKind, formatVersion: 3,
    configHash: actual.batch.configHash, readerRevision: actual.batch.readerRevision } });
  const responses = [];
  for (const row of actual.responses) {
    const saved = await db.rawCapture.create({ data: { ...row, id: randomUUID(), batchId: batch.id,
      headers: row.headers as Prisma.InputJsonObject, cookieNames: row.cookieNames as Prisma.InputJsonArray } });
    const { batchId: _batch, capturedAt: _at, ...record } = saved; responses.push(record);
  }
  const manifest = JSON.parse((await readRawBlob(db, actual.batch.outcome!.manifestHash!)).toString());
  manifest.batchId = batch.id; manifest.responses = responses; change(manifest);
  const hash = await storeRawBlob(db, Buffer.from(JSON.stringify(manifest)));
  await db.captureOutcome.create({ data: { batchId: batch.id, status: 'SOURCE_EVIDENCE', extractedCount: 0, manifestHash: hash } });
  return batch.id;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await db.source.deleteMany({ where: { key: { in: keys } } }); await db.$disconnect(); });

it('retains exact responses, redirect provenance and cookie names without any job outputs or approval', async () => {
  const source = await create();
  const body = `<p>${source.key} — RAW &amp; untouched</p>`;
  const transport = vi.fn().mockResolvedValueOnce(new Response(`moved ${source.key}`, { status: 302,
    headers: { location: '/careers?market=fr#jobs', 'set-cookie': 'session=PRIVATE_COOKIE_VALUE; Path=/' } }))
    .mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  vi.stubGlobal('fetch', transport);
  const receipt = await captureSourceEvidence(db, source.key, input(source));
  expect(receipt).toMatchObject({ sourceRevisionId: source.currentRevisionId, purpose: 'SOURCE_IDENTITY', responseCount: 2, lastStatus: 200 });
  expect(transport).toHaveBeenCalledTimes(2);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Offline evidence verification must not use the network'); }));
  const read = await readSourceEvidence(db, receipt.captureBatchId);
  expect(read.body.toString()).toBe(body);
  expect(read.finalUrl).toBe('https://official.example/careers?market=fr');
  expect(read.batch).toMatchObject({ formatVersion: 3, attemptOrdinal: null, outcome: { status: 'SOURCE_EVIDENCE', extractedCount: 0, outputHash: null } });
  expect(read.responses.map(r => r.sequence)).toEqual([0, 1]);
  expect(read.responses[0]).toMatchObject({ cookieNames: ['session'], headers: { location: '/careers?market=fr#jobs' } });
  expect(JSON.stringify(read.responses)).not.toContain('PRIVATE_COOKIE_VALUE');
  expect(await db.sourceExtraction.count({ where: { batchId: receipt.captureBatchId } })).toBe(0);
  expect(await db.sourceValidation.count({ where: { sourceRevisionId: source.currentRevisionId } })).toBe(0);
  expect(await db.source.findUniqueOrThrow({ where: { key: source.key } })).toEqual(source);
});

it('archives an HTTP refusal without turning it into access authorization', async () => {
  const source = await create();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`Forbidden ${source.key}`, { status: 403 })));
  const receipt = await captureSourceEvidence(db, source.key, { ...input(source), purpose: 'SOURCE_ACCESS', url: 'https://official.example/robots.txt' });
  expect(receipt).toMatchObject({ purpose: 'SOURCE_ACCESS', lastStatus: 403 });
  expect((await readSourceEvidence(db, receipt.captureBatchId)).body.toString()).toBe(`Forbidden ${source.key}`);
  expect(await db.source.findUniqueOrThrow({ where: { key: source.key } })).toMatchObject({ robotsVerdict: null, robotsCheckedAt: null, status: 'DRAFT' });
});

it('counts the real redirect hosts and stops on throttling while preserving its response', async () => {
  const source = await create(); const first = `${source.key}.example`; const final = `final-${source.key}.example`;
  const target = `https://${final}/policy?token=PRIVATE_VALUE`;
  const transport = vi.fn().mockResolvedValueOnce(new Response('moved', { status: 302, headers: { location: target } }))
    .mockResolvedValueOnce(new Response(`throttled ${source.key}`, { status: 429, headers: { 'retry-after': '30' } }));
  vi.stubGlobal('fetch', transport);
  const receipt = await captureSourceEvidence(db, source.key, { ...input(source), url: `https://${first}/careers` });
  expect(receipt.lastStatus).toBe(429); expect(transport).toHaveBeenCalledTimes(2);
  expect(snapshotHosts().find(row => row.host === first)).toMatchObject({ attempts: 1, responses: 1, retries: 0, statuses: { 302: 1 } });
  expect(snapshotHosts().find(row => row.host === final)).toMatchObject({ attempts: 1, responses: 1, retries: 0, statuses: { 429: 1 } });
  // The ordinary spacing is only 80 ms. The explicit 30 s server cooldown
  // must survive independently of the cap on our adaptive pacing interval.
  expect(cooldownRemainingMs(target)).toBeGreaterThan(25_000);
  const hit = rateLimitHits().find(row => row.host === final);
  expect(hit).toMatchObject({ requestsLast1s: 1, retryAfterRaw: '30', appliedDelayMs: 0 });
  expect(hit!.url).not.toContain('PRIVATE_VALUE');
  expect((await readSourceEvidence(db, receipt.captureBatchId)).body.toString()).toBe(`throttled ${source.key}`);
});

it('does not supersede a validated job capture when identity or access pages are captured later', async () => {
  const source = await create();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ apiVersion: '1', jobs: [], fixture: source.key }))));
  const jobCapture = await captureExtraction(db, source.key, source.config as Record<string, unknown>, undefined,
    config => fetchAtsJobs('ASHBY', config), 'ASHBY');
  const validated = await validateCapturedSource(db, jobCapture.captureBatchId);
  expect(validated.verdict).toBe('VALIDATED');
  await evidence(source);
  await captureSourceEvidence(db, source.key, { ...input(source), purpose: 'SOURCE_ACCESS' });
  expect((await db.$transaction(tx => requireSourceValidation(tx, source.currentRevisionId))).id).toBe(validated.id);
  expect(await sourceStatus(db, source.key)).toMatchObject({ latestCaptureAttempt: { id: jobCapture.captureBatchId }, native: { passed: true } });
});

it('refuses stale revisions and invalid purposes before making a network request', async () => {
  const source = await create(); const transport = vi.fn(); vi.stubGlobal('fetch', transport);
  await expect(captureSourceEvidence(db, source.key, { ...input(source), revisionId: 'obsolete' })).rejects.toThrow('changed before collection');
  await expect(captureSourceEvidence(db, source.key, { ...input(source), purpose: 'JOBS' as never })).rejects.toThrow('Invalid source evidence');
  expect(transport).not.toHaveBeenCalled();
  expect(await db.captureBatch.count({ where: { sourceKey: source.key } })).toBe(0);
});

it('keeps an obsolete capture inspectable after a concurrent source configuration change', async () => {
  const source = await create();
  vi.stubGlobal('fetch', vi.fn(async () => {
    await db.source.update({ where: { key: source.key }, data: { config: { board: `${source.key}-new` } } });
    return new Response(`Observed before revision change ${source.key}`);
  }));
  const receipt = await captureSourceEvidence(db, source.key, input(source));
  expect(receipt.sourceRevisionId).toBe(source.currentRevisionId);
  expect((await readSourceEvidence(db, receipt.captureBatchId)).batch.sourceRevisionId).toBe(source.currentRevisionId);
  expect((await db.source.findUniqueOrThrow({ where: { key: source.key } })).currentRevisionId).not.toBe(source.currentRevisionId);
});

it('preserves partial response bytes on a stream failure and never seals them as usable source evidence', async () => {
  const source = await create(); let chunks = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ async pull(controller) {
    if (!chunks++) controller.enqueue(Buffer.from(`partial ${source.key}`));
    // Let the response consumer receive the first chunk before the connection
    // fails. An already errored stream discards its unread queue by design.
    else { await new Promise<void>(resolve => setImmediate(resolve)); controller.error(new Error('Stream interrupted')); }
  } }))));
  await expect(captureSourceEvidence(db, source.key, input(source))).rejects.toThrow();
  const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: source.key }, include: { outcome: true, captures: true } });
  expect(batch).toMatchObject({ purpose: 'SOURCE_IDENTITY', attemptOrdinal: null, outcome: { status: 'FAILED' } });
  expect(batch.captures).toHaveLength(1);
  expect(batch.captures[0]).toMatchObject({ complete: false, failure: 'IncompleteBodyError' });
  expect((await readRawBlob(db, batch.captures[0].blobHash!)).toString()).toBe(`partial ${source.key}`);
  await expect(readSourceEvidence(db, batch.id)).rejects.toThrow('Completed source evidence');
});

it('freezes the reviewed evidence request before asynchronous registry reads', async () => {
  const source = await create(); const options = { ...input(source), purpose: 'SOURCE_IDENTITY' as 'SOURCE_IDENTITY' | 'SOURCE_ACCESS' };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`frozen ${source.key}`)));
  const pending = captureSourceEvidence(db, source.key, options);
  options.purpose = 'SOURCE_ACCESS'; options.revisionId = 'changed-after-call'; options.url = 'https://other.example/changed';
  expect(await pending).toMatchObject({ purpose: 'SOURCE_IDENTITY', sourceRevisionId: source.currentRevisionId });
});

it('retains the first response but refuses a redirect to an internal address', async () => {
  const source = await create(); const transport = vi.fn(async () => new Response(`redirect ${source.key}`, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
  vi.stubGlobal('fetch', transport);
  await expect(captureSourceEvidence(db, source.key, input(source))).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
  const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: source.key }, include: { outcome: true, captures: true } });
  expect(batch.captures).toHaveLength(1); expect(batch.outcome?.status).toBe('FAILED');
});

it('records a failed request and makes its receipt inspectable without claiming an HTTP response', async () => {
  const source = await create();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Connection failed'); }));
  await expect(captureSourceEvidence(db, source.key, input(source))).rejects.toThrow('Connection failed');
  const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: source.key }, include: { outcome: true, captures: true } });
  expect(batch.captures).toHaveLength(1);
  expect(batch.captures[0]).toMatchObject({ status: null, complete: false, blobHash: null, failure: 'TypeError' });
  expect(await sourceStatus(db, source.key)).toMatchObject({ latestCaptureAttempt: null,
    evidenceCaptures: [{ id: batch.id, purpose: 'SOURCE_IDENTITY', outcome: { status: 'FAILED' }, captures: [{ id: batch.captures[0].id, status: null }] }] });
});

it('cannot reinterpret source evidence as extraction, qualification or a job publication', async () => {
  const source = await create(); const receipt = await evidence(source);
  await expect(validateCapturedSource(db, receipt.captureBatchId)).rejects.toThrow('completed registered native capture');
  await expect(replayExtraction(db, receipt.captureBatchId, async () => ({ jobs: [] }))).rejects.toThrow('not a replayable job');
  await expect(readExtractionManifest(db, receipt.captureBatchId)).rejects.toThrow('not a job extraction');
  await expect(readCapturedPublication(db, { sourceKey: source.key, externalId: 'invented', captureBatchId: receipt.captureBatchId, captureOutputId: 'invented' })).rejects.toThrow('invalid capture');
  const hash = await storeRawBlob(db, Buffer.from(`invented output ${source.key}`));
  await expect(db.sourceExtraction.create({ data: { batchId: receipt.captureBatchId, ordinal: 0, externalId: 'invented', outputHash: hash } })).rejects.toThrow('Only job captures');
  await expect(db.sourceValidation.create({ data: { sourceRevisionId: source.currentRevisionId, captureBatchId: receipt.captureBatchId,
    readerRevision: 'invented', policyVersion: 'invented', verdict: 'VALIDATED', report: {} } })).rejects.toThrow('completed job capture');
  await expect(db.sourceObservation.create({ data: { sourceKey: source.key, externalId: 'invented', contentHash: hash,
    raw: {}, pipelineVersion: 1, captureBatchId: receipt.captureBatchId } })).rejects.toThrow('cannot attest a job');
  await expect(db.jobSource.create({ data: { sourceKey: source.key, sourceTier: 'ATS_OFFICIAL', externalId: 'invented',
    url: 'https://official.example/jobs/1', isActive: false, quarantinedAt: new Date(), quarantineReason: 'TEST_FIXTURE',
    captureBatchId: receipt.captureBatchId } })).rejects.toThrow('cannot attest a job');
  await expect(db.captureBatch.update({ where: { id: receipt.captureBatchId }, data: { purpose: 'JOBS' } })).rejects.toThrow('immutable');
});

it('rejects a manifest that changes one recorded response status', async () => {
  const id = await forgedManifest(manifest => { manifest.responses[0].status = 201; });
  await expect(readSourceEvidence(db, id)).rejects.toThrow('manifest differs');
});

it('rejects a page attributed to a different requested URL', async () => {
  const id = await forgedManifest(manifest => { manifest.initialUrl = 'https://other.example/not-the-observed-page'; });
  await expect(readSourceEvidence(db, id)).rejects.toThrow('redirect provenance differs');
});

it('reads the complete source evidence after hot bodies have been removed using verified archives', async () => {
  const source = await create(); const receipt = await evidence(source);
  const original = await readSourceEvidence(db, receipt.captureBatchId);
  const objects = new Map<string, Uint8Array>();
  const store: ObjectStore = { async put(key, body) { objects.set(key, new Uint8Array(body)); return { etag: null }; },
    async get(key) { const body = objects.get(key); if (!body) throw new Error('Missing test archive'); return body; },
    uri: key => `memory://${source.key}/${key}`, describe: () => ({ provider: 'TEST', bucket: source.key, prefix: 'test', endpoint: 'memory://isolated', region: 'test' }) };
  for (const hash of new Set([original.batch.outcome!.manifestHash!, ...original.responses.flatMap(row => [row.blobHash!, row.requestDataHash!])])) {
    expect(await archiveRawBlob(db, hash, store)).toEqual({ purged: true });
  }
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network fallback'); }));
  expect((await readSourceEvidence(db, receipt.captureBatchId, store)).body).toEqual(original.body);
  await expect(readSourceEvidence(db, receipt.captureBatchId)).rejects.toThrow('archive location unavailable');
  const [key, bytes] = objects.entries().next().value!; objects.set(key, new Uint8Array([...bytes, 0]));
  await expect(readSourceEvidence(db, receipt.captureBatchId, store)).rejects.toThrow('integrity mismatch');
});

it('reads the original v1 manifest projection without pretending the new request column existed', async () => {
  const id = await forgedManifest(manifest => {
    manifest.version = 1;
    manifest.responses = manifest.responses.map(({ requestDataHash: _new, ...row }: Record<string, unknown>) => row);
  });
  expect((await readSourceEvidence(db, id)).body.length).toBeGreaterThan(0);
});
