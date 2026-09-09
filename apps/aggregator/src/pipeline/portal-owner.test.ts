import '../test/setup-integration.js';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { sourceIdentityHash } from '../connectors/sourceIdentity.js';
import { planReviewedPortalOwners, type PortalOwnerReview } from '../remediation/portalOwner.js';
import { applyRepairPlan, digest } from '../remediation/plan.js';
const prisma = new PrismaClient();
beforeEach(async () => { await prisma.job.deleteMany(); await prisma.company.deleteMany(); await prisma.source.deleteMany({where:{key:'owner-fixture'}}); });
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
