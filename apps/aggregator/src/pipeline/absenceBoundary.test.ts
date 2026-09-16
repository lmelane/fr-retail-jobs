import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { attestSyntheticFeed, collectAdmittedWithoutCompletion, ingestSyntheticFeed, latestBatch, qualifiedSource, releaseQualifiedSources, resolvedCompany } from '../test/ingestionFixture.js';
import { publicationFixture } from '../test/publication-fixture.js';
import { captureIdentityFixture } from '../test/sourceIdentityFixture.js';
import { MemoryStore } from '../test/memoryObjectStore.js';
import { recordSourceIdentityReview } from '../connectors/sourceIdentity.js';
import { recordSourceAccessDecision } from '../connectors/sourceAccess.js';
import { archiveRawBlob } from '../capture/store.js';
import { createRefreshManifest, readRefreshPlan, runRefresh } from './refresh.js';
import { readAttestingCapture } from './attestingCapture.js';
import { retireSource } from './retireSource.js';

/**
 * THE ABSENCE BOUNDARY. Every closure by absence must rest on an admitted, sealed and
 * completed collection that could still publish today. Only upstream HTTP is synthetic:
 * registry gates, admission SQL, capture, validation, publication writers, completion,
 * the refresh planner, its locks and its immutable ledger are all real.
 */
const db = new PrismaClient();
const key = () => `absence-${randomUUID()}`;
const HOURS = 3_600_000;

/** A stale publication of the source, owned by the Maison its ingestion resolves — or by another one. */
async function stale(sourceKey: string, externalId: string, hoursAgo = 72, owner: 'RESOLVED' | 'FOREIGN' = 'RESOLVED') {
  const seen = new Date(Date.now() - hoursAgo * HOURS);
  const company = owner === 'RESOLVED' ? await resolvedCompany(db, sourceKey)
    : await db.company.create({ data: { name: `Other Maison ${externalId}`, canonicalKey: `other-${sourceKey}-${externalId}`, fashionjobsUrl: `resolved:other-${sourceKey}-${externalId}` } });
  const job = await db.job.create({ data: { companyId: company.id, externalId: `${sourceKey}:${externalId}`, source: 'GENERIC_JSONLD', title: 'Vendeur',
    url: `https://x/${sourceKey}/${externalId}`, fingerprint: `fp-${sourceKey}-${externalId}`, isActive: true, lastSeenAt: seen,
    canonicalSourceKey: sourceKey, canonicalExternalId: externalId, canonicalTier: 'EMPLOYER_DIRECT',
    sources: { create: { sourceKey, sourceTier: 'EMPLOYER_DIRECT', externalId, url: `https://x/${sourceKey}/${externalId}`, isActive: true, lastSeenAt: seen,
      ...publicationFixture({ sourceKey, externalId, url: `https://x/${sourceKey}/${externalId}`, title: 'Vendeur' }) } } } });
  const source = await db.jobSource.findFirstOrThrow({ where: { jobId: job.id } });
  return { job, source };
}
const jobState = (id: string) => db.job.findUniqueOrThrow({ where: { id }, select: { isActive: true, closedAt: true, withdrawnAt: true, withdrawalReason: true, reopenedCount: true } });
const eligibility = async (sourceKey: string) => (await readRefreshPlan(db, { onlyKeys: [sourceKey] })).absencePlan.eligibility[0];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(async () => { await releaseQualifiedSources(db); await db.$disconnect(); });

