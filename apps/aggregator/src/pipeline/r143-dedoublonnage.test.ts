import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { blockingKey, type CandidateJob } from '../dedup/match.js';
import { consolidateIdentityGroups, splitIdentityGroups } from '../dedup/consolidate.js';
import { teamtailorPublication } from '../test/fixtures/teamtailorPublication.js';

const db = new PrismaClient();
beforeEach(async () => { await db.jobSource.deleteMany(); await db.job.deleteMany(); await db.company.deleteMany(); });
afterAll(() => db.$disconnect());

type Candidate = CandidateJob & { companyId: string };
const base = { company: 'Sephora', companyId: 'SEPHORA', title: 'Seasonal Associate', country: 'US', city: 'Corpus Christi', sourceTier: 'EMPLOYER_DIRECT' as const };
const link = 'https://career55.sapsf.eu/sfcareer/jobreqcareer?company=SephoraUS&jobId=295010';
const lvmh = (): Candidate => ({ ...base, sourceKey: 'lvmh', externalId: '295010', url: link, atsType: 'LVMH_ALGOLIA',
  raw: { name: 'Seasonal Associate', maison: 'Sephora', link, atsId: '295010', objectID: '295010', city: 'Corpus Christi', country: 'United States',
    description: 'Seasonal Associate', profile: 'Job ID: 295010\nStore Name/Number: TX-Moore Plaza (1954)' } });
const rmkUrl = 'https://jobs.sephora.com/job/Corpus-Christi-Seasonal-Associate-TX-78411/1158400001/';
const rmk = (): Candidate => ({ ...base, sourceKey: 'sephora-france', externalId: '1158400001', url: rmkUrl, atsType: 'SUCCESSFACTORS',
  raw: { id: '1158400001', source: 'successfactors', path: '/job/Corpus-Christi-Seasonal-Associate-TX-78411/1158400001/',
    successfactorsDetail: { title: 'Seasonal Associate', company: 'Sephora', description: 'Job ID: 295010\nStore Name/Number: TX-Moore Plaza (1954)' } } });
const teamtailor = (key: string, origin: string): Candidate => ({ ...teamtailorPublication(key, origin), company: 'Maison 123', companyId: 'MAISON_123',
  title: 'Client Advisor', country: 'FR', city: 'Paris', sourceTier: 'EMPLOYER_DIRECT', atsType: 'TEAMTAILOR' });

