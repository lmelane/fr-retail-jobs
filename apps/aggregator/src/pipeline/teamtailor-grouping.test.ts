import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { applyPublicationGroups, planPublicationGroups } from '../dedup/repair.js';
import type { CandidateJob } from '../dedup/match.js';
import { teamtailorPublication } from '../test/fixtures/teamtailorPublication.js';
const db=new PrismaClient();
beforeEach(async()=>{await db.jobSource.deleteMany();await db.job.deleteMany();await db.company.deleteMany();});
afterAll(()=>db.$disconnect());
const candidate=(key:string,origin:string):CandidateJob & {companyId:string}=>({
 ...teamtailorPublication(key,origin),company:'Tiffany & Co.',companyId:'TIFFANY',title:'Client Advisor',country:'FR',city:'Paris',sourceTier:'EMPLOYER_DIRECT',atsType:'TEAMTAILOR',
});

describe('Teamtailor alias publication persistence',()=>{
 it('joins proven aliases, retains both URLs and rejects changed publisher evidence',async()=>{
  const prefix=randomUUID(),a=candidate(prefix+'-a','https://brand.teamtailor.com'),b=candidate(prefix+'-b','https://careers.brand.example');
  const first=await upsertDeduplicated(db,a),second=await upsertDeduplicated(db,b);expect(second.jobId).toBe(first.jobId);
  const sources=await db.jobSource.findMany({where:{jobId:first.jobId}});expect(new Set(sources.map(s=>s.url))).toEqual(new Set([a.url,b.url]));
  const source=sources.find(s=>s.sourceKey===b.sourceKey)!;
  expect((await db.publicationIdentityDecision.findFirstOrThrow({where:{sourceId:source.id}})).evidence).toMatchObject({peers:[{proof:{rule:'QUALIFIED_FEED_POSTING_ID'}}]});
  await upsertDeduplicated(db,b);const changed=structuredClone(b);(changed.raw as any)._jobposting.identifier.value=8360800;
  await expect(upsertDeduplicated(db,changed)).rejects.toThrow('PUBLICATION_GROUP_REVIEW_REQUIRED');expect((await db.jobSource.findUniqueOrThrow({where:{id:source.id}})).raw).toEqual(b.raw);
 });
 it('rebuilds an inactive alias group without a legacy owner, preserving the page and absent attestation',async()=>{
  const prefix=randomUUID(),a=candidate(prefix+'-a','https://brand.teamtailor.com'),b=candidate(prefix+'-b','https://careers.brand.example');
  for(const item of [a,b])await db.source.create({data:{key:item.sourceKey,maison:item.company,kind:'teamtailor',config:{origin:new URL(item.url).origin},tier:'EMPLOYER_DIRECT',tenantKey:item.sourceKey,status:'ACTIVE'}});
  const company=await db.company.create({data:{name:a.company,canonicalKey:prefix,fashionjobsUrl:'teamtailor:'+prefix}});
  const job=await db.job.create({data:{companyId:company.id,externalId:'legacy',source:'TEAMTAILOR',title:'Wrong legacy title',url:'https://legacy.example/job',isActive:false}});
  for(const item of [a,b])await db.jobSource.create({data:{jobId:job.id,sourceKey:item.sourceKey,externalId:item.externalId,sourceTier:item.sourceTier,url:item.url,title:item.title,raw:item.raw as any,isActive:false}});
  const before=await db.jobSource.findMany({where:{jobId:job.id},orderBy:{id:'asc'}});const plan=await planPublicationGroups(db,{jobIds:[job.id],groups:[{jobId:job.id,sourceIds:before.map(s=>s.id)}],reason:'Rebuild an inactive native alias group without inventing an employer closure or a fresh attestation'});
  expect(plan.groups[0]).toMatchObject({jobId:job.id,lifecycle:'WITHDRAW',patch:{isActive:false,withdrawalReason:'ATTESTATION_MISSING',title:'Client Advisor',closedAt:null}});
  await applyPublicationGroups(db,plan,plan.planHash);expect(await applyPublicationGroups(db,plan,plan.planHash)).toMatchObject({alreadyApplied:true});
  const after=await db.jobSource.findMany({where:{jobId:job.id},orderBy:{id:'asc'}});for(let i=0;i<before.length;i++)expect(after[i]).toMatchObject({id:before[i].id,raw:before[i].raw,url:before[i].url,lastSeenAt:before[i].lastSeenAt,isActive:false});
  expect(await db.job.findUniqueOrThrow({where:{id:job.id}})).toMatchObject({isActive:false,closedAt:null,withdrawalReason:'ATTESTATION_MISSING'});
  expect(await db.jobEvent.count({where:{jobId:job.id,type:'WITHDRAWN'}})).toBe(1);expect(await db.jobEvent.count({where:{jobId:job.id,type:'CLOSED'}})).toBe(0);
 });
});
