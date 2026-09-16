import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { CandidateJob } from '../dedup/match.js';
import { POSTING_IDENTITY_VERSION } from '../dedup/postingIdentity.js';
const db = new PrismaClient();
beforeEach(async () => { await db.jobSource.deleteMany(); await db.job.deleteMany(); await db.company.deleteMany(); });
afterAll(() => db.$disconnect());
const application = 'https://eljs.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/63681';
function fixture() {
  const prefix = randomUUID();
  const candidate = (suffix: string, overrides: Partial<CandidateJob> = {}): CandidateJob & { companyId: string } => ({
    company: 'Tiffany & Co.', companyId: 'TIFFANY', title: 'Sales Advisor', city: 'Wailea', country: 'US',
    sourceKey: `${prefix}-${suffix}`, externalId: prefix, sourceTier: 'EMPLOYER_DIRECT',
    atsType: 'ORACLE_HCM', url: application, raw: { source: 'oraclehcm', site: 'CX', list: { Id: '63681' } }, ...overrides,
  });
  return candidate;
}

describe('native publication grouping', () => {
  it('joins exact applications across titles and cities, preserving proof and both publications', async () => {
    const candidate = fixture(), a = candidate('direct'), b = candidate('board', { sourceTier: 'SPECIALIST_JOBBOARD',
      title: 'Conseiller clientèle', city: 'Autre ville', url: application.replace('/en/', '/fr/') + '?src=board' });
    const first = await upsertDeduplicated(db, a), second = await upsertDeduplicated(db, b);
    expect(second.jobId).toBe(first.jobId);
    const sources = await db.jobSource.findMany({ where: { jobId: first.jobId } });
    expect(sources).toHaveLength(2);
    const subject = sources.find(source => source.sourceKey === b.sourceKey)!;
    expect(await db.publicationIdentityDecision.count({ where: { sourceId: subject.id } })).toBe(1);
    const decision = await db.publicationIdentityDecision.findFirstOrThrow({ where: { sourceId: subject.id } });
    expect(decision).toMatchObject({ action: 'ATTACHED', fromJobId: null, toJobId: first.jobId, readerVersion: POSTING_IDENTITY_VERSION });
    expect(decision.evidence).toMatchObject({ subject: { sourceKey: b.sourceKey }, peers: [{ proof: { rule: 'QUALIFIED_APPLICATION_ID' } }] });
    await upsertDeduplicated(db, b);
    expect(await db.publicationIdentityDecision.count({ where: { sourceId: subject.id } })).toBe(1);
    await expect(upsertDeduplicated(db, { ...b, raw: { source: 'oraclehcm', site: 'CX', list: { Id: '63683' } } }))
      .rejects.toThrow('PUBLICATION_GROUP_REVIEW_REQUIRED');
    expect((await db.jobSource.findUniqueOrThrow({ where: { id: subject.id } })).raw).toEqual(b.raw);
    await expect(db.publicationIdentityDecision.update({ where: { id: decision.id }, data: { action: 'SEPARATED' } })).rejects.toThrow('immutable');
    await expect(db.publicationIdentityDecision.delete({ where: { id: decision.id } })).rejects.toThrow('immutable');
    for (const data of [{ sourceKey: 'rewritten' }, { externalId: 'rewritten' }, { id: randomUUID() }]) {
      await expect(db.jobSource.update({ where: { id: subject.id }, data })).rejects.toThrow('identity is immutable');
    }
  });
  it('keeps identical titles and generic shared URLs separate', async () => {
    const candidate = fixture();
    const results = await Promise.all(['a','b','c'].map(suffix => upsertDeduplicated(db, candidate(suffix, { url: 'https://company.example/careers' }))));
    expect(new Set(results.map(row => row.jobId)).size).toBe(3);
  });
  it('keeps two IDs from one feed separate even when their application URL matches', async () => {
    const candidate = fixture(), a = candidate('direct');
    const first = await upsertDeduplicated(db, a), second = await upsertDeduplicated(db, { ...a, externalId: a.externalId + '-another' });
    expect(second.jobId).not.toBe(first.jobId);
  });
  it('refuses to extend a historical group containing an unqualified publication', async () => {
    const candidate = fixture(), a = candidate('direct');
    const first = await upsertDeduplicated(db, a);
    await db.jobSource.create({ data: { jobId: first.jobId, sourceKey: a.sourceKey + '-historical', externalId: 'old',
      sourceTier: 'AGGREGATOR', url: 'https://board.example/unknown' } });
    const second = await upsertDeduplicated(db, candidate('new'));
    expect(second.jobId).not.toBe(first.jobId);
    expect(await db.jobSource.count({ where: { jobId: first.jobId } })).toBe(2);
  });
  it('does not pick a survivor when several groups claim the same application', async () => {
    const candidate = fixture(), first = candidate('direct');
    const a = await upsertDeduplicated(db, first);
    const b = await upsertDeduplicated(db, { ...first, externalId: first.externalId + '-second' });
    const third = await upsertDeduplicated(db, candidate('board'));
    expect(new Set([a.jobId, b.jobId, third.jobId]).size).toBe(3);
  });
});
