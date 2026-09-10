import { clearOccupationLedger } from '../test/setup-integration.js';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { archivePublicationHold } from './publicationHold.js';
import { toCandidate } from './ingest.js';
import { isTrustedForAttestation } from './attestation.js';
const db = new PrismaClient();
afterAll(() => db.$disconnect());
it('archives the real azert defect idempotently without public jobs and forbids publication', async () => {
  const key = 'jobaffinity-hold-test';
  await db.source.upsert({ where: { key }, update: { status: 'DRAFT' }, create: { key, maison: 'Intersport', kind: 'jobaffinity-wordpress', tenantKey: key, tier: 'ATS_OFFICIAL', config: {} } });
  const job = { externalId: 'wu8otj4ccxanrwy3u8', title: 'azert', url: 'https://jobaffinity.fr/apply/wu8otj4ccxanrwy3u8', publicationHold: 'APPLICATION_HTTP_404', raw: { post: { id: 6407, date_gmt: '2021-06-17T00:00:00' }, applicationEvidence: { status: 404 } } };
  const before = [await db.job.count(), await db.jobEvent.count()];
  await archivePublicationHold(db, key, job); await archivePublicationHold(db, key, job);
  expect(await db.sourceObservation.count({ where: { sourceKey: key } })).toBe(1);
  expect([await db.job.count(), await db.jobEvent.count()]).toEqual(before);
  expect(() => toCandidate(job, { key, company: 'Intersport', tier: 'ATS_OFFICIAL' }, 'Intersport', 'JOBAFFINITY_WORDPRESS')).toThrow('held');
  expect(isTrustedForAttestation({ status: 'DEGRADED', complete: false, fetched: 993, declaredTotal: 993 })).toBe(false);
  expect(isTrustedForAttestation({ status: 'DEGRADED', complete: true, errors: 0, fetched: 993, declaredTotal: 993 })).toBe(true);
  await db.sourceObservation.deleteMany({ where: { sourceKey: key } }); await db.source.delete({ where: { key } });
});

it('withdraws only the confirmed representation, preserves history, and a newer attestation wins', async () => {
  const { upsertDeduplicated } = await import('../dedup/upsert.js');
  const { resolveCompany } = await import('../normalize/company.js');
  const key = 'jobaffinity-withdrawal-test';
  await db.source.upsert({ where: { key }, update: { status: 'ACTIVE' }, create: { key, maison: 'Intersport', kind: 'jobaffinity-wordpress', tenantKey: key, tier: 'ATS_OFFICIAL', config: {}, status: 'ACTIVE' } });
  const candidate = { company: 'Intersport', companyId: resolveCompany('Intersport').companyId, sourceKey: key, externalId: 'withdrawal-witness', sourceTier: 'ATS_OFFICIAL' as const, atsType: 'JOBAFFINITY_WORDPRESS' as const, title: 'Technicien Cycle H/F', url: 'https://jobaffinity.fr/apply/rpp3vwzazs9dmsf9f9', country: 'FR', city: 'Paris', raw: { revision: 1 } };
  const initial = await upsertDeduplicated(db, candidate);
  const observationTime = new Date(Date.now() - 60_000);
  const closed = { ...candidate, publicationHold: 'APPLICATION_EXPLICITLY_CLOSED', publicationWithdrawnAt: observationTime, raw: { applicationEvidence: { status: 200, state: 'CLOSED', checkedAt: observationTime.toISOString() } } };
  await archivePublicationHold(db, key, closed);
  expect((await db.job.findUniqueOrThrow({ where: { id: initial.jobId } })).isActive).toBe(true);
  await db.jobSource.updateMany({ where: { sourceKey: key }, data: { lastSeenAt: new Date(observationTime.getTime() - 60_000) } });
  await archivePublicationHold(db, key, closed);
  await archivePublicationHold(db, key, closed);
  expect((await db.job.findUniqueOrThrow({ where: { id: initial.jobId } })).isActive).toBe(false);
  expect(await db.jobEvent.count({ where: { jobId: initial.jobId, type: 'CLOSED' } })).toBe(1);
  expect((await db.jobSource.findFirstOrThrow({ where: { sourceKey: key } })).raw).toEqual({ revision: 1 });
  await upsertDeduplicated(db, candidate);
  expect((await db.job.findUniqueOrThrow({ where: { id: initial.jobId } })).isActive).toBe(true);
  expect(await db.jobEvent.count({ where: { jobId: initial.jobId, type: 'REOPENED' } })).toBe(1);
  await clearOccupationLedger();
  await db.jobSource.deleteMany({ where: { sourceKey: key } }); await db.job.delete({ where: { id: initial.jobId } });
  await db.sourceObservation.deleteMany({ where: { sourceKey: key } }); await db.source.delete({ where: { key } });
});

