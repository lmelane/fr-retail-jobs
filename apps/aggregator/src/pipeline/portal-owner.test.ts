import '../test/setup-integration.js';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { sourceIdentityHash } from '../connectors/sourceIdentity.js';
import { planReviewedPortalOwners, type PortalOwnerReview } from '../remediation/portalOwner.js';
import { applyRepairPlan, digest } from '../remediation/plan.js';
const prisma = new PrismaClient();
beforeEach(async () => { await prisma.job.deleteMany(); await prisma.company.deleteMany(); await prisma.sourceObservation.deleteMany({where:{sourceKey:'owner-fixture'}}); await prisma.source.deleteMany({where:{key:'owner-fixture'}}); });
afterAll(async () => { await prisma.job.deleteMany(); await prisma.company.deleteMany(); await prisma.source.deleteMany({where:{key:'owner-fixture'}}); await prisma.$disconnect(); });
async function fixture() {
 const company=await prisma.company.create({data:{name:'Legacy Brand',canonicalKey:'LEGACY_BRAND',kind:'BRAND',fashionjobsUrl:'resolved:LEGACY_BRAND'}});
 const source=await prisma.source.create({data:{key:'owner-fixture',maison:'Legacy Brand',kind:'successfactors',config:{origin:'https://careers.example.com'},tenantKey:'successfactors:careers.example.com',tier:'EMPLOYER_DIRECT',status:'ACTIVE'}});
 const job=await prisma.job.create({data:{companyId:company.id,externalId:'123',source:'SUCCESSFACTORS',title:'Finance Manager',url:'https://careers.example.com/job/Paris-Finance/123/',fingerprint:'LEGACY_BRAND|finance|paris',clusterKey:'LEGACY_BRAND|finance',sources:{create:{sourceKey:source.key,externalId:'123',url:'https://careers.example.com/job/Paris-Finance/123/',sourceTier:'EMPLOYER_DIRECT',raw:{original:'preserve me'}}},events:{create:{type:'OPENED'}}}});
 const artifactText='The official portal identifies Actual Group as the hiring organization.';
 const spec:PortalOwnerReview={batchId:randomUUID(),reviewer:'integration',reviewedAt:new Date().toISOString(),sources:[{sourceKey:source.key,expectedSourceHash:sourceIdentityHash(source),fromCompanyIds:[company.id],targetName:'Actual Group',targetKind:'GROUP',officialDomain:'example.com',portalUrl:'https://careers.example.com',evidence:[{url:'https://careers.example.com',artifactText,sha256:createHash('sha256').update(artifactText).digest('hex'),statement:artifactText}]}]};
 return {company,source,job,spec};
}
it('corrects the owner without merging the brand or changing jobs, RAW and lifecycle; replay is idempotent',async()=>{
 const {company,source,job,spec}=await fixture();const before=await prisma.jobSource.findFirstOrThrow({where:{jobId:job.id}});
 const plan=await planReviewedPortalOwners(prisma,spec);await applyRepairPlan(prisma,plan,digest(plan),'test');
 const after=await prisma.job.findUniqueOrThrow({where:{id:job.id},include:{company:true,sources:true,events:true}});
 expect(after.company.name).toBe('Actual Group');expect(after.company.kind).toBe('GROUP');expect(after.isActive).toBe(job.isActive);expect(after.closedAt).toBe(job.closedAt);expect(after.firstSeenAt).toEqual(job.firstSeenAt);
 expect(after.sources[0].raw).toEqual(before.raw);expect(after.sources[0].id).toBe(before.id);expect(after.sources[0].sourceTier).toBe('GROUP_OFFICIAL');expect(after.events.some(e=>e.type==='OPENED')).toBe(true);expect(after.events.some(e=>e.type==='CORRECTED')).toBe(true);
 expect((await prisma.company.findUniqueOrThrow({where:{id:company.id}})).mergedIntoId).toBeNull();expect((await prisma.source.findUniqueOrThrow({where:{key:source.key}})).status).toBe('PAUSED');
 expect(await prisma.employerIdentityReview.count({where:{id:plan.batchId}})).toBe(1);
 const corrections=await prisma.dataCorrection.findMany({where:{batchId:plan.batchId},select:{evidence:true}});
 expect(corrections.every(c=>!JSON.stringify(c.evidence).includes('artifactText'))).toBe(true);
 expect(await applyRepairPlan(prisma,plan,digest(plan),'test')).toMatchObject({alreadyApplied:true,written:0});
});
it('refuses an unreviewed competing active source instead of forcing reassignment',async()=>{
 const {job,spec}=await fixture();await prisma.jobSource.create({data:{jobId:job.id,sourceKey:'competing',externalId:'123',url:'https://other.example.com/123',sourceTier:'EMPLOYER_DIRECT'}});
 await expect(planReviewedPortalOwners(prisma,spec)).rejects.toThrow('Other active source evidence');
 expect(await prisma.dataCorrection.count({where:{batchId:spec.batchId}})).toBe(0);
});
it('invalidates the plan when tenant configuration or archived proof changes',async()=>{
 const {source,spec}=await fixture();spec.sources[0].evidence[0].artifactText='tampered';
 await expect(planReviewedPortalOwners(prisma,spec)).rejects.toThrow('Invalid official ownership evidence');
 await prisma.source.update({where:{id:source.id},data:{config:{origin:'https://different.example.com'}}});
 await expect(planReviewedPortalOwners(prisma,spec)).rejects.toThrow('Source configuration changed');
});
it('separates a proven homonym and withdraws its source while preserving the intended brand and real closure history',async()=>{
 const {company,source,job,spec}=await fixture();
 spec.sources[0].targetName='Actual Software Employer';spec.sources[0].targetKind='OTHER';
 spec.sources[0].withdrawal={reason:'IDENTITY_CONTRADICTED',statement:'The observed portal belongs to a different legal employer, not the reviewed sector brand.'};
 const plan=await planReviewedPortalOwners(prisma,spec);await applyRepairPlan(prisma,plan,digest(plan),'test');
 const after=await prisma.job.findUniqueOrThrow({where:{id:job.id},include:{company:true,sources:true}});
 expect(after.company).toMatchObject({name:'Actual Software Employer',kind:'OTHER'});
 expect(after).toMatchObject({isActive:false,closedAt:null,withdrawalReason:'IDENTITY_CONTRADICTED',firstSeenAt:job.firstSeenAt});
 expect(after.withdrawnAt).toEqual(new Date(spec.reviewedAt));expect(after.sources[0]).toMatchObject({isActive:false,raw:{original:'preserve me'}});
 expect(await prisma.company.findUniqueOrThrow({where:{id:company.id}})).toMatchObject({name:'Legacy Brand',kind:'BRAND',mergedIntoId:null});
 expect(await prisma.source.findUniqueOrThrow({where:{id:source.id}})).toMatchObject({status:'RETIRED'});
 expect(await prisma.jobEvent.count({where:{jobId:job.id,type:'CLOSED'}})).toBe(0);
 expect(await applyRepairPlan(prisma,plan,digest(plan),'test')).toMatchObject({alreadyApplied:true,written:0});
});
it('keeps reviewed homonyms distinct even when legacy legal-suffix normalization gives the same key',async()=>{
 const {company,job,spec}=await fixture();
 await prisma.company.update({where:{id:company.id},data:{name:'Example',canonicalKey:'EXAMPLE',fashionjobsUrl:'resolved:EXAMPLE',domain:'example.org'}});
 spec.sources[0].targetName='Example GmbH';spec.sources[0].targetKind='OTHER';spec.sources[0].identityScope='OFFICIAL_DOMAIN';
 const plan=await planReviewedPortalOwners(prisma,spec);await applyRepairPlan(prisma,plan,digest(plan),'test');
 const after=await prisma.job.findUniqueOrThrow({where:{id:job.id},include:{company:true}});
 expect(after.company).toMatchObject({name:'Example GmbH',domain:'example.com',kind:'OTHER'});
 expect(after.company.canonicalKey).toMatch(/^REVIEWED_[a-f0-9]{64}$/);expect(after.companyId).not.toBe(company.id);
 expect(await prisma.company.findUniqueOrThrow({where:{id:company.id}})).toMatchObject({name:'Example',domain:'example.org',mergedIntoId:null});
 expect(await applyRepairPlan(prisma,plan,digest(plan),'test')).toMatchObject({alreadyApplied:true,written:0});
});
it('attributes postings to the brands explicitly named on their native pages, leaves the rest to the owner, records observations; replay is idempotent',async()=>{
 const {company,source,job,spec}=await fixture();
 const second=await prisma.job.create({data:{companyId:company.id,externalId:'456',source:'SUCCESSFACTORS',title:'Sales Associate',url:'https://careers.example.com/job/Milan-Sales/456/',fingerprint:'LEGACY_BRAND|sales|milan',clusterKey:'LEGACY_BRAND|sales',sources:{create:{sourceKey:source.key,externalId:'456',url:'https://careers.example.com/job/Milan-Sales/456/',sourceTier:'EMPLOYER_DIRECT',raw:{original:'keep'}}}}});
 const third=await prisma.job.create({data:{companyId:company.id,externalId:'789',source:'SUCCESSFACTORS',title:'Legacy Brand Store Manager',url:'https://careers.example.com/job/Rome-Store/789/',fingerprint:'LEGACY_BRAND|store|rome',clusterKey:'LEGACY_BRAND|store',sources:{create:{sourceKey:source.key,externalId:'789',url:'https://careers.example.com/job/Rome-Store/789/',sourceTier:'EMPLOYER_DIRECT',raw:{original:'keep'}}}}});
 const sha='a'.repeat(64),observedAt=new Date().toISOString();
 spec.sources[0].configPatch={brandProperty:'dept'};
 spec.sources[0].postings=[
  {externalId:'456',targetName:'Actual Brand',targetKind:'BRAND',evidence:{url:'https://careers.example.com/job/Milan-Sales/456/',sha256:sha,property:'dept',value:'Actual Brand',observedAt}},
  {externalId:'789',targetName:'Legacy Brand',targetKind:'BRAND',evidence:{url:'https://careers.example.com/job/Rome-Store/789/',sha256:sha,property:'dept',value:'Legacy Brand',observedAt}}];
 const plan=await planReviewedPortalOwners(prisma,spec);
 expect(plan.ownerRules?.[0].postingOwners).toEqual({'456':'ACTUAL_BRAND','789':'LEGACY_BRAND'});
 expect(plan.operations.filter(o=>o.entity==='Job').map(o=>o.id).sort()).toEqual([job.id,second.id].sort());   // 789 already belongs to its attested brand: no operation
 await applyRepairPlan(prisma,plan,digest(plan),'test');
 const owner=await prisma.job.findUniqueOrThrow({where:{id:job.id},include:{company:true}});expect(owner.company).toMatchObject({name:'Actual Group',kind:'GROUP'});
 const brand=await prisma.job.findUniqueOrThrow({where:{id:second.id},include:{company:true,sources:true}});
 expect(brand.company).toMatchObject({name:'Actual Brand',kind:'BRAND',parentGroup:'Actual Group',parentGroupId:owner.companyId});expect(brand.clusterKey).toBe('ACTUAL_BRAND|sales');expect(brand.sources[0].raw).toEqual({original:'keep'});
 const kept=await prisma.job.findUniqueOrThrow({where:{id:third.id},include:{company:true}});expect(kept.companyId).toBe(company.id);expect(kept.company).toMatchObject({name:'Legacy Brand',parentGroupId:owner.companyId,mergedIntoId:null});
 expect((await prisma.source.findUniqueOrThrow({where:{key:source.key}})).config).toMatchObject({origin:'https://careers.example.com',brandProperty:'dept'});
 expect(await prisma.sourceObservation.count({where:{sourceKey:source.key,externalId:{in:['456','789']}}})).toBe(2);
 expect(await applyRepairPlan(prisma,plan,digest(plan),'test')).toMatchObject({alreadyApplied:true,written:0,sourceOwnerContradictions:0});
});
it('refuses a brand posting that names the owner, an off-domain proof or a repeated posting',async()=>{
 const {spec}=await fixture();const sha='b'.repeat(64),observedAt=new Date().toISOString();
 spec.sources[0].postings=[{externalId:'123',targetName:'Actual Group',targetKind:'BRAND',evidence:{url:'https://careers.example.com/job/x/123/',sha256:sha,property:'dept',value:'Actual Group',observedAt}}];
 await expect(planReviewedPortalOwners(prisma,spec)).rejects.toThrow('names the portal owner');
 spec.sources[0].postings=[{externalId:'123',targetName:'Other Brand',targetKind:'BRAND',evidence:{url:'https://evil.example.org/123',sha256:sha,property:'dept',value:'Other Brand',observedAt}}];
 await expect(planReviewedPortalOwners(prisma,spec)).rejects.toThrow('Invalid native brand evidence');
 const ok={externalId:'123',targetName:'Other Brand',targetKind:'BRAND' as const,evidence:{url:'https://careers.example.com/job/x/123/',sha256:sha,property:'dept',value:'Other Brand',observedAt}};
 spec.sources[0].postings=[ok,{...ok}];await expect(planReviewedPortalOwners(prisma,spec)).rejects.toThrow('repeated reviewed posting');
});
it('accepts per-posting evidence from the declared portal hosts of a vendor-hosted hub, and only from them',async()=>{
 const {spec}=await fixture();const sha=createHash('sha256').update('page').digest('hex'),observedAt=new Date().toISOString();
 const onHub={externalId:'123',targetName:'Other Brand',targetKind:'BRAND' as const,targetDomain:'otherbrand.com',evidence:{url:'https://stores-na-example.icims.com/jobs/123/x/job',sha256:sha,property:'jsonld.hiringOrganization.name',value:'Other Brand',observedAt}};
 spec.sources[0].postings=[onHub];
 await expect(planReviewedPortalOwners(prisma,spec)).rejects.toThrow('Invalid native brand evidence');
 spec.sources[0].portalHosts=['Hub-Example.icims.com'];await expect(planReviewedPortalOwners(prisma,spec)).rejects.toThrow('lowercase hostnames');
 spec.sources[0].portalHosts=['hub-example.icims.com','stores-na-example.icims.com'];
 const plan=await planReviewedPortalOwners(prisma,spec);expect(plan.ownerRules?.[0]?.postingOwners).toEqual({'123':'OTHER_BRAND'});
 expect(plan.operations.find(o=>o.entity==='Company'&&(o.patch as any).canonicalKey==='OTHER_BRAND')?.patch).toMatchObject({domain:'otherbrand.com',domainSource:'https://stores-na-example.icims.com/jobs/123/x/job'});
 spec.sources[0].postings=[onHub,{...onHub,externalId:'124',targetDomain:'www.otherbrand.com'}];await expect(planReviewedPortalOwners(prisma,spec)).rejects.toThrow('Invalid brand domain');
 spec.sources[0].postings=[onHub,{...onHub,externalId:'124',targetDomain:'elsewhere.com'}];await expect(planReviewedPortalOwners(prisma,spec)).rejects.toThrow('Conflicting brand domains');
 spec.sources[0].postings=[onHub];
 expect((plan.evidence as any).sources[0].portalHosts).toEqual(['hub-example.icims.com','stores-na-example.icims.com']);
 // The official proof of ownership itself must stay on the official domain.
 spec.sources[0].evidence=[{...spec.sources[0].evidence[0],url:'https://hub-example.icims.com/'}];await expect(planReviewedPortalOwners(prisma,spec)).rejects.toThrow('Invalid official ownership evidence');
});

