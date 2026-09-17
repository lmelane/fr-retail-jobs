import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { blockingKey, type CandidateJob } from '../dedup/match.js';
import { applyPublicationGroups, planPublicationGroups } from '../dedup/repair.js';
import { workdayPublication } from '../test/fixtures/workdayPublication.js';
const db=new PrismaClient();
beforeEach(async()=>{await db.jobSource.deleteMany();await db.job.deleteMany();await db.company.deleteMany();});
afterAll(()=>db.$disconnect());
const candidate=(key:string,site:string,req='JR123',posting=`Advisor_${req}`):CandidateJob & {companyId:string}=>({
  ...workdayPublication(key,site,req,posting), company:'Tiffany & Co.',companyId:'TIFFANY',title:'Client Advisor',country:'FR',city:'Paris',sourceTier:'EMPLOYER_DIRECT',atsType:'WORKDAY',
});

describe('Workday grouped publications in persistence',()=>{
  it('attaches and reattests matching requisitions with proof while refusing changed native identity',async()=>{
    const prefix=randomUUID(),a=candidate(prefix+'-a','Careers'),b=candidate(prefix+'-b','Group','JR123','Advisor_JR123-1');
    const first=await upsertDeduplicated(db,a),second=await upsertDeduplicated(db,b);
    expect(second.jobId).toBe(first.jobId);
    const source=await db.jobSource.findUniqueOrThrow({where:{sourceKey_externalId:{sourceKey:b.sourceKey,externalId:b.externalId}}});
    expect((await db.publicationIdentityDecision.findFirstOrThrow({where:{sourceId:source.id}})).evidence).toMatchObject({peers:[{proof:{rule:'QUALIFIED_REQUISITION_ID'}}]});
    await upsertDeduplicated(db,b);
    const changed=structuredClone(b);(changed.raw as any).detail.jobPostingInfo.jobReqId='JR999';
    await expect(upsertDeduplicated(db,changed)).rejects.toThrow('PUBLICATION_GROUP_REVIEW_REQUIRED');
    expect((await db.jobSource.findUniqueOrThrow({where:{id:source.id}})).raw).toEqual(b.raw);
    const different=await upsertDeduplicated(db,candidate(prefix+'-c','Group','JR124'));
    expect(different.jobId).not.toBe(first.jobId);
  });
  it('repairs a false triple into two requisitions and preserves the existing page and all native observations',async()=>{
    const prefix=randomUUID(),a=candidate(prefix+'-a','Careers'),b=candidate(prefix+'-b','Group','JR123','Advisor_JR123-1'),c=candidate(prefix+'-c','Retail','JR124');
    for(const item of [a,b,c])await db.source.create({data:{key:item.sourceKey,maison:item.company,kind:'workday',config:{origin:'https://employer.wd3.myworkdayjobs.com',site:new URL(item.url).pathname.split('/')[1]},tier:'EMPLOYER_DIRECT',tenantKey:item.sourceKey,status:'ACTIVE'}});
    const first=await upsertDeduplicated(db,a);await upsertDeduplicated(db,b);
    const foreign=await db.jobSource.create({data:{jobId:first.jobId,sourceKey:c.sourceKey,externalId:c.externalId,sourceTier:c.sourceTier,url:c.url,title:c.title,raw:c.raw as any}});
    const before=await db.jobSource.findMany({where:{jobId:first.jobId},orderBy:{id:'asc'}}),same=before.filter(s=>s.id!==foreign.id);
    const request={jobIds:[first.jobId],groups:[{jobId:first.jobId,sourceIds:same.map(s=>s.id)},{sourceIds:[foreign.id]}],reason:'Separate distinct native Workday requisitions while retaining the existing owner page'};
    await expect(planPublicationGroups(db,{...request,groups:[{jobId:first.jobId,sourceIds:before.map(s=>s.id)}]})).rejects.toThrow('pairwise');
    const plan=await planPublicationGroups(db,request);await applyPublicationGroups(db,plan,plan.planHash);
    expect(await applyPublicationGroups(db,plan,plan.planHash)).toMatchObject({alreadyApplied:true});
    const after=await db.jobSource.findMany({where:{id:{in:before.map(s=>s.id)}},orderBy:{id:'asc'}});
    for(let i=0;i<before.length;i++)expect(after[i]).toMatchObject({id:before[i].id,raw:before[i].raw,url:before[i].url,lastSeenAt:before[i].lastSeenAt,externalId:before[i].externalId});
    expect(new Set(after.map(s=>s.jobId)).size).toBe(2);
    expect(after.find(s=>s.id===same[0].id)?.jobId).toBe(first.jobId);
    const separated=await db.job.findUniqueOrThrow({where:{id:after.find(s=>s.id===foreign.id)!.jobId!}});
    expect(separated).toMatchObject({url:c.url,clusterKey:blockingKey(c),description:'Own duties for Retail'});
    expect((await db.publicationIdentityDecision.findFirstOrThrow({where:{sourceId:foreign.id}})).action).toBe('SEPARATED');
  });
});