it('honours native isListed=false as withdrawal, preserves evidence and republishes without a repost', async()=>{
  const { upsertDeduplicated } = await import('../dedup/upsert.js');
  const { resolveCompany } = await import('../normalize/company.js');
  const key='ashby-unlisted-witness';
  await db.source.upsert({where:{key},update:{status:'ACTIVE'},create:{key,maison:'Polène',kind:'ashby',tenantKey:key,tier:'ATS_OFFICIAL',config:{},status:'ACTIVE'}});
  const input={company:'Polène',companyId:resolveCompany('Polène').companyId,sourceKey:key,externalId:'listed-witness',sourceTier:'ATS_OFFICIAL' as const,atsType:'ASHBY' as const,title:'Client Advisor',url:'https://jobs.ashbyhq.com/polene-paris/listed-witness',raw:{isListed:true}};
  const {jobId}=await upsertDeduplicated(db,input);
  await db.jobSource.updateMany({where:{jobId},data:{lastSeenAt:new Date(Date.now()-60000)}});
  const held={...input,publicationHold:'SOURCE_UNLISTED',publicationWithdrawnAt:new Date(),raw:{isListed:false}};
  await archivePublicationHold(db,key,held);await archivePublicationHold(db,key,held);
  expect(await db.job.findUniqueOrThrow({where:{id:jobId}})).toMatchObject({isActive:false,closedAt:null,withdrawalReason:'SOURCE_UNLISTED',reopenedCount:0});
  expect(await db.jobEvent.count({where:{jobId,type:'CLOSED'}})).toBe(0);
  expect(await db.jobEvent.count({where:{jobId,type:'WITHDRAWN'}})).toBe(1);
  expect(await db.sourceObservation.count({where:{sourceKey:key}})).toBe(2);
  await upsertDeduplicated(db,input);
  expect(await db.job.findUniqueOrThrow({where:{id:jobId}})).toMatchObject({isActive:true,withdrawnAt:null,withdrawalReason:null,reopenedCount:0});
  expect(await db.jobEvent.count({where:{jobId,type:'REPUBLISHED'}})).toBe(1);
  await clearOccupationLedger();await db.jobSource.deleteMany({where:{jobId}});await db.job.delete({where:{id:jobId}});
  await db.sourceObservation.deleteMany({where:{sourceKey:key}});await db.source.delete({where:{key}});
});

it('withholds publication on a reviewed OUT_OF_SCOPE decision: withdrawn (never closed), still collected, never re-attested', async () => {
  const { upsertDeduplicated } = await import('../dedup/upsert.js');
  const { resolveCompany } = await import('../normalize/company.js');
  const { applyScopeExclusion, loadScopeExclusions } = await import('./scopeDecisions.js');
  const key = 'aptar-scope-witness';
  // Self-healing: an interrupted earlier run must not block this one.
  await db.postingScopeDecision.deleteMany({ where: { sourceKey: key } });
  for (const js of await db.jobSource.findMany({ where: { sourceKey: key } })) { await db.jobSource.delete({ where: { id: js.id } }); await db.job.delete({ where: { id: js.jobId } }).catch(() => undefined); }
  await db.sourceObservation.deleteMany({ where: { sourceKey: key } });
  await db.source.upsert({ where: { key }, update: { status: 'ACTIVE' }, create: { key, maison: 'Aptar Group', kind: 'successfactors', tenantKey: key, tier: 'ATS_OFFICIAL', config: {}, status: 'ACTIVE' } });
  const input = { company: 'Aptar Group', companyId: resolveCompany('Aptar Group').companyId, sourceKey: key, externalId: '1405738533', sourceTier: 'ATS_OFFICIAL' as const, atsType: 'SUCCESSFACTORS' as const, title: 'Account Manager', url: 'https://jobs.aptar.com/job/Congers-Account-Manager-NY-10920/1405738533/', raw: { id: '1405738533' } };
  const { jobId } = await upsertDeduplicated(db, input);
  await db.jobSource.updateMany({ where: { jobId }, data: { lastSeenAt: new Date(Date.now() - 60_000) } });
  await db.postingScopeDecision.create({ data: { sourceKey: key, externalId: '1405738533', verdict: 'OUT_OF_SCOPE', ruleVersion: 'aptar-perimeter-v2-20260910', reason: 'Aptar Pharma division named in the text — Pharma-only is out of the product perimeter (owner decision 2026-09-10)', evidence: { pageUrl: input.url, pharmaEvidence: 'At Aptar Pharma, we specialize in Drug Delivery' }, decidedBy: 'integration', decidedAt: new Date() } });
  await db.postingScopeDecision.create({ data: { sourceKey: key, externalId: '1432782933', verdict: 'UNDETERMINED', ruleVersion: 'aptar-perimeter-v2-20260910', reason: 'no division named', evidence: {}, decidedBy: 'integration', decidedAt: new Date() } });
  const exclusions = await loadScopeExclusions(db, key);
  expect([...exclusions.keys()]).toEqual(['1405738533']); // UNDETERMINED is recorded, never an exclusion
  const held = applyScopeExclusion(input, exclusions);
  expect(held.publicationHold).toBe('SCOPE_OUT_OF_PERIMETER');
  await archivePublicationHold(db, key, held); await archivePublicationHold(db, key, held);
  expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ isActive: false, closedAt: null, withdrawalReason: 'OUT_OF_SCOPE', reopenedCount: 0 });
  expect(await db.jobEvent.count({ where: { jobId, type: 'CLOSED' } })).toBe(0);
  expect(await db.jobEvent.count({ where: { jobId, type: 'WITHDRAWN' } })).toBe(1);
  // The raw payload is collected and archived under the hold (next to the observation the upsert already kept).
  expect(await db.sourceObservation.count({ where: { sourceKey: key, externalId: '1405738533', raw: { path: ['publicationHold'], equals: 'SCOPE_OUT_OF_PERIMETER' } } })).toBe(1);
  // The ingest never re-attests a held posting: the candidate path refuses it, so no later run can re-open the job.
  expect(() => toCandidate(held, { key, company: 'Aptar Group', tier: 'ATS_OFFICIAL' }, 'Aptar Group', 'SUCCESSFACTORS')).toThrow('held');
  await clearOccupationLedger();
  await db.postingScopeDecision.deleteMany({ where: { sourceKey: key } });
  await db.jobSource.deleteMany({ where: { sourceKey: key } }); await db.job.delete({ where: { id: jobId } });
  await db.sourceObservation.deleteMany({ where: { sourceKey: key } }); await db.source.delete({ where: { key } });
});