describe('absence proven from an admitted capture', () => {
  it('closes a stale publication absent from a completed collection and freezes that collection in the manifest and the ledger', async () => {
    const sourceKey = key();
    const gone = await stale(sourceKey, 's-gone');
    await attestSyntheticFeed(db, sourceKey, [{ id: 's-kept' }]);
    const batch = await latestBatch(db, sourceKey);
    expect(batch.ingestionAdmission).not.toBeNull();
    expect(batch.ingestionCompletion).toMatchObject({ published: 1 });
    expect(await eligibility(sourceKey)).toMatchObject({ eligible: true, captureBatchId: batch.id, termination: 'FULL_RESPONSE' });
    const manifest = await createRefreshManifest(db, await readRefreshPlan(db, { onlyKeys: [sourceKey] }));
    expect(manifest.entries).toEqual([expect.objectContaining({ jobSourceId: gone.source.id, state: 'ABSENT_FROM_PROVEN_ENUMERATION',
      proof: { kind: 'ENUMERATION', captureBatchId: batch.id, hash: expect.stringMatching(/^[a-f0-9]{64}$/) }, consequence: 'JOB_CANDIDATE_FOR_CLOSURE' })]);
    const result = await runRefresh(db, { manifest });
    expect(result).toMatchObject({ closedSources: 1, closedJobs: 1 });
    expect(await jobState(gone.job.id)).toMatchObject({ isActive: false, closedAt: expect.any(Date), withdrawnAt: null });
    const kept = await db.jobSource.findFirstOrThrow({ where: { sourceKey, externalId: 's-kept' } });
    expect(kept).toMatchObject({ isActive: true, captureBatchId: batch.id });
    const ledger = await db.dataCorrection.findFirstOrThrow({ where: { batchId: result.auditBatchId, entityId: gone.job.id } });
    expect(ledger.evidence).toMatchObject({ outcome: 'APPLIED', proofs: [expect.objectContaining({ proof: expect.objectContaining({ captureBatchId: batch.id }) })] });
  });

  it.each(['access-revoked', 'paused', 'identity-superseded', 'newer-attempt'] as const)('skips a frozen deactivation when %s between preview and apply', async change => {
    const sourceKey = key();
    const gone = await stale(sourceKey, 's-gone');
    const source = await qualifiedSource(db, sourceKey);
    await attestSyntheticFeed(db, sourceKey, []);
    const manifest = await createRefreshManifest(db, await readRefreshPlan(db, { onlyKeys: [sourceKey] }));
    expect(manifest.entries).toHaveLength(1);
    if (change === 'access-revoked') await recordSourceAccessDecision(db, { sourceKey, sourceRevisionId: source.currentRevisionId, captureBatchId: null,
      verdict: 'NOT_AUTHORIZED', scopes: [], robotsCaptureIds: [], statement: 'Synthetic revocation between preview and apply, never a production decision.',
      reviewer: 'absence-test', checkedAt: new Date().toISOString() }, true);
    if (change === 'paused') await db.source.update({ where: { key: sourceKey }, data: { status: 'PAUSED' } });
    if (change === 'identity-superseded') await recordSourceIdentityReview(db, await captureIdentityFixture(db, source), true);
    if (change === 'newer-attempt') await collectAdmittedWithoutCompletion(db, sourceKey, [{ id: 's-gone' }]);
    const reasons = (await eligibility(sourceKey)).reasons.join(' ');
    expect(reasons).toMatch({ 'access-revoked': /ACCESS_DENIED/, paused: /PAUSED/, 'identity-superseded': /IDENTITY_SUPERSEDED/, 'newer-attempt': /inachevée/ }[change]);
    const result = await runRefresh(db, { manifest });
    expect(result).toMatchObject({ closedSources: 0, closedJobs: 0 });
    expect(await jobState(gone.job.id)).toMatchObject({ isActive: true, closedAt: null });
    const ledger = await db.dataCorrection.findFirstOrThrow({ where: { batchId: result.auditBatchId, entityId: gone.job.id } });
    expect(ledger.evidence).toMatchObject({ outcome: 'EVIDENCE_CHANGED', deactivatedIds: [] });
  });

  it('refuses a qualification that expired while the write waited, even inside the refresh window', async () => {
    const sourceKey = key();
    const gone = await stale(sourceKey, 's-gone', 72);
    await attestSyntheticFeed(db, sourceKey, []);
    const manifest = await createRefreshManifest(db, await readRefreshPlan(db, { onlyKeys: [sourceKey] }));
    expect(manifest.entries).toHaveLength(1);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 25 * HOURS);
    expect((await eligibility(sourceKey)).reasons.join(' ')).toMatch(/CAPTURE_STALE/);
    expect(await runRefresh(db, { manifest })).toMatchObject({ closedSources: 0, closedJobs: 0 });
    expect(await jobState(gone.job.id)).toMatchObject({ isActive: true });
  });

  it('a feed made only of unlisted postings is rejected by validation and proves nothing', async () => {
    const sourceKey = key();
    const gone = await stale(sourceKey, 's-gone');
    expect((await ingestSyntheticFeed(db, sourceKey, [{ id: 's-unlisted', listed: false }])).errors).toBe(1);
    const batch = await latestBatch(db, sourceKey);
    expect(batch.outcome?.status).toBe('EXTRACTED');
    expect(batch.ingestionCompletion).toBeNull();
    expect((await eligibility(sourceKey)).reasons).toEqual(['publication inachevée : aucun rapport de fin d’ingestion']);
    expect(await runRefresh(db, { onlyKeys: [sourceKey] })).toMatchObject({ closedJobs: 0 });
    expect(await jobState(gone.job.id)).toMatchObject({ isActive: true });
  });

  it('a write failure withholds the right to attest and keeps the failed posting distinct from an absence', async () => {
    const sourceKey = key();
    const gone = await stale(sourceKey, 's-gone');
    // A publication already owned by another Maison: re-attributing it needs an identity review,
    // so the production writer refuses it (EmployerIdentityReviewRequired). A real write failure.
    const failed = await stale(sourceKey, 's-bad', 72, 'FOREIGN');
    await attestSyntheticFeed(db, sourceKey, [{ id: 's-bad' }, { id: 's-ok' }]);
    const batch = await latestBatch(db, sourceKey);
    expect(batch.ingestionCompletion).toMatchObject({ published: 1, writeFailed: 1 });
    const completion = await db.rawBlob.findUniqueOrThrow({ where: { hash: batch.ingestionCompletion!.reportHash }, include: { body: true } });
    expect(completion.body).not.toBeNull();
    const plan = await readRefreshPlan(db, { onlyKeys: [sourceKey] });
    expect(plan.absencePlan.eligibility[0].reasons).toEqual(expect.arrayContaining(['errors = 1', 'canAttestAbsence = false']));
    expect(plan.absencePlan.states.get(failed.source.id)).toBe('UNVERIFIABLE');
    expect(plan.absencePlan.states.get(gone.source.id)).toBe('UNVERIFIABLE');
    expect(await runRefresh(db, { onlyKeys: [sourceKey] })).toMatchObject({ closedJobs: 0, closedSources: 0 });
    expect(await jobState(gone.job.id)).toMatchObject({ isActive: true });
    expect(await jobState(failed.job.id)).toMatchObject({ isActive: true });
  });

  it('reads the sealed proof from the verified cold archive and refuses it when the archive is unavailable', async () => {
    const sourceKey = key();
    await stale(sourceKey, 's-gone');
    await attestSyntheticFeed(db, sourceKey, []);
    const batch = await latestBatch(db, sourceKey);
    const store = new MemoryStore();
    expect(await archiveRawBlob(db, batch.outcome!.manifestHash!, store)).toEqual({ purged: true });
    expect(await archiveRawBlob(db, batch.ingestionCompletion!.reportHash, store)).toEqual({ purged: true });
    const now = new Date();
    const cold = await readAttestingCapture(db, sourceKey, now, store);
    expect(cold.ok).toBe(true);
    if (cold.ok) expect(cold.capture).toMatchObject({ captureBatchId: batch.id, facts: { canAttestAbsence: true }, evidence: { canonicalContractDeclared: true, canonicalSet: [] } });
    const unavailable = await readAttestingCapture(db, sourceKey, now);
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.reasons[0]).toMatch(/preuve scellée illisible/);
  });

  it('a retired source cannot attest; its publications are withdrawn, never closed', async () => {
    const sourceKey = key();
    const gone = await stale(sourceKey, 's-gone');
    await attestSyntheticFeed(db, sourceKey, []);
    await retireSource(db, sourceKey);
    expect(await jobState(gone.job.id)).toMatchObject({ isActive: false, closedAt: null, withdrawalReason: 'SOURCE_RETIRED' });
    const result = await readAttestingCapture(db, sourceKey, new Date());
    expect(result).toMatchObject({ ok: false, reasons: ['source RETIRED : aucune collecte admise possible'] });
    expect(await runRefresh(db, { onlyKeys: [sourceKey] })).toMatchObject({ closedJobs: 0, closedSources: 0 });
  });

  it('a publication listed again after a proven closure is reopened by the next ingestion, not duplicated', async () => {
    const sourceKey = key();
    const back = await stale(sourceKey, 's-back');
    await attestSyntheticFeed(db, sourceKey, []);
    expect(await runRefresh(db, { onlyKeys: [sourceKey] })).toMatchObject({ closedJobs: 1 });
    expect(await jobState(back.job.id)).toMatchObject({ isActive: false, closedAt: expect.any(Date) });
    expect((await ingestSyntheticFeed(db, sourceKey, [{ id: 's-back' }])).errors).toBe(0);
    expect(await jobState(back.job.id)).toMatchObject({ isActive: true, closedAt: null, reopenedCount: 1 });
    expect(await db.job.count({ where: { canonicalSourceKey: sourceKey } })).toBe(1);
    expect(await db.jobEvent.count({ where: { jobId: back.job.id, type: 'REOPENED' } })).toBe(1);
  });
});