it('splits brands out of a correctly owned portal: the owner is re-evaluated per posting and unreviewed postings stay with it',async()=>{
 const {company,source,job,spec}=await fixture();const sha=createHash('sha256').update('page').digest('hex'),observedAt=new Date().toISOString();
 const owner=await prisma.company.create({data:{name:'Actual Group',canonicalKey:'ACTUAL_GROUP',kind:'GROUP',fashionjobsUrl:'resolved:ACTUAL_GROUP'}});
 await prisma.job.updateMany({where:{id:job.id},data:{companyId:owner.id,clusterKey:'ACTUAL_GROUP|finance|paris',fingerprint:'ACTUAL_GROUP|finance|paris'}});
 const second=await prisma.job.create({data:{companyId:owner.id,externalId:'456',source:'SUCCESSFACTORS',title:'Sales',url:'https://careers.example.com/job/Milan-Sales/456/',fingerprint:'ACTUAL_GROUP|sales',clusterKey:'ACTUAL_GROUP|sales',isActive:true,firstSeenAt:new Date(),lastSeenAt:new Date(),sources:{create:{sourceKey:source.key,externalId:'456',url:'https://careers.example.com/job/Milan-Sales/456/',sourceTier:'EMPLOYER_DIRECT',isActive:true,firstSeenAt:new Date(),lastSeenAt:new Date(),raw:{}}}}});
 // A stores-route duplicate merged into `second` (redirect) must follow the employer of its canonical posting.
 const predecessor=await prisma.job.create({data:{companyId:owner.id,externalId:'456',source:'SUCCESSFACTORS',title:'Sales',url:'https://careers.example.com/job/Milan-Sales/456/?in_iframe=1',fingerprint:'ACTUAL_GROUP|sales|dup',clusterKey:'ACTUAL_GROUP|sales',isActive:false,mergedIntoId:second.id,firstSeenAt:new Date(),lastSeenAt:new Date(),events:{create:{type:'MERGED',field:'mergedInto',after:second.id}}}});
 await prisma.company.delete({where:{id:company.id}});
 spec.sources[0].fromCompanyIds=[owner.id];
 await expect(planReviewedPortalOwners(prisma,spec)).rejects.toThrow('Target is listed as a misattributed identity');
 // A posting that keeps its owner may be attested by another live source: nothing changes for it, so nothing needs review.
 await prisma.jobSource.create({data:{jobId:job.id,sourceKey:'other-board',externalId:'x-123',url:'https://board.example.org/x-123',sourceTier:'JOBBOARD',isActive:true,firstSeenAt:new Date(),lastSeenAt:new Date(),raw:{}}});
 spec.sources[0].postings=[{externalId:'456',targetName:'Actual Brand',targetKind:'BRAND',evidence:{url:'https://careers.example.com/job/Milan-Sales/456/',sha256:sha,property:'jsonld.hiringOrganization.name',value:'Actual Brand',observedAt}}];
 const plan=await planReviewedPortalOwners(prisma,spec);await applyRepairPlan(prisma,plan,digest(plan),'test');
 expect((await prisma.job.findUniqueOrThrow({where:{id:job.id}})).companyId).toBe(owner.id);
 const brand=await prisma.job.findUniqueOrThrow({where:{id:second.id},include:{company:true}});expect(brand.company).toMatchObject({name:'Actual Brand',parentGroupId:owner.id});expect(brand.clusterKey).toBe('ACTUAL_BRAND|sales');
 const redirected=await prisma.job.findUniqueOrThrow({where:{id:predecessor.id}});expect(redirected).toMatchObject({companyId:brand.companyId,mergedIntoId:second.id,isActive:false,clusterKey:'ACTUAL_BRAND|sales'});
 expect(await applyRepairPlan(prisma,plan,digest(plan),'test')).toMatchObject({alreadyApplied:true,written:0,sourceOwnerContradictions:0});
});

