/** Stage reviewed direct sources using the existing identity + promotion gates.
 * Default read-only; no job writes, activation or ingestion in this command.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient, Prisma } from '@prisma/client';
import { digest, json } from '../../../apps/aggregator/src/remediation/plan.js';
import { tenantKeyOf } from '../../../apps/aggregator/src/connectors/sourceStore.js';
import { assertIdentityReview, sourceIdentityHash, sourceSubjectKey } from '../../../apps/aggregator/src/connectors/sourceIdentity.js';
import { lockSourceWrites } from '../../../apps/aggregator/src/lib/writeLocks.js';
import { canonicalCompanyKey } from '../../../apps/aggregator/src/lib/normalize.js';
import { parseFlatchrBoard } from '../../../apps/aggregator/src/ats/adapters/flatchr.js';
const path = 'audits/2026-09-08/direct-sources/flatchr-certificates.json';
const manifest = JSON.parse(readFileSync(path,'utf8'));
const sha = digest(manifest);
const apply = process.argv.includes('--apply');
const arg = (n:string)=>process.argv.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const commit = arg('commit') ?? 'LOCAL-REHEARSAL';
if (apply && arg('sha') !== sha) throw new Error('Explicit manifest SHA required');
const isLocal = ['localhost','127.0.0.1','::1'].includes(new URL(process.env.DATABASE_URL!).hostname);
if (apply && !isLocal) {
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 if(commit!==head || !/^[a-f0-9]{40}$/.test(commit))throw new Error('Production requires exact committed checkout');
 execFileSync('git',['merge-base','--is-ancestor',commit,'origin/main']);
 if(execFileSync('git',['status','--porcelain','--untracked-files=all'],{encoding:'utf8'}).trim())throw new Error('Production requires clean checkout');
}
const records=manifest.records.map((r:any)=>{
 const artifactText=readFileSync(r.paths.official,'utf8');
 const html=readFileSync(r.paths.board,'utf8');
 for(const [text,hash] of [[artifactText,r.officialHash],[html,r.boardHash],[readFileSync(r.paths.robots,'utf8'),r.robotsHash]]) {
  if(createHash('sha256').update(text).digest('hex')!==hash)throw new Error(`Artifact mismatch ${r.key}`);
 }
 const parsed=parseFlatchrBoard(html,r.portal);
 if(!parsed.complete || digest(parsed.jobs.map(j=>j.externalId).sort())!==digest(r.ids))throw new Error(`Enumeration mismatch ${r.key}`);
 if(Date.now()-new Date(r.checkedAt).getTime()>86400000)throw new Error('Revalidate source evidence older than 24 hours');
 return {...r,artifactText};
});
const db=new PrismaClient();
try {
 const result=await db.$transaction(async tx=>{
  if(!apply)await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const before={jobs:await tx.job.count(),events:await tx.jobEvent.count(),representations:await tx.jobSource.count()};
  const results=[];
  for(const r of records){
   if(apply)await lockSourceWrites(tx,r.key,true);
   const ledger=await tx.dataCorrection.findFirst({where:{batchId:manifest.batchId,entityType:'Source',entityId:r.key}});
   if(ledger){if(ledger.planHash!==sha)throw new Error('Existing batch hash differs');results.push({key:r.key,written:0,idempotent:true});continue;}
   const config={listingUrl:r.portal};const tenantKey=tenantKeyOf('flatchr',JSON.stringify(config));
   const source=await tx.source.findFirst({where:{OR:[{key:r.key},{tenantKey}]}});
   const aliases=r.aliases.map((a:string)=>canonicalCompanyKey(a));
   const existing=await tx.company.findFirst({where:{OR:[{canonicalKey:r.canonicalKey},{fashionjobsUrl:`resolved:${r.canonicalKey}`},{aliases:{some:{aliasKey:{in:aliases}}}}]}});
   if(source||existing)throw new Error(`Existing entity needs reviewed reconciliation: ${r.key}`);
   if(!apply){results.push({key:r.key,createCompany:r.canonicalKey,createSource:'DRAFT',jobsToValidate:r.jobs});continue;}
   const company=await tx.company.create({data:{name:r.name,canonicalKey:r.canonicalKey,kind:r.kind,sector:r.sector,
     domain:r.domain,domainSource:'manual',fashionjobsUrl:`resolved:${r.canonicalKey}`,careersUrl:r.portal,
     atsType:'FLATCHR',atsConfig:config,discoveryStatus:'FOUND',lastAtsDiscoveryAt:new Date(r.checkedAt),
     discoveryNote:r.identityStatement}});
   for(const displayName of r.aliases)await tx.companyAlias.create({data:{companyId:company.id,aliasKey:canonicalCompanyKey(displayName),displayName}});
   const staged=await tx.source.create({data:{key:r.key,maison:r.name,kind:'flatchr',careersDomain:new URL(r.portal).hostname,
     config,tenantKey,tier:'ATS_OFFICIAL',status:'DRAFT',robotsVerdict:r.robotsVerdict,robotsCheckedAt:new Date(r.checkedAt),
     verifiedJobCount:r.jobs,note:`${r.identityStatement} Enumeration evidence ${r.boardHash}; manifest ${sha}; parent group not reviewed.`}});
   const review={sourceKey:r.key,tenantKey,subjectKey:sourceSubjectKey(staged),sourceHash:sourceIdentityHash(staged),
     verdict:'VERIFIED',method:'OFFICIAL_LINK',officialDomain:r.domain,proofUrl:r.official,portalUrl:r.portal,
     statement:r.identityStatement,artifactHash:r.officialHash,artifactText:r.artifactText,
     reviewer:'Codex — official-domain evidence reviewed for user-authorized onboarding',checkedAt:new Date(r.checkedAt)};
   assertIdentityReview(staged,review as any);
   await tx.sourceIdentityReview.create({data:review});
   for(const [entityType,entityId,after] of [['Company',company.id,company],['Source',r.key,staged]] as const){
    await tx.dataCorrection.create({data:{batchId:manifest.batchId,planHash:sha,commitHash:commit,finding:'direct-source-onboarding',
     entityType,entityId,before:Prisma.JsonNull,after:json(after),evidence:json({...r,artifactText:undefined})}});
   }
   results.push({key:r.key,companyId:company.id,status:staged.status,identity:'VERIFIED',written:1});
  }
  const after={jobs:await tx.job.count(),events:await tx.jobEvent.count(),representations:await tx.jobSource.count()};
  if(digest(before)!==digest(after))throw new Error('Staging must not change jobs/history');
  return {batchId:manifest.batchId,sha,apply,before,after,results};
 },{timeout:60000,isolationLevel:'Serializable'});
 console.log(JSON.stringify(result,null,2));
}finally{await db.$disconnect();}
