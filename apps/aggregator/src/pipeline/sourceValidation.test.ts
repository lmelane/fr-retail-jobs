import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { captureExtraction } from '../capture/batch.js';
import { fetchAtsJobs } from '../ats/index.js';
import { captureSourceForValidation, validateCapturedSource } from '../connectors/sourceValidation.js';
import { requireSourceValidation, SOURCE_VALIDATION_MAX_AGE_MS } from '../connectors/sourceCertification.js';
import { archiveRawBlob } from '../capture/store.js';
import { MemoryStore } from '../test/memoryObjectStore.js';

const db = new PrismaClient(); const keys: string[] = [];
const nativeJob = { id: 'native-1', title: 'Client Advisor', isListed: true, descriptionPlain: 'Native responsibilities',
  jobUrl: 'https://jobs.ashbyhq.com/validation/native-1', address: { postalAddress: { addressCountry: 'FR', addressLocality: 'Paris' } } };
async function capture(jobs: object[] = [nativeJob], corruptOutput = false) {
  const key = `source-validation-${randomUUID()}`; keys.push(key); const config = { board: 'validation' };
  const source = await db.source.create({ data: { key, tenantKey: key, maison: 'Validation witness', kind: 'ashby', config, tier: 'EMPLOYER_DIRECT' } });
  const nativeRows = jobs.map((job, index) => ({ ...job, id: `${key}-${index}`, jobUrl: `https://jobs.ashbyhq.com/validation/${key}-${index}` }));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ apiVersion: '1', jobs: nativeRows, witness: key }))));
  await captureExtraction(db, key, config, undefined, async settings => {
    const result = await fetchAtsJobs('ASHBY', settings);
    if (corruptOutput && result.jobs[0]) result.jobs[0].title = 'Invented reader title';
    return result;
  }, 'ASHBY');
  const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: key } });
  const network = vi.fn(async () => { throw new Error('Live network forbidden while validating'); }); vi.stubGlobal('fetch', network);
  return { source, batch, network };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(async () => { await db.source.deleteMany({ where: { key: { in: keys } } }); await db.$disconnect(); });

