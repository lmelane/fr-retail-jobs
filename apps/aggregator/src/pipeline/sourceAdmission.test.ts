import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { admissionFixture } from '../test/sourceAdmissionFixture.js';
import { accessFixture } from '../test/sourceAccessFixture.js';
import { captureIdentityFixture } from '../test/sourceIdentityFixture.js';
import { recordSourceIdentityReview } from '../connectors/sourceIdentity.js';
import { recordSourceAccessDecision } from '../connectors/sourceAccess.js';
import { SOURCE_ADMISSION_POLICY } from '../connectors/sourceAdmission.js';
import { validateCapturedSource } from '../connectors/sourceValidation.js';
import * as validationModule from '../connectors/sourceValidation.js';
import { captureExtraction } from '../capture/batch.js';
import { requireCurrentCaptureRevision } from '../connectors/sourceRevision.js';
import { fetchAtsJobs } from '../ats/index.js';
import { upsertDeduplicated } from '../dedup/upsert.js';
import { runIngest, toCandidate } from './ingest.js';
import { sourceStatus } from '../onboarding/status.js';

const db = new PrismaClient();
const config = { board: 'admission' };
const payload = { apiVersion: '1', jobs: [{ id: 'admission-1', title: 'Client Advisor', isListed: true, descriptionPlain: 'Native responsibilities' }] };
const native = () => { const network = vi.fn(async () => new Response(JSON.stringify(payload))); vi.stubGlobal('fetch', network); return network; };
const collect = (source: { key: string; currentRevisionId: string }, active = false, corrupt = false) => captureExtraction(db, source.key, config, undefined,
  async settings => { const result = await fetchAtsJobs('ASHBY', settings); if (corrupt) result.jobs[0].title = 'Invented output'; return result; },
  'ASHBY', { revisionId: source.currentRevisionId, requireActive: active });