it('keeps a sub-label as a distinct brand: the attested related brand is recorded, the group stays the portal owner, no merge',async()=>{
 const {company,source,job,spec}=await fixture();const sha=createHash('sha256').update('page').digest('hex'),observedAt=new Date().toISOString();
 const second=await prisma.job.create({data:{companyId:company.id,externalId:'456',source:'SUCCESSFACTORS',title:'Movement',url:'https://careers.example.com/job/Milan-Sales/456/',fingerprint:'LEGACY_BRAND|movement',clusterKey:'LEGACY_BRAND|movement',isActive:true,firstSeenAt:new Date(),lastSeenAt:new Date(),sources:{create:{sourceKey:source.key,externalId:'456',url:'https://careers.example.com/job/Milan-Sales/456/',sourceTier:'EMPLOYER_DIRECT',isActive:true,firstSeenAt:new Date(),lastSeenAt:new Date(),raw:{}}}}});
 spec.sources[0].postings=[
  {externalId:'123',targetName:'Free Brand',targetKind:'BRAND',targetDomain:'freebrand.com',evidence:{url:'https://careers.example.com/job/Paris-Finance/123/',sha256:sha,property:'jsonld.hiringOrganization.name',value:'Free Brand',observedAt}},
  {externalId:'456',targetName:'FB Movement',targetKind:'BRAND',relatedBrandName:'Free Brand',evidence:{url:'https://careers.example.com/job/Milan-Sales/456/',sha256:sha,property:'jsonld.hiringOrganization.name',value:'FB Movement',observedAt}}];
 const good=spec.sources[0].postings;
 spec.sources[0].postings=[{...good[1],relatedBrandName:'Unknown Parent'}];await expect(planReviewedPortalOwners(prisma,spec)).rejects.toThrow('attested related brand');
 spec.sources[0].postings=good;
 const plan=await planReviewedPortalOwners(prisma,spec);await applyRepairPlan(prisma,plan,digest(plan),'test');
 const brand=await prisma.job.findUniqueOrThrow({where:{id:job.id},include:{company:true}});const sub=await prisma.job.findUniqueOrThrow({where:{id:second.id},include:{company:true}});
 expect(brand.company.name).toBe('Free Brand');expect(sub.company.name).toBe('FB Movement');expect(sub.company.id).not.toBe(brand.company.id);
 expect(sub.company).toMatchObject({parentGroup:'Actual Group',parentGroupId:brand.company.parentGroupId,identityReviewId:plan.batchId});
 const obs=await prisma.sourceObservation.findFirst({where:{sourceKey:source.key,externalId:'456',raw:{path:['reviewedEmployer','reviewId'],equals:plan.batchId}}});
 expect((obs?.raw as any).reviewedEmployer).toMatchObject({targetName:'FB Movement',attestedRelatedBrand:'Free Brand',attestedRelatedBrandId:brand.company.id});
});
