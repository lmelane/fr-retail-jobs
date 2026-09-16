import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { applyPublicationGroups, planPublicationGroups } from '../dedup/repair.js';
import type { CandidateJob } from '../dedup/match.js';
import { icimsPublication } from '../test/fixtures/icimsPublication.js';
const db=new PrismaClient();
beforeEach(async()=>{await db.jobSource.deleteMany();await db.job.deleteMany();await db.company.deleteMany();});
afterAll(()=>db.$disconnect());
const origin='https://stores-brand.icims.com';
const candidate=(key:string,query=''):CandidateJob & {companyId:string}=>({
 ...icimsPublication(key,origin,query),company:'Tiffany & Co.',companyId:'TIFFANY',title:'Client Advisor',country:'US',sourceTier:'EMPLOYER_DIRECT',atsType:'ICIMS',
});
describe('iCIMS regional publication persistence',()=>{
 it('joins two feeds on the declared regional URL, retains both publications and rejects a later contradiction',async()=>{
  const prefix=randomUUID(),a=candidate(prefix+'-hub','?hub=15&in_iframe=1'),b=candidate(prefix+'-direct','?in_iframe=1');
  const first=await upsertDeduplicated(db,a),second=await upsertDeduplicated(db,b);expect(second.jobId).toBe(first.jobId);
  const sources=await db.jobSource.findMany({where:{jobId:first.jobId}});expect(new Set(sources.map(s=>s.url))).toEqual(new Set([a.url,b.url]));
  const source=sources.find(s=>s.sourceKey===b.sourceKey)!;
  expect((await db.publicationIdentityDecision.findFirstOrThrow({where:{sourceId:source.id}})).evidence).toMatchObject({peers:[{proof:{rule:'QUALIFIED_APPLICATION_ID',identity:{tenant:`icims:${origin}`,requisition:'42'}}}]});
  const changed=structuredClone(b);(changed.raw as any).postingEvidence.jobPosting.url=b.url.replace('/42/','/43/');
  await expect(upsertDeduplicated(db,changed)).rejects.toThrow('PUBLICATION_GROUP_REVIEW_REQUIRED');expect((await db.jobSource.findUniqueOrThrow({where:{id:source.id}})).raw).toEqual(b.raw);
 });
 it('repairs a legacy hub/direct group only after regional scope is qualified, without reactivating the retired feed',async()=>{
  const prefix=randomUUID(),a=candidate(prefix+'-hub','?hub=15&in_iframe=1'),b=candidate(prefix+'-direct','?in_iframe=1');
  for(const [item,status,config] of [[a,'ACTIVE',{origin:'https://hub-brand.icims.com'}],[b,'RETIRED',{origin}]] as const)await db.source.create({data:{key:item.sourceKey,maison:item.company,kind:'icims',config,tier:item.sourceTier,tenantKey:item.sourceKey,status}});
  const company=await db.company.create({data:{name:a.company,canonicalKey:prefix,fashionjobsUrl:'icims:'+prefix}});
  const job=await db.job.create({data:{companyId:company.id,externalId:'legacy',source:'ICIMS',title:'Wrong legacy title',url:'https://legacy.example/job',fingerprint:prefix,isActive:true,canonicalSourceKey:a.sourceKey,canonicalExternalId:a.externalId}});
  for(const item of [a,b])await db.jobSource.create({data:{jobId:job.id,sourceKey:item.sourceKey,externalId:item.externalId,sourceTier:item.sourceTier,url:item.url,title:item.title,raw:item.raw as any,isActive:item===a,lastSeenAt:new Date()}});
  const before=await db.jobSource.findMany({where:{jobId:job.id},orderBy:{id:'asc'}}),request={jobIds:[job.id],groups:[{jobId:job.id,sourceIds:before.map(s=>s.id)}],reason:'Qualified regional native URL shared by the original hub and retired direct publication'};
  await expect(planPublicationGroups(db,request)).rejects.toThrow('DETAIL_IDENTITY_MISMATCH');
  await db.source.update({where:{key:a.sourceKey},data:{config:{origin:'https://hub-brand.icims.com',detailOrigins:[origin]}}});
  const plan=await planPublicationGroups(db,request);expect(plan.groups[0]).toMatchObject({jobId:job.id,lifecycle:'KEEP',patch:{title:'Client Advisor',canonicalSourceKey:a.sourceKey,isActive:true}});
  await applyPublicationGroups(db,plan,plan.planHash);expect(await applyPublicationGroups(db,plan,plan.planHash)).toMatchObject({alreadyApplied:true});
  const after=await db.jobSource.findMany({where:{jobId:job.id},orderBy:{id:'asc'}});for(let i=0;i<before.length;i++)expect(after[i]).toMatchObject({id:before[i].id,raw:before[i].raw,url:before[i].url,lastSeenAt:before[i].lastSeenAt,isActive:before[i].isActive,jobId:before[i].jobId});
  expect(after.every(s=>s.presentation!==null)).toBe(true);expect(await db.jobEvent.count({where:{jobId:job.id}})).toBe(0);
 });
});
