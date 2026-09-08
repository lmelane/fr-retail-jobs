/** Reviewed onboarding; existing companies are reconciled, never duplicated. */
import{readFileSync}from'node:fs';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';
import{PrismaClient,Prisma}from'@prisma/client';import{digest,json}from'../../../apps/aggregator/src/remediation/plan.js';
import{tenantKeyOf}from'../../../apps/aggregator/src/connectors/sourceStore.js';import{sourceSubjectKey,sourceIdentityHash,assertIdentityReview}from'../../../apps/aggregator/src/connectors/sourceIdentity.js';import{lockSourceWrites}from'../../../apps/aggregator/src/lib/writeLocks.js';
const manifest=JSON.parse(readFileSync('audits/2026-09-08/jobaffinity/certificates.json','utf8'));const sha=digest(manifest);
const arg=(k:string)=>process.argv.find(x=>x.startsWith(`--${k}=`))?.slice(k.length+3);const apply=process.argv.includes('--apply'),commit=arg('commit')??'LOCAL-REHEARSAL';
if(apply&&arg('sha')!==sha)throw new Error('Exact manifest hash required');
if(apply&&!['localhost','127.0.0.1','::1'].includes(new URL(process.env.DATABASE_URL!).hostname)){
 if(commit!==execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim())throw new Error('Exact committed checkout required');execFileSync('git',['merge-base','--is-ancestor',commit,'origin/main']);
 if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw new Error('Clean checkout required');
}
const db=new PrismaClient();try{const out=await db.$transaction(async t=>{
 if(!apply)await t.$executeRawUnsafe('SET TRANSACTION READ ONLY');
 const before={jobs:await t.job.count(),sources:await t.jobSource.count(),events:await t.jobEvent.count()};const results=[];
 for(const r of manifest.records){
  const artifactText=readFileSync(r.artifactPath,'utf8');if(createHash('sha256').update(artifactText).digest('hex')!==r.artifactHash)throw new Error('Identity artifact changed');
  if(Date.now()-Date.parse(r.checkedAt)>86400000)throw new Error('Fresh validation required');
  if(apply)await lockSourceWrites(t,r.key,true);
  const prior=await t.dataCorrection.findFirst({where:{batchId:manifest.batchId,entityType:'Source',entityId:r.key}});
  if(prior){if(prior.planHash!==sha)throw new Error('Existing manifest differs');results.push({key:r.key,written:0,idempotent:true});continue;}
  const tenantKey=tenantKeyOf('jobaffinity-wordpress',JSON.stringify(r.config));
  if(await t.source.findFirst({where:{OR:[{key:r.key},{tenantKey}]}}))throw new Error('Source/tenant already exists');
  const existing=await t.company.findUnique({where:{fashionjobsUrl:`resolved:${r.canonicalKey}`}});
  if(r.existingCompanyId?(existing?.id!==r.existingCompanyId||digest(json(existing))!==r.beforeCompanyHash):Boolean(existing))throw new Error(`Company before-image changed: ${r.key}`);
  const aliases=await t.companyAlias.findMany({where:{aliasKey:{in:r.aliases}}});if(aliases.some(a=>a.companyId!==existing?.id))throw new Error('Alias belongs to another company');
  if(!apply){results.push({key:r.key,company:existing?'UPDATE':'CREATE',status:'DRAFT',publishable:r.publishable});continue;}
  const patch={name:r.name,canonicalKey:r.canonicalKey,sector:r.sector,kind:'RETAILER' as const,parentGroup:r.parentGroup,careersUrl:r.config.listingUrl};
  const company=existing?await t.company.update({where:{id:existing.id},data:patch}):await t.company.create({data:{...patch,domain:r.domain,domainSource:'manual',fashionjobsUrl:`resolved:${r.canonicalKey}`,discoveryStatus:'FOUND',atsType:'JOBAFFINITY_WORDPRESS',atsConfig:r.config,discoveryNote:r.statement}});
  for(const aliasKey of r.aliases)if(!aliases.some(a=>a.aliasKey===aliasKey))await t.companyAlias.create({data:{aliasKey,displayName:r.name,companyId:company.id}});
  const source=await t.source.create({data:{key:r.key,maison:r.name,kind:'jobaffinity-wordpress',config:r.config,careersDomain:new URL(r.config.listingUrl).hostname,tenantKey,tier:'ATS_OFFICIAL',status:'DRAFT',verifiedJobCount:r.publishable,robotsVerdict:'ALLOWED',robotsCheckedAt:new Date(r.checkedAt),note:r.statement}});
  const review={sourceKey:r.key,tenantKey,subjectKey:sourceSubjectKey(source),sourceHash:sourceIdentityHash(source),verdict:'VERIFIED',method:'OFFICIAL_LINK',officialDomain:r.domain,proofUrl:r.proofUrl,portalUrl:r.config.listingUrl,statement:r.statement,artifactHash:r.artifactHash,artifactText,reviewer:'Codex — user-authorized official identity review',checkedAt:new Date(r.checkedAt)};assertIdentityReview(source,review as any);await t.sourceIdentityReview.create({data:review});
  for(const[entityType,entityId,old,after]of[['Company',company.id,existing,company],['Source',r.key,null,source]] as const)await t.dataCorrection.create({data:{batchId:manifest.batchId,planHash:sha,commitHash:commit,finding:'jobaffinity-direct-portals',entityType,entityId,before:old?json(old):Prisma.JsonNull,after:json(after),evidence:json(r)}});
  results.push({key:r.key,companyId:company.id,status:source.status,identity:'VERIFIED',written:1});
 }
 const after={jobs:await t.job.count(),sources:await t.jobSource.count(),events:await t.jobEvent.count()};if(digest(before)!==digest(after))throw new Error('Onboarding changed jobs/history');return{batchId:manifest.batchId,sha,apply,before,after,results};
},{timeout:60000,isolationLevel:'Serializable'});console.log(JSON.stringify(out,null,2));}finally{await db.$disconnect()}
