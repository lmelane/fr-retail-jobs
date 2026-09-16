import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { collectAdmittedWithoutCompletion, ingestSyntheticFeed, latestBatch, qualifiedSource, releaseQualifiedSources, syntheticFeed } from '../test/ingestionFixture.js';
import { publicationFixture } from '../test/publication-fixture.js';
import { readIngestionCompletion, recordIngestionCompletion, SOURCE_COMPLETION_POLICY, type CompletionReport } from '../capture/completion.js';
import { captureExtraction } from '../capture/batch.js';
import { captureReaderRevision } from '../capture/revision.js';
import { storeRawBlob } from '../capture/store.js';
import { effectiveSourceConfig } from '../connectors/sourceConfig.js';
import { fetchAtsJobs } from '../ats/index.js';

// Only upstream HTTP is synthetic. Registry, admission, capture, sealed manifest,
// publication writers and the completion's SQL guards are the production path.
const db = new PrismaClient();
const key = () => `completion-${randomUUID()}`;
const report = (batchId: string, fates: CompletionReport['fates'] = [], outputs = 1): CompletionReport => ({ version: 1, policy: SOURCE_COMPLETION_POLICY, batchId, outputs, fates });
const row = (batchId: string, reportHash: string, counts: Partial<{ published: number; held: number; writeFailed: number; skipped: number }> = {}, over: Record<string, string> = {}) => ({
  batchId, reportHash, published: 1, held: 0, writeFailed: 0, skipped: 0, readerRevision: captureReaderRevision(), policyVersion: SOURCE_COMPLETION_POLICY, ...counts, ...over });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await releaseQualifiedSources(db); await db.$disconnect(); });