describe('native source validation', () => {
  it('collects registered settings and keeps the batch receipt even for an empty native feed', async () => {
    const key = `source-validation-${randomUUID()}`; keys.push(key);
    const source = await db.source.create({ data: { key, tenantKey: key, maison: key, kind: 'ashby', config: { board: key }, tier: 'ATS_OFFICIAL' } });
    const network = vi.fn(async () => new Response(JSON.stringify({ apiVersion: '1', jobs: [], witness: key })));
    vi.stubGlobal('fetch', network);
    const validation = await captureSourceForValidation(db, key, 30_000);
    expect(validation).toMatchObject({ sourceRevisionId: source.currentRevisionId, verdict: 'VALIDATED', report: { nativeEmpty: true } });
    expect(network).toHaveBeenCalledTimes(1);
    expect((await db.captureBatch.findUniqueOrThrow({ where: { id: validation.captureBatchId } })).executionBudget).toMatchObject({ timeoutMs: 30_000 });
    expect((await db.source.findUniqueOrThrow({ where: { key } })).status).toBe('DRAFT');
  });

  it('derives its count from exact replay and qualified native content without live network', async () => {
    const { source, batch, network } = await capture();
    const validation = await validateCapturedSource(db, batch.id);
    expect(validation).toMatchObject({ sourceRevisionId: source.currentRevisionId, captureBatchId: batch.id, verdict: 'VALIDATED',
      report: { replayExact: true, observed: 1, qualified: 1, held: 0, rejected: 0, nativeEmpty: false, reasons: {} } });
    expect((await requireSourceValidation(db, source.currentRevisionId)).id).toBe(validation.id);
    expect(network).not.toHaveBeenCalled();
    expect((await db.source.findUniqueOrThrow({ where: { key: source.key } })).status).toBe('DRAFT');
  });

  it('accepts an actual empty Ashby native feed without inventing a positive job count', async () => {
    const { source, batch, network } = await capture([]);
    const validation = await validateCapturedSource(db, batch.id);
    expect(validation).toMatchObject({ verdict: 'VALIDATED', report: { observed: 0, qualified: 0, nativeEmpty: true } });
    expect((await requireSourceValidation(db, source.currentRevisionId)).id).toBe(validation.id);
    expect(network).not.toHaveBeenCalled();
  });

  it('accepts an empty Teamtailor JSON Feed only when it is the single, complete feed (no next page)', async () => {
    // Prémisse : le flux natif est vide ET termine (aucun next_url) ; une page vide qui annonce une suite n'est pas un flux vide.
    const feed = async (key: string, next?: string) => {
      keys.push(key); const origin = `https://careers.${key}.example`;
      await db.source.create({ data: { key, tenantKey: key, maison: key, kind: 'teamtailor', config: { origin }, tier: 'EMPLOYER_DIRECT' } });
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: key, home_page_url: `${origin}/jobs`,
        feed_url: `${origin}/jobs.json`, items: [], ...(next ? { next_url: next } : {}) }), { headers: { 'content-type': 'application/feed+json' } })));
      return captureSourceForValidation(db, key, 30_000);
    };
    expect(await feed(`source-validation-${randomUUID()}`)).toMatchObject({ verdict: 'VALIDATED', report: { observed: 0, qualified: 0, nativeEmpty: true } });
    const continued = await feed(`source-validation-${randomUUID()}`, 'https://careers.other.example/jobs.json?page=2').catch(error => error as Error);
    expect(continued instanceof Error ? continued.message : JSON.stringify(continued.report)).not.toMatch(/"nativeEmpty":true/);
  });

  it('refuses an empty collector result without a qualified native empty-feed protocol', async () => {
    const key = `source-validation-${randomUUID()}`; keys.push(key);
    await db.source.create({ data: { key, tenantKey: key, maison: key, kind: 'greenhouse', config: { board: key }, tier: 'ATS_OFFICIAL' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ jobs: [], witness: key }))));
    const validation = await captureSourceForValidation(db, key, 30_000);
    expect(validation).toMatchObject({ verdict: 'REJECTED', report: { observed: 0, nativeEmpty: false,
      reasons: { EMPTY_FEED_NOT_NATIVELY_PROVEN: 1 } } });
  });

  it.each([
    { job: { ...nativeJob, descriptionPlain: undefined }, reason: 'CONTENT_MISSING' },
    { job: { ...nativeJob, isListed: false }, reason: 'NO_QUALIFIED_PUBLICATION' },
  ])('rejects unqualified or entirely held publications: $reason', async ({ job, reason }) => {
    const { source, batch } = await capture([job]);
    const validation = await validateCapturedSource(db, batch.id);
    expect(validation).toMatchObject({ verdict: 'REJECTED', report: { reasons: { [reason]: 1 } } });
    await expect(requireSourceValidation(db, source.currentRevisionId)).rejects.toMatchObject({ name: 'SourceValidationGateError', code: 'VALIDATION_MISSING' });
  });

  it('rejects a captured derived value that the current reader cannot reproduce from native bytes', async () => {
    const { batch, network } = await capture([nativeJob], true);
    expect(await validateCapturedSource(db, batch.id)).toMatchObject({ verdict: 'REJECTED', report: { replayExact: false, reasons: { REPLAY_RESULT_CHANGED: 1 } } });
    expect(network).not.toHaveBeenCalled();
  });

  it('does not hide unreadable native rows behind the successfully parsed subset', async () => {
    const { batch } = await capture([nativeJob, { ...nativeJob, title: undefined }]);
    expect(await validateCapturedSource(db, batch.id)).toMatchObject({ verdict: 'REJECTED',
      report: { qualified: 1, inputRejected: 1, reasons: { REJECTED_NATIVE_ROWS: 1 } } });
  });

  it.each(['truncated', 'duplicate'] as const)('rejects an exactly replayable but %s source result', async mode => {
    const key = `validation-${randomUUID()}`; keys.push(key);
    const config = mode === 'truncated' ? { site: key, maxPages: 1 } : { board: key };
    const kind = mode === 'truncated' ? 'lever' : 'greenhouse';
    const ats = mode === 'truncated' ? 'LEVER' : 'GREENHOUSE';
    await db.source.create({ data: { key, tenantKey: key, maison: key, kind, config, tier: 'ATS_OFFICIAL' } });
    const raw = mode === 'truncated'
      ? Array.from({ length: 100 }, (_, index) => ({ id: `${key}-${index}`, text: 'Advisor', hostedUrl: `https://jobs.lever.co/${key}/${index}`, descriptionPlain: key }))
      : { jobs: [0, 1].map(() => ({ id: 123, title: 'Advisor', absolute_url: `https://job-boards.greenhouse.io/${key}/jobs/123`, content: key })) };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(raw))));
    await captureExtraction(db, key, config, undefined, settings => fetchAtsJobs(ats, settings), ats);
    const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: key } });
    const network = vi.fn(async () => { throw new Error('Offline only'); }); vi.stubGlobal('fetch', network);
    expect(await validateCapturedSource(db, batch.id)).toMatchObject({ verdict: 'REJECTED', report: {
      replayExact: true, reasons: { [mode === 'truncated' ? 'ENUMERATION_INCOMPLETE' : 'DUPLICATE_PUBLICATION_IDS']: 1 },
    } });
    expect(network).not.toHaveBeenCalled();
  });

  it('cannot transfer validation to a later A to B to A revision', async () => {
    const { source, batch } = await capture(); await validateCapturedSource(db, batch.id);
    await db.source.update({ where: { key: source.key }, data: { config: { board: 'another' } } });
    const current = await db.source.update({ where: { key: source.key }, data: { config: { board: 'validation' } } });
    await expect(requireSourceValidation(db, current.currentRevisionId)).rejects.toMatchObject({ name: 'SourceValidationGateError', code: 'VALIDATION_MISSING' });
  });

  it('requires native observations from the last 24 hours even if just revalidated', async () => {
    const { source, batch } = await capture(); await validateCapturedSource(db, batch.id);
    await expect(requireSourceValidation(db, source.currentRevisionId, new Date(batch.startedAt.getTime() + SOURCE_VALIDATION_MAX_AGE_MS + 1))).rejects.toMatchObject({ name: 'SourceValidationGateError', code: 'CAPTURE_STALE' });
  });

  it.each(['reader', 'policy', 'rejection'] as const)('a later %s mismatch supersedes a valid decision even with an older timestamp', async mode => {
    const { source, batch } = await capture(); const original = await validateCapturedSource(db, batch.id);
    const { id: _id, sequence: _sequence, ...data } = original;
    const newer = await db.sourceValidation.create({ data: { ...data, report: {}, validatedAt: new Date(original.validatedAt.getTime() - 1),
      ...(mode === 'reader' ? { readerRevision: 'old-reader' } : mode === 'policy' ? { policyVersion: 'old-policy' } : { verdict: 'REJECTED' }) } });
    expect(newer.sequence > original.sequence).toBe(true);
    await expect(requireSourceValidation(db, source.currentRevisionId)).rejects.toMatchObject({ name: 'SourceValidationGateError', code: mode === 'rejection' ? 'VALIDATION_MISSING' : 'READER_STALE' });
  });

  it('refuses a native observation dated in the future', async () => {
    const { source, batch } = await capture(); await validateCapturedSource(db, batch.id);
    await expect(requireSourceValidation(db, source.currentRevisionId, new Date(batch.startedAt.getTime() - 300_001))).rejects.toMatchObject({ name: 'SourceValidationGateError', code: 'CAPTURE_STALE' });
  });

  it.each(['FAILED', 'IN_PROGRESS', 'BACKDATED_FAILED'] as const)('a later %s attempt prevents reviving an earlier validation regardless of its timestamp', async status => {
    const { source, batch } = await capture(); await validateCapturedSource(db, batch.id);
    const next = await db.captureBatch.create({ data: { sourceKey: source.key, sourceRevisionId: source.currentRevisionId,
      configHash: batch.configHash, readerRevision: batch.readerRevision, sourceKind: batch.sourceKind, formatVersion: 2,
      startedAt: new Date(batch.startedAt.getTime() - (status === 'BACKDATED_FAILED' ? 60_000 : 0)) } });
    if (status !== 'IN_PROGRESS') await db.captureOutcome.create({ data: { batchId: next.id, status: 'FAILED', extractedCount: 0, failure: 'fixture' } });
    await expect(requireSourceValidation(db, source.currentRevisionId)).rejects.toMatchObject({ name: 'SourceValidationGateError', code: 'CAPTURE_SUPERSEDED' });
    await validateCapturedSource(db, batch.id);
    await expect(requireSourceValidation(db, source.currentRevisionId)).rejects.toMatchObject({ name: 'SourceValidationGateError', code: 'CAPTURE_SUPERSEDED' });
  });

  it('a real later parsing failure blocks activation despite an earlier success', async () => {
    const { source, batch } = await capture(); await validateCapturedSource(db, batch.id);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ apiVersion: '1', jobs: 'broken schema' }))));
    await expect(captureExtraction(db, source.key, { board: 'validation' }, undefined,
      settings => fetchAtsJobs('ASHBY', settings), 'ASHBY')).rejects.toThrow('ASHBY_INVALID_FEED');
    await expect(requireSourceValidation(db, source.currentRevisionId)).rejects.toMatchObject({ name: 'SourceValidationGateError', code: 'CAPTURE_SUPERSEDED' });
  });

  it('requires recollection for a native capture whose historical attempt order is unknown', async () => {
    const { source, batch } = await capture(); await validateCapturedSource(db, batch.id);
    // Simulate a pre-migration null under a rolled-back fault injection. The
    // actual migration never assigns an invented order to historical captures.
    await expect(db.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE "CaptureBatch" DISABLE TRIGGER "CaptureBatch_immutable"');
      await tx.captureBatch.update({ where: { id: batch.id }, data: { attemptOrdinal: null } });
      await expect(requireSourceValidation(tx, source.currentRevisionId)).rejects.toMatchObject({ name: 'SourceValidationGateError', code: 'ATTEMPT_ORDER_UNKNOWN' });
      throw new Error('ROLLBACK_HISTORICAL_WITNESS');
    })).rejects.toMatchObject({ message: 'ROLLBACK_HISTORICAL_WITNESS' });
    expect((await db.captureBatch.findUniqueOrThrow({ where: { id: batch.id } })).attemptOrdinal).toBe(batch.attemptOrdinal);
  });

  it.each([1, 2])('cannot certify an unsealed or failed capture, format %s', async formatVersion => {
    const { source, batch } = await capture(); const good = await validateCapturedSource(db, batch.id);
    const open = await db.captureBatch.create({ data: { sourceKey: source.key, sourceRevisionId: source.currentRevisionId,
      configHash: batch.configHash, readerRevision: batch.readerRevision, sourceKind: batch.sourceKind, formatVersion } });
    const { id: _id, sequence: _sequence, ...data } = good;
    const invalid = { ...data, captureBatchId: open.id, report: {} };
    await expect(db.sourceValidation.create({ data: invalid })).rejects.toThrow('completed job capture');
    await db.captureOutcome.create({ data: { batchId: open.id, status: 'FAILED', extractedCount: 0, failure: 'fixture' } });
    await expect(db.sourceValidation.create({ data: invalid })).rejects.toThrow('completed job capture');
    await expect(validateCapturedSource(db, open.id)).rejects.toThrow('completed registered');
  });

  it('retains immutable decisions and rejects a capture from a different revision in SQL', async () => {
    const a = await capture(), b = await capture(); const validation = await validateCapturedSource(db, a.batch.id);
    await expect(db.sourceValidation.update({ where: { id: validation.id }, data: { verdict: 'REJECTED' } })).rejects.toThrow('immutable');
    await expect(db.sourceValidation.delete({ where: { id: validation.id } })).rejects.toThrow('immutable');
    await expect(db.sourceValidation.create({ data: { sourceRevisionId: b.source.currentRevisionId, captureBatchId: a.batch.id,
      readerRevision: validation.readerRevision, policyVersion: validation.policyVersion, verdict: 'VALIDATED', report: {} } })).rejects.toThrow('same revision');
  });

  it('replays and qualifies a fully archived capture through the same verifier', async () => {
    const { batch, network } = await capture(); const store = new MemoryStore();
    const outcome = await db.captureOutcome.findUniqueOrThrow({ where: { batchId: batch.id } });
    const captures = await db.rawCapture.findMany({ where: { batchId: batch.id } });
    const outputs = await db.sourceExtraction.findMany({ where: { batchId: batch.id } });
    const hashes = new Set([outcome.manifestHash!, ...captures.map(row => row.blobHash!), ...outputs.map(row => row.outputHash)]);
    for (const hash of hashes) await archiveRawBlob(db, hash, store);
    expect(await validateCapturedSource(db, batch.id, store)).toMatchObject({ verdict: 'VALIDATED' });
    expect(network).not.toHaveBeenCalled();
    const unavailable = new MemoryStore();
    const rejected = await validateCapturedSource(db, batch.id, unavailable);
    expect(rejected).toMatchObject({ verdict: 'REJECTED', report: { replayExact: false, reasons: { REPLAY_OR_NATIVE_READING_FAILED: 1 } } });
    await expect(requireSourceValidation(db, rejected.sourceRevisionId)).rejects.toMatchObject({ name: 'SourceValidationGateError', code: 'VALIDATION_MISSING' });
  });
});