describe('R-143 §4 — one opportunity, one offer', () => {
  it('joins a group feed and the Maison RMK site on the SAP requisition at ingestion, in both orders', async () => {
    const first = await upsertDeduplicated(db, rmk()), second = await upsertDeduplicated(db, lvmh());
    expect(second).toMatchObject({ jobId: first.jobId, outcome: 'MERGED' });
    const decision = await db.publicationIdentityDecision.findFirstOrThrow({ where: { toJobId: first.jobId }, orderBy: { createdAt: 'desc' } });
    expect(decision.evidence).toMatchObject({ peers: [{ proof: { rule: 'QUALIFIED_REQUISITION_ID', identity: { requisition: '295010' } } }] });
    expect(await db.job.count({ where: { isActive: true } })).toBe(1);
    // L'ordre inverse, sur une autre réquisition : le flux du groupe d'abord, le site de la Maison ensuite.
    const hit = lvmh(), page = rmk(), other = '295020', otherLink = link.replace('295010', other);
    Object.assign(hit, { externalId: other, url: otherLink }); Object.assign(hit.raw as object, { link: otherLink, atsId: other, objectID: other, profile: `Job ID: ${other}` });
    Object.assign(page, { externalId: '1158400020', url: rmkUrl.replace('1158400001', '1158400020') });
    Object.assign(page.raw as object, { id: '1158400020' }); (page.raw as any).successfactorsDetail.description = `Job ID: ${other}`;
    const groupFirst = await upsertDeduplicated(db, hit), maisonSecond = await upsertDeduplicated(db, page);
    expect(maisonSecond).toMatchObject({ jobId: groupFirst.jobId, outcome: 'MERGED' });
  });

  it('keeps two distinct requisitions apart even with the same title, city and Maison', async () => {
    const other = rmk(); other.externalId = (other.raw as any).id = '1158400002'; other.url = rmkUrl.replace('1158400001', '1158400002');
    (other.raw as any).successfactorsDetail.description = 'Job ID: 295011\nStore Name/Number: TX-Moore Plaza (1954)';
    const a = await upsertDeduplicated(db, lvmh()), b = await upsertDeduplicated(db, other);
    expect(b.jobId).not.toBe(a.jobId);
  });

  it('consolidates a stock split by the reviewed repair and keeps the old public ID as a redirect', async () => {
    const prefix = randomUUID().slice(0, 8);
    const own = teamtailor(`${prefix}-maison-123`, 'https://brand.teamtailor.com'), hosted = teamtailor(`${prefix}-etam`, 'https://career.group.example');
    for (const item of [own, hosted]) await db.source.create({ data: { key: item.sourceKey, maison: item.company, kind: 'teamtailor',
      config: { origin: new URL(item.url).origin }, tier: 'EMPLOYER_DIRECT', tenantKey: item.sourceKey, status: 'ACTIVE' } });
    const company = await db.company.create({ data: { name: 'Maison 123', canonicalKey: `M123-${prefix}`, fashionjobsUrl: `resolved:M123-${prefix}` } });
    // Avant le 02/10/2026, la fiche hébergée par le groupe n'avait pas de preuve : chaque publication a gardé son offre.
    const jobs = [];
    for (const item of [own, hosted]) {
      const job = await db.job.create({ data: { companyId: company.id, externalId: item.externalId, source: 'TEAMTAILOR', title: item.title, url: item.url,
        clusterKey: blockingKey(item), canonicalTier: 'EMPLOYER_DIRECT', canonicalSourceKey: item.sourceKey, canonicalExternalId: item.externalId, isActive: true } });
      await db.jobSource.create({ data: { jobId: job.id, sourceKey: item.sourceKey, externalId: item.externalId, sourceTier: 'EMPLOYER_DIRECT',
        url: item.url, title: item.title, raw: item.raw as any, isActive: true } });
      jobs.push(job);
    }
    expect(await splitIdentityGroups(db)).toEqual([{ companyId: company.id, clusterKey: blockingKey(own), jobIds: jobs.map(j => j.id) }]);
    expect(await consolidateIdentityGroups(db)).toMatchObject({ groups: 1, planned: 1, applied: 0, refused: [] });
    expect(await db.job.count({ where: { isActive: true } })).toBe(2);
    expect(await consolidateIdentityGroups(db, { apply: true })).toMatchObject({ groups: 1, planned: 1, applied: 1, refused: [] });
    const survivor = await db.job.findFirstOrThrow({ where: { isActive: true }, include: { sources: true } });
    expect(survivor.sources.map(s => s.sourceKey).sort()).toEqual([hosted.sourceKey, own.sourceKey].sort());
    const absorbed = jobs.find(j => j.id !== survivor.id)!;
    expect(await db.job.findUniqueOrThrow({ where: { id: absorbed.id } })).toMatchObject({ isActive: false, mergedIntoId: survivor.id });
    expect(await splitIdentityGroups(db)).toEqual([]);
  });

  it('refuses a split whose members share an index key but no native proof', async () => {
    const prefix = randomUUID().slice(0, 8);
    // Deux copies hébergées par deux groupes : même clé d'index, mais une délégation ne prouve rien face à une autre.
    const left = teamtailor(`${prefix}-group-a`, 'https://career.group-a.example'), right = teamtailor(`${prefix}-group-b`, 'https://career.group-b.example');
    expect(blockingKey(left)).toBe(blockingKey(right));
    for (const item of [left, right]) await db.source.create({ data: { key: item.sourceKey, maison: item.company, kind: 'teamtailor',
      config: { origin: new URL(item.url).origin }, tier: 'EMPLOYER_DIRECT', tenantKey: item.sourceKey, status: 'ACTIVE' } });
    const company = await db.company.create({ data: { name: 'Maison 123', canonicalKey: `M123-${prefix}`, fashionjobsUrl: `resolved:M123-${prefix}` } });
    for (const item of [left, right]) {
      const job = await db.job.create({ data: { companyId: company.id, externalId: item.externalId, source: 'TEAMTAILOR', title: item.title, url: item.url,
        clusterKey: blockingKey(item), canonicalTier: 'EMPLOYER_DIRECT', canonicalSourceKey: item.sourceKey, canonicalExternalId: item.externalId, isActive: true } });
      await db.jobSource.create({ data: { jobId: job.id, sourceKey: item.sourceKey, externalId: item.externalId, sourceTier: 'EMPLOYER_DIRECT',
        url: item.url, title: item.title, raw: item.raw as any, isActive: true } });
    }
    const report = await consolidateIdentityGroups(db, { apply: true });
    expect(report).toMatchObject({ groups: 1, planned: 0, applied: 0 });
    expect(report.refused[0].reason).toContain('pairwise native identity evidence');
    expect(await db.job.count({ where: { isActive: true, mergedIntoId: null } })).toBe(2);
  });
});