describe('immutable end of an admitted ingestion', () => {
  it('a production ingestion seals one completion naming every unpublished output', async () => {
    const source = key();
    // `c` already belongs to another Maison: its re-attribution needs an identity review, and the
    // production writer refuses it. `b` is unlisted by the publisher: a native hold.
    const other = await db.company.create({ data: { name: `Other ${source}`, canonicalKey: `other-${source}`, fashionjobsUrl: `resolved:other-${source}` } });
    await db.job.create({ data: { companyId: other.id, externalId: `${source}:c`, source: 'GENERIC_JSONLD', title: 'Vendeur', url: 'https://x/c', sources: { create: { sourceKey: source, sourceTier: 'EMPLOYER_DIRECT', externalId: 'c', url: 'https://x/c', ...publicationFixture({ sourceKey: source, externalId: 'c', url: 'https://x/c', title: 'Vendeur' }) } } } });
    const stats = await ingestSyntheticFeed(db, source, [{ id: 'a' }, { id: 'b', listed: false }, { id: 'c' }]);
    expect(stats).toMatchObject({ created: 1, held: 1, errors: 1, captureBatchId: expect.any(String) });
    const batch = await latestBatch(db, source);
    expect(batch.id).toBe(stats.captureBatchId);
    expect(batch.ingestionCompletion).toMatchObject({ published: 1, held: 1, writeFailed: 1, skipped: 0, policyVersion: SOURCE_COMPLETION_POLICY,
      readerRevision: batch.readerRevision, reportHash: stats.completionReportHash });
    const completion = await readIngestionCompletion(db, batch.id);
    expect(completion?.report).toEqual({ version: 1, policy: SOURCE_COMPLETION_POLICY, batchId: batch.id, outputs: 3, fates: [
      { ordinal: 1, externalId: 'b', disposition: 'HELD', reason: 'SOURCE_UNLISTED' },
      { ordinal: 2, externalId: 'c', disposition: 'WRITE_FAILED', reason: 'EmployerIdentityReviewRequired' },
    ] });
  });

  it('refuses a completion for a qualification probe, in the application and in SQL', async () => {
    const source = await qualifiedSource(db, key());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(syntheticFeed([{ id: 'probe' }]))));
    const probe = await captureExtraction(db, source.key, effectiveSourceConfig(source.config as Record<string, unknown>), undefined, settings => fetchAtsJobs('ASHBY', settings), 'ASHBY');
    await expect(recordIngestionCompletion(db, probe.captureBatchId, [])).rejects.toThrow('admitted');
    const reportHash = await storeRawBlob(db, Buffer.from(JSON.stringify(report(probe.captureBatchId))));
    await expect(db.sourceIngestionCompletion.create({ data: row(probe.captureBatchId, reportHash) })).rejects.toThrow('admitted, sealed');
    expect(await db.sourceIngestionCompletion.count({ where: { batchId: probe.captureBatchId } })).toBe(0);
  });

  it('SQL refuses counts that leave an output unaccounted for, a foreign policy or another reader', async () => {
    const batch = await collectAdmittedWithoutCompletion(db, key(), [{ id: 'x' }]);
    const reportHash = await storeRawBlob(db, Buffer.from(JSON.stringify(report(batch.captureBatchId))));
    await expect(db.sourceIngestionCompletion.create({ data: row(batch.captureBatchId, reportHash, { published: 0 }) })).rejects.toThrow('accounted for');
    await expect(db.sourceIngestionCompletion.create({ data: row(batch.captureBatchId, reportHash, { published: 2 }) })).rejects.toThrow('accounted for');
    await expect(db.sourceIngestionCompletion.create({ data: row(batch.captureBatchId, reportHash, {}, { policyVersion: 'fabricated/1' }) })).rejects.toThrow('accounted for');
    await expect(db.sourceIngestionCompletion.create({ data: row(batch.captureBatchId, reportHash, {}, { readerRevision: 'git:' + 'f'.repeat(40) }) })).rejects.toThrow('accounted for');
    await expect(db.sourceIngestionCompletion.create({ data: row(batch.captureBatchId, 'a'.repeat(64)) })).rejects.toThrow();
    expect(await db.sourceIngestionCompletion.count({ where: { batchId: batch.captureBatchId } })).toBe(0);
  });

  it('is written once, idempotently for the same report, and never rewritten or deleted', async () => {
    const batch = await collectAdmittedWithoutCompletion(db, key(), [{ id: 'once' }]);
    const first = await recordIngestionCompletion(db, batch.captureBatchId, []);
    expect(await recordIngestionCompletion(db, batch.captureBatchId, [])).toEqual(first);
    await expect(recordIngestionCompletion(db, batch.captureBatchId, [{ ordinal: 0, externalId: 'once', disposition: 'HELD', reason: 'LATER_STORY' }])).rejects.toThrow('different report');
    await expect(db.sourceIngestionCompletion.update({ where: { batchId: batch.captureBatchId }, data: { published: 0 } })).rejects.toThrow('immutable');
    await expect(db.sourceIngestionCompletion.delete({ where: { batchId: batch.captureBatchId } })).rejects.toThrow('immutable');
    expect(await db.sourceIngestionCompletion.findUniqueOrThrow({ where: { batchId: batch.captureBatchId } })).toMatchObject({ published: 1, held: 0, writeFailed: 0, skipped: 0 });
  });

  it('refuses a fate that does not name the sealed output it claims', async () => {
    const batch = await collectAdmittedWithoutCompletion(db, key(), [{ id: 'named' }]);
    for (const fate of [
      { ordinal: 0, externalId: 'other', disposition: 'HELD' as const, reason: 'X' },
      { ordinal: 1, externalId: 'named', disposition: 'HELD' as const, reason: 'X' },
      { ordinal: 0, externalId: 'named', disposition: 'HELD' as const, reason: 'line\nbreak' },
    ]) await expect(recordIngestionCompletion(db, batch.captureBatchId, [fate])).rejects.toThrow(/does not match|Invalid output fate/);
    expect(await db.sourceIngestionCompletion.count({ where: { batchId: batch.captureBatchId } })).toBe(0);
  });

  it('refuses on read a stored row whose counts diverge from its immutable report', async () => {
    const batch = await collectAdmittedWithoutCompletion(db, key(), [{ id: 'y' }]);
    const reportHash = await storeRawBlob(db, Buffer.from(JSON.stringify(report(batch.captureBatchId))));
    // The sum still covers the single output, so SQL accepts it; the report says PUBLISHED, the row says HELD.
    await db.sourceIngestionCompletion.create({ data: row(batch.captureBatchId, reportHash, { published: 0, held: 1 }) });
    await expect(readIngestionCompletion(db, batch.captureBatchId)).rejects.toThrow('differs from its immutable report');
  });
});