async function prepare(gates = true) {
  const key = `admission-${randomUUID()}`;
  const source = await db.source.create({ data: { key, maison: key, tenantKey: key, kind: 'ashby', config, tier: 'EMPLOYER_DIRECT', status: 'ACTIVE' } });
  native(); const probe = await collect(source);
  const qualifications = gates ? await admissionFixture(db, source, probe.captureBatchId) : null;
  return { source, probe, qualifications };
}
const stored = (id: string) => db.captureBatch.findUniqueOrThrow({ where: { id }, include: { ingestionAdmission: true } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(async () => { await db.$executeRaw`TRUNCATE "SourceIngestionAdmission", "SourceIdentityReview"`; await db.$disconnect(); });

describe('native ingestion admission', () => {
  it('snapshots the requested ingestion binding before the first asynchronous boundary', async () => {
    const { source } = await prepare(false);
    const network = native();
    const binding = { revisionId: source.currentRevisionId, requireActive: true };
    const pending = captureExtraction(db, source.key, config, undefined, settings => fetchAtsJobs('ASHBY', settings), 'ASHBY', binding);
    binding.requireActive = false;
    await expect(pending).rejects.toMatchObject({ code: 'ACCESS_MISSING' });
    expect(network).not.toHaveBeenCalled();
  });

  it.each(['identity', 'validation'])('blocks missing %s before network or batch allocation despite ACTIVE status and access', async missing => {
    const { source, probe } = await prepare(false);
    await accessFixture(db, source, probe.captureBatchId);
    if (missing === 'identity') await validateCapturedSource(db, probe.captureBatchId);
    else await recordSourceIdentityReview(db, await captureIdentityFixture(db, source), true);
    const before = await db.captureBatch.count({ where: { sourceKey: source.key } });
    const network = native();
    await expect(collect(source, true)).rejects.toMatchObject({ code: missing === 'identity' ? 'REVIEW_MISSING' : 'VALIDATION_MISSING' });
    expect(network).not.toHaveBeenCalled();
    expect(await db.captureBatch.count({ where: { sourceKey: source.key } })).toBe(before);
  });

  it('records all admission decisions and demands validation of the newly observed bytes before publication', async () => {
    const { source, qualifications } = await prepare();
    const result = await collect(source, true), batch = await stored(result.captureBatchId);
    expect(batch.ingestionAdmission).toMatchObject({ identityReviewId: qualifications!.identity.reviewId,
      sourceValidationId: qualifications!.validation.id, policyVersion: SOURCE_ADMISSION_POLICY });
    expect(batch.accessDecisionId).toBe(qualifications!.result.decisionId);
    expect((await sourceStatus(db, source.key)).latestCaptureAttempt).toMatchObject({
      accessDecisionId: batch.accessDecisionId, ingestionAdmission: { identityReviewId: qualifications!.identity.reviewId,
        sourceValidationId: qualifications!.validation.id, policyVersion: SOURCE_ADMISSION_POLICY } });
    await expect(requireCurrentCaptureRevision(db, batch)).rejects.toMatchObject({ code: 'CAPTURE_SUPERSEDED' });
    const validation = await validateCapturedSource(db, batch.id);
    expect(validation.verdict).toBe('VALIDATED');
    await expect(requireCurrentCaptureRevision(db, batch)).resolves.toBeUndefined();
    const candidate = toCandidate(result.jobs[0], { key: source.key, tier: 'EMPLOYER_DIRECT', company: source.maison }, source.maison, 'ASHBY');
    await expect(upsertDeduplicated(db, candidate)).resolves.toMatchObject({ outcome: 'CREATED' });
    const second = await collect(source, true);
    expect((await stored(second.captureBatchId)).ingestionAdmission?.sourceValidationId).toBe(validation.id);
  });

  it('blocks an expired technical qualification before transport without borrowing the newer access lifetime', async () => {
    const { source } = await prepare();
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    const network = native();
    await expect(collect(source, true)).rejects.toMatchObject({ code: 'CAPTURE_STALE' });
    expect(network).not.toHaveBeenCalled();
  });

  it.each(['CONTRADICTED', 'UNRESOLVED'] as const)('blocks a later %s identity decision despite the earlier positive review', async verdict => {
    const { source } = await prepare();
    const document = await captureIdentityFixture(db, source, { status: 403, body: 'Unavailable' });
    await recordSourceIdentityReview(db, { ...document, verdict, portalScope: null }, true);
    const network = native();
    await expect(collect(source, true)).rejects.toMatchObject({ code: 'REVIEW_MISSING' });
    expect(network).not.toHaveBeenCalled();
  });

  it('blocks after a newer technical rejection and retains its actual native evidence', async () => {
    const { source } = await prepare(); const rejected = await collect(source, false, true);
    expect((await validateCapturedSource(db, rejected.captureBatchId)).verdict).toBe('REJECTED');
    const network = native();
    await expect(collect(source, true)).rejects.toMatchObject({ code: 'VALIDATION_MISSING' });
    expect(network).not.toHaveBeenCalled();
    expect(await db.rawCapture.count({ where: { batchId: rejected.captureBatchId } })).toBe(1);
  });

  it('serializes two simultaneous starts so only one can use the previous calibration', async () => {
    const { source } = await prepare(); const network = native();
    const results = await Promise.allSettled([collect(source, true), collect(source, true)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('does not let a failed admitted collection leave its old qualification reusable', async () => {
    const { source } = await prepare();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    await expect(collect(source, true)).rejects.toThrow('ASHBY_INVALID_FEED');
    const network = native();
    await expect(collect(source, true)).rejects.toMatchObject({ code: 'CAPTURE_SUPERSEDED' });
    expect(network).not.toHaveBeenCalled();
  });

  it.each(['identity', 'access', 'validation', 'newer-attempt', 'newer-validation'] as const)('rejects publication when %s changes during collection', async change => {
    const { source } = await prepare(); const collected = await collect(source, true);
    await validateCapturedSource(db, collected.captureBatchId);
    const batch = await stored(collected.captureBatchId);
    if (change === 'identity') {
      await recordSourceIdentityReview(db, await captureIdentityFixture(db, source), true);
    } else if (change === 'access') {
      await recordSourceAccessDecision(db, { sourceKey: source.key, sourceRevisionId: source.currentRevisionId,
        captureBatchId: null, verdict: 'NOT_AUTHORIZED', scopes: [], robotsCaptureIds: [],
        statement: 'Synthetic explicit revocation during native ingestion for regression testing.', reviewer: 'test', checkedAt: new Date().toISOString() }, true);
    } else {
      native(); const newer = await collect(source, false, change === 'validation');
      if (change === 'validation' || change === 'newer-validation') await validateCapturedSource(db, newer.captureBatchId);
    }
    await expect(requireCurrentCaptureRevision(db, batch)).rejects.toMatchObject({ code: {
      identity: 'IDENTITY_SUPERSEDED', access: 'ACCESS_DENIED', validation: 'VALIDATION_MISSING', 'newer-attempt': 'CAPTURE_SUPERSEDED', 'newer-validation': 'CAPTURE_NOT_VALIDATED',
    }[change] });
    expect(await db.jobSource.count({ where: { sourceKey: source.key } })).toBe(0);
  });

  it('keeps admission immutable and refuses retroactive admission for a qualification probe', async () => {
    const { source, probe, qualifications } = await prepare();
    const data = { identityReviewId: qualifications!.identity.reviewId, sourceValidationId: qualifications!.validation.id, policyVersion: SOURCE_ADMISSION_POLICY };
    await expect(db.sourceIngestionAdmission.create({ data: { batchId: probe.captureBatchId, ...data } })).rejects.toThrow('newly allocated');
    const collected = await collect(source, true);
    await expect(db.sourceIngestionAdmission.update({ where: { batchId: collected.captureBatchId }, data: { policyVersion: 'fabricated' } })).rejects.toThrow('immutable');
    await expect(db.sourceIngestionAdmission.delete({ where: { batchId: collected.captureBatchId } })).rejects.toThrow('immutable');
  });

  it.each(['identity', 'validation'] as const)('refuses fabricated SQL admission using a foreign %s decision even in the allocation transaction', async foreign => {
    const { source, qualifications } = await prepare(); const other = await prepare();
    const template = await stored(qualifications!.validation.captureBatchId);
    const { ingestionAdmission: _admission, executionBudget, ...data } = template;
    await expect(db.$transaction(async tx => {
      const batch = await tx.captureBatch.create({ data: { ...data, id: randomUUID(), attemptOrdinal: undefined,
        executionBudget: executionBudget ?? undefined, accessDecisionId: qualifications!.result.decisionId } });
      await tx.sourceIngestionAdmission.create({ data: { batchId: batch.id,
        identityReviewId: (foreign === 'identity' ? other.qualifications : qualifications)!.identity.reviewId,
        sourceValidationId: (foreign === 'validation' ? other.qualifications : qualifications)!.validation.id, policyVersion: SOURCE_ADMISSION_POLICY } });
    })).rejects.toThrow(`current native ${foreign}`);
    expect(await db.sourceIngestionAdmission.count({ where: { batch: { sourceKey: source.key } } })).toBe(0);
  });

  it('refuses delayed admission even when an earlier allocated batch still has no native receipts', async () => {
    const { qualifications } = await prepare();
    const { ingestionAdmission: _admission, executionBudget, ...template } = await stored(qualifications!.validation.captureBatchId);
    const batch = await db.captureBatch.create({ data: { ...template, id: randomUUID(), attemptOrdinal: undefined,
      executionBudget: executionBudget ?? undefined, accessDecisionId: qualifications!.result.decisionId } });
    expect(await db.rawCapture.count({ where: { batchId: batch.id } })).toBe(0);
    await expect(db.sourceIngestionAdmission.create({ data: { batchId: batch.id, identityReviewId: qualifications!.identity.reviewId,
      sourceValidationId: qualifications!.validation.id, policyVersion: SOURCE_ADMISSION_POLICY } })).rejects.toThrow('newly allocated');
    await expect(requireCurrentCaptureRevision(db, batch)).rejects.toMatchObject({ code: 'ADMISSION_MISSING' });
  });

  it.each(['valid', 'empty', 'incomplete'] as const)('ingestion orchestration validates its %s native result before any offer writer', async mode => {
    const { source } = await prepare();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ apiVersion: '1', jobs: mode === 'empty' ? [] :
      payload.jobs.map(job => mode === 'incomplete' ? { ...job, descriptionPlain: undefined } : job) }))));
    const stats = await runIngest(db, { only: source.key, skipGeocode: true });
    expect(stats).toHaveLength(1);
    expect(stats[0].errors).toBe(mode === 'incomplete' ? 1 : 0);
    expect(stats[0].created).toBe(mode === 'valid' ? 1 : 0);
    const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey: source.key, purpose: 'JOBS' }, orderBy: { attemptOrdinal: 'desc' } });
    const validation = await db.sourceValidation.findFirstOrThrow({ where: { captureBatchId: batch.id } });
    expect(validation.verdict).toBe(mode === 'incomplete' ? 'REJECTED' : 'VALIDATED');
    expect(await db.jobSource.count({ where: { sourceKey: source.key } })).toBe(mode === 'valid' ? 1 : 0);
  });

  it('rejects an empty-feed revocation before reporting an ingestion success', async () => {
    const { source } = await prepare();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"apiVersion":"1","jobs":[]}')));
    const original = validationModule.validateCapturedSource;
    vi.spyOn(validationModule, 'validateCapturedSource').mockImplementation(async (...args) => {
      const result = await original(...args);
      await recordSourceAccessDecision(db, { sourceKey: source.key, sourceRevisionId: source.currentRevisionId,
        captureBatchId: null, verdict: 'NOT_AUTHORIZED', scopes: [], robotsCaptureIds: [],
        statement: 'Synthetic revocation after real offline validation, before the empty-result boundary.', reviewer: 'test', checkedAt: new Date().toISOString() }, true);
      return result;
    });
    const stats = await runIngest(db, { only: source.key, skipGeocode: true });
    expect(stats[0]).toMatchObject({ errors: 1, created: 0 });
    expect(await db.jobSource.count({ where: { sourceKey: source.key } })).toBe(0);
  });
});
