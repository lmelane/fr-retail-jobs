import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { admissionFixture } from '../test/sourceAdmissionFixture.js';
import { captureIdentityFixture } from '../test/sourceIdentityFixture.js';
import { recordSourceIdentityReview } from '../connectors/sourceIdentity.js';
import { recordSourceAccessDecision } from '../connectors/sourceAccess.js';
import { validateCapturedSource } from '../connectors/sourceValidation.js';
import { captureExtraction } from '../capture/batch.js';
import { fetchAtsJobs } from '../ats/index.js';
import { upsertDeduplicated } from '../dedup/upsert.js';
import { toCandidate } from './ingest.js';
import { archivePublicationHold } from './publicationHold.js';
import { retireSource } from './retireSource.js';
import { deactivateCapturedPublication } from './deactivateSources.js';
import { applyScopeExclusion, loadScopeExclusions } from './scopeDecisions.js';
import { applyPublicationGroups, planPublicationGroups } from '../dedup/repair.js';
import * as writeLocks from '../lib/writeLocks.js';
import { lockSourceWrites } from '../lib/writeLocks.js';

// Only upstream HTTP is synthetic. Admission, evidence, replay, policies,
// SQL guards, locks and all writers run unchanged against dedicated Postgres.
const db = new PrismaClient();
const config = { board: 'publication-boundary' };
const posting = { id: 'boundary-1', title: 'Client Advisor', descriptionPlain: 'Native duties', isListed: true };
const network = (isListed = true) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ apiVersion: '1', jobs: [{ ...posting, isListed }, { ...posting, id: 'still-listed-qualification-witness' }] }))));
async function prepare() {
  const key = `boundary-${randomUUID()}`;
  const source = await db.source.create({ data: { key, maison: key, tenantKey: key, kind: 'ashby', config, status: 'ACTIVE', tier: 'EMPLOYER_DIRECT' } });
  network();
  const probe = await captureExtraction(db, key, config, undefined, settings => fetchAtsJobs('ASHBY', settings), 'ASHBY');
  await admissionFixture(db, source, probe.captureBatchId);
  const collect = async (listed = true, active = true) => {
    network(listed);
    const batch = await captureExtraction(db, key, config, undefined, settings => fetchAtsJobs('ASHBY', settings), 'ASHBY',
      { revisionId: source.currentRevisionId, requireActive: active });
    expect((await validateCapturedSource(db, batch.captureBatchId)).verdict).toBe('VALIDATED');
    return batch.jobs[0];
  };
  const candidate = (job: Awaited<ReturnType<typeof collect>>) => toCandidate(job, { key, company: key, tier: 'EMPLOYER_DIRECT' }, key, 'ASHBY');
  return { source, collect, candidate, probe };
}
async function published(detached = false) {
  const f = await prepare(); const input = f.candidate(await f.collect());
  const { jobId } = await upsertDeduplicated(db, input);
  const representation = await db.jobSource.findFirstOrThrow({ where: { jobId } });
  if (detached) {
    // Restore an incomplete historical projection, then quarantine through the
    // real reviewed repair path and its immutable compensating decision.
    await db.jobSource.update({ where: { id: representation.id }, data: { raw: {} } });
    const plan = await planPublicationGroups(db, { jobIds: [jobId], groups: [], quarantineSourceIds: [representation.id],
      withdrawJobIds: [jobId], reason: 'Synthetic historical evidence defect for native withdrawal boundary testing' });
    await applyPublicationGroups(db, plan, plan.planHash);
  }
  await db.jobSource.update({ where: { id: representation.id }, data: { lastSeenAt: new Date('2000-01-01') } });
  return { ...f, input, jobId, representation };
}
async function revoke(source: Awaited<ReturnType<typeof prepare>>['source']) {
  await recordSourceAccessDecision(db, { sourceKey: source.key, sourceRevisionId: source.currentRevisionId,
    captureBatchId: null, verdict: 'NOT_AUTHORIZED', scopes: [], robotsCaptureIds: [],
    statement: 'Synthetic revocation between native archive and lifecycle write, never a production decision.',
    reviewer: 'boundary-test', checkedAt: new Date().toISOString() }, true);
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(async () => { await db.$executeRaw`TRUNCATE "SourceIngestionAdmission", "SourceIdentityReview"`; await db.$disconnect(); });

describe('mandatory captured publication boundary', () => {
  it.each(['none', 'batch-only', 'output-only'] as const)('refuses %s provenance for both publication and held archival', async mode => {
    const f = await prepare(), job = await f.collect(); const input = f.candidate(job);
    if (mode !== 'batch-only') delete input.captureBatchId;
    if (mode !== 'output-only') delete input.captureOutputId;
    await expect(upsertDeduplicated(db, input)).rejects.toThrow(/native capture|both batch/);
    await expect(archivePublicationHold(db, f.source.key, { ...input, publicationHold: 'SOURCE_UNLISTED' })).rejects.toThrow(/native capture|both batch/);
    expect(await db.jobSource.count({ where: { sourceKey: f.source.key } })).toBe(0);
    expect(await db.sourceObservation.count({ where: { sourceKey: f.source.key } })).toBe(0);
  });

  it('cannot publish a registered qualification probe without admission', async () => {
    const f = await prepare();
    await expect(upsertDeduplicated(db, f.candidate(f.probe.jobs[0]))).rejects.toThrow();
    expect(await db.jobSource.count({ where: { sourceKey: f.source.key } })).toBe(0);
  });

  it('cannot archive a held qualification probe as admitted ingestion', async () => {
    const f = await prepare(), held = await f.collect(false, false);
    await expect(archivePublicationHold(db, f.source.key, held)).rejects.toThrow();
    expect(await db.sourceObservation.count({ where: { sourceKey: f.source.key } })).toBe(0);
  });

  it('cannot strip a native hold before calling the publication writer', async () => {
    const f = await prepare(), held = await f.collect(false);
    const { publicationHold: _hold, publicationWithdrawnAt: _time, ...stripped } = held;
    await expect(upsertDeduplicated(db, f.candidate(stripped))).rejects.toThrow('Captured publication');
    expect(await db.jobSource.count({ where: { sourceKey: f.source.key } })).toBe(0);
  });

  it.each(['reason', 'time', 'future', 'raw', 'url'] as const)('refuses fabricated withdrawal %s without modifying the offer', async mode => {
    const f = await published(), held = await f.collect(false);
    if (mode === 'reason') held.publicationHold = 'APPLICATION_HTTP_404';
    if (mode === 'time') held.publicationWithdrawnAt = new Date(held.publicationWithdrawnAt!.getTime() - 1);
    if (mode === 'future') held.publicationWithdrawnAt = new Date(Date.now() + 60_000);
    if (mode === 'raw') held.raw = { isListed: false };
    if (mode === 'url') held.url = 'https://example.com/fabricated';
    await expect(archivePublicationHold(db, f.source.key, held)).rejects.toThrow(/differs|Invalid withdrawal/);
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: f.representation.id } })).toMatchObject({ isActive: true });
    expect(await db.jobEvent.count({ where: { jobId: f.jobId, type: 'WITHDRAWN' } })).toBe(0);
  });

  it('snapshots caller-owned publication data before asynchronous archive reads', async () => {
    const f = await prepare(); const input = f.candidate(await f.collect());
    const pending = upsertDeduplicated(db, input);
    input.title = 'Injected title'; (input.raw as any).isListed = false; input.captureBatchId = 'wrong';
    const result = await pending;
    expect(await db.job.findUniqueOrThrow({ where: { id: result.jobId } })).toMatchObject({ title: 'Client Advisor' });
    expect((await db.jobSource.findFirstOrThrow({ where: { jobId: result.jobId } })).raw).toMatchObject({ isListed: true });
  });

  it('snapshots hold reason and time before asynchronous archive reads', async () => {
    const f = await published(), held = await f.collect(false);
    const pending = archivePublicationHold(db, f.source.key, held);
    held.publicationHold = 'APPLICATION_HTTP_404'; held.publicationWithdrawnAt!.setTime(Date.now() + 60_000);
    await pending;
    expect(await db.job.findUniqueOrThrow({ where: { id: f.jobId } })).toMatchObject({ isActive: false, closedAt: null, withdrawalReason: 'SOURCE_UNLISTED' });
  });

  it.each(['attached', 'detached'] as const)('withdraws %s evidence idempotently through a genuinely admitted native capture', async attachment => {
    const f = await published(attachment === 'detached'), held = await f.collect(false);
    await archivePublicationHold(db, f.source.key, held); await archivePublicationHold(db, f.source.key, held);
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: f.representation.id } })).toMatchObject({ isActive: false });
    if (attachment === 'attached') expect(await db.jobEvent.count({ where: { jobId: f.jobId, type: 'WITHDRAWN' } })).toBe(1);
    else expect(await db.dataCorrection.count({ where: { entityId: f.representation.id, finding: 'QUARANTINE_SOURCE_DEACTIVATION' } })).toBe(1);
  });

  it.each(['attached', 'detached'] as const)('rechecks admission after archival before %s withdrawal', async attachment => {
    const f = await published(attachment === 'detached'), held = await f.collect(false);
    const find = db.job.findMany.bind(db.job);
    vi.spyOn(db.job, 'findMany').mockImplementationOnce(((args) => revoke(f.source).then(() => find(args))) as typeof db.job.findMany);
    await expect(archivePublicationHold(db, f.source.key, held)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: f.representation.id } })).toMatchObject({ isActive: true });
    expect(await db.sourceObservation.count({ where: { sourceKey: f.source.key, publicationHold: 'SOURCE_UNLISTED' } })).toBe(1);
  });

  it.each(['paused', 'identity', 'newer-capture'] as const)('blocks %s at the direct native withdrawal boundary', async change => {
    const f = await published(), held = await f.collect(false);
    if (change === 'paused') await db.source.update({ where: { key: f.source.key }, data: { status: 'PAUSED' } });
    if (change === 'identity') await recordSourceIdentityReview(db, await captureIdentityFixture(db, f.source), true);
    if (change === 'newer-capture') await f.collect(true);
    await expect(deactivateCapturedPublication(db, { ...held, sourceKey: f.source.key })).rejects.toThrow();
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: f.representation.id } })).toMatchObject({ isActive: true });
  });

  it('keeps scope policy outside RAW, rechecks its revocation, and blocks an excluded upsert', async () => {
    const f = await published(), job = await f.collect();
    const decision = await db.postingScopeDecision.create({ data: { sourceKey: f.source.key, externalId: job.externalId,
      verdict: 'OUT_OF_SCOPE', ruleVersion: 'boundary/1', reason: 'Reviewed synthetic perimeter witness', evidence: {}, decidedBy: 'test', decidedAt: new Date() } });
    const held = applyScopeExclusion(job, await loadScopeExclusions(db, f.source.key));
    expect(held.raw).toBe(job.raw);
    await expect(upsertDeduplicated(db, f.candidate(job))).rejects.toThrow('held by current policy');
    await db.postingScopeDecision.update({ where: { id: decision.id }, data: { verdict: 'IN_SCOPE' } });
    await expect(archivePublicationHold(db, f.source.key, held)).rejects.toThrow('scope decision is no longer current');
    await db.postingScopeDecision.update({ where: { id: decision.id }, data: { verdict: 'OUT_OF_SCOPE' } });
    await archivePublicationHold(db, f.source.key, held);
    expect(await db.job.findUniqueOrThrow({ where: { id: f.jobId } })).toMatchObject({ isActive: false, closedAt: null, withdrawalReason: 'OUT_OF_SCOPE' });
    expect((await db.sourceObservation.findFirstOrThrow({ where: { sourceKey: f.source.key, publicationHold: 'SCOPE_OUT_OF_PERIMETER' } })).raw).toEqual(job.raw);
    await archivePublicationHold(db, f.source.key, held);
    const corrections = await db.dataCorrection.findMany({ where: { entityType: 'SourceExtraction', entityId: job.captureOutputId, finding: 'PUBLICATION_SCOPE_HOLD' } });
    expect(corrections).toHaveLength(1);
    const retained = corrections[0];
    expect(retained.evidence).toMatchObject({ sourceKey: f.source.key, captureBatchId: job.captureBatchId });
    expect(JSON.parse((retained.evidence as { scopeDecisionText: string }).scopeDecisionText)).toMatchObject({
      id: decision.id, verdict: 'OUT_OF_SCOPE', ruleVersion: 'boundary/1', reason: 'Reviewed synthetic perimeter witness' });
    await db.postingScopeDecision.update({ where: { id: decision.id }, data: { verdict: 'IN_SCOPE', ruleVersion: 'boundary/2' } });
    expect((await db.dataCorrection.findUniqueOrThrow({ where: { id: retained.id } })).evidence).toEqual(retained.evidence);
    await expect(db.dataCorrection.delete({ where: { id: retained.id } })).rejects.toThrow('append-only');
  });

  it.each(['publication', 'withdrawal'] as const)('rechecks freshness after waiting for company locks during %s', async mode => {
    const f = await published(), held = mode === 'withdrawal' ? await f.collect(false) : undefined;
    const lock = writeLocks.lockCompanyRows;
    vi.spyOn(writeLocks, 'lockCompanyRows').mockImplementation(async (...args) => {
      await lock(...args);
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    });
    const action = mode === 'withdrawal' ? deactivateCapturedPublication(db, { ...held!, sourceKey: f.source.key }) : upsertDeduplicated(db, f.input);
    await expect(action).rejects.toMatchObject({ code: 'CAPTURE_STALE' });
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: f.representation.id } })).toMatchObject({ isActive: true });
    expect(await db.jobEvent.count({ where: { jobId: f.jobId, type: 'WITHDRAWN' } })).toBe(0);
  });

  it('retirement blocks a previously admitted publication while preserving its history', async () => {
    const f = await published();
    await retireSource(db, f.source.key);
    await expect(upsertDeduplicated(db, f.input)).rejects.toThrow('no longer current');
    expect(await db.job.findUniqueOrThrow({ where: { id: f.jobId } })).toMatchObject({ isActive: false, withdrawalReason: 'SOURCE_RETIRED' });
    expect(await db.jobEvent.count({ where: { jobId: f.jobId, type: 'WITHDRAWN' } })).toBe(1);
    expect(await db.jobEvent.count({ where: { jobId: f.jobId, type: 'CLOSED' } })).toBe(0);
    expect(await db.jobSource.count({ where: { sourceKey: f.source.key } })).toBe(1);
  });

  it('fails closed when scope policy cannot be read', async () => {
    vi.spyOn(db.postingScopeDecision, 'findMany').mockRejectedValueOnce(new Error('Registry unavailable'));
    await expect(loadScopeExclusions(db, 'any')).rejects.toThrow('Registry unavailable');
  });

  it.each(['insert', 'update', 'delete'] as const)('serializes scope %s with publication, including an initially absent row', async action => {
    const f = await prepare();
    const data = { sourceKey: f.source.key, externalId: 'boundary-1', verdict: 'OUT_OF_SCOPE',
      ruleVersion: 'lock/1', reason: 'Synthetic scope concurrency witness', evidence: {}, decidedBy: 'test', decidedAt: new Date() };
    if (action !== 'insert') await db.postingScopeDecision.create({ data });
    let release!: () => void, ready!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { ready = resolve; });
    const publication = db.$transaction(async tx => { await lockSourceWrites(tx, f.source.key); ready(); await barrier; });
    await locked;
    try {
      await expect(db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout='100ms'");
        if (action === 'insert') await tx.postingScopeDecision.create({ data });
        else if (action === 'update') await tx.postingScopeDecision.updateMany({ where: { sourceKey: f.source.key }, data: { verdict: 'IN_SCOPE' } });
        else await tx.postingScopeDecision.deleteMany({ where: { sourceKey: f.source.key } });
      })).rejects.toThrow();
    } finally { release(); await publication; }
    expect(await db.postingScopeDecision.count({ where: { sourceKey: f.source.key } })).toBe(action === 'insert' ? 0 : 1);
  });

});
