/** Reviewed group repair. Reads real production/copy data; writes only local evidence.
 * Apply the emitted plan through the existing remediation CLI, never this script.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { digest, json, type RepairPlan } from '../../../apps/aggregator/src/remediation/plan.js';
import { parseFlatchrBoard } from '../../../apps/aggregator/src/ats/adapters/flatchr.js';
import { findMaison } from '../../../apps/aggregator/src/normalize/maisons.js';
const arg=(n:string)=>process.argv.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const db=new PrismaClient();
const manifest=JSON.parse(readFileSync('audits/2026-09-08/direct-sources/flatchr-certificates.json','utf8'));
const keys=['riu-paris','toscane'];
try {
 const snapshot=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  const companies=[];const evidence=[];
  for(const key of keys){
   const r=manifest.records.find((r:any)=>r.key===key);
   const parsed=parseFlatchrBoard(readFileSync(r.paths.board,'utf8'),r.portal);
   if(!parsed.complete || parsed.jobs.some(j=>(j.raw as any)?.vacancy?.company?.group!=='Armand Thiery'))throw new Error(`Source group not proven: ${key}`);
   const matches=await tx.company.findMany({where:{canonicalKey:r.canonicalKey}});
   if(matches.length!==1)throw new Error(`Ambiguous company: ${key}`);
   const company=matches[0];
   companies.push(company);
   const representations=await tx.jobSource.findMany({where:{sourceKey:key},orderBy:{id:'asc'}});
   if(representations.length!==r.expected)throw new Error(`Unexpected cohort ${key}`);
   const jobs=await tx.job.findMany({where:{id:{in:representations.map(r=>r.jobId)}},orderBy:{id:'asc'}});
   if(jobs.some(j=>j.companyId!==company.id))throw new Error(`Foreign employer ${key}`);
   // Company group changes deliberately refresh Job.searchText via the DB
   // trigger. Verify that projection exactly; every other Job field is retained.
   const search=(j:typeof jobs[number],group:string|null)=>[j.title,j.description,j.city,j.location,j.department,j.employmentTerm,company.name,group].map(v=>v??'').join(' ');
   if(jobs.some(j=>j.searchText!==search(j,company.parentGroup)))throw new Error(`Search index inconsistent ${key}`);
   const events=await tx.jobEvent.findMany({where:{jobId:{in:jobs.map(j=>j.id)}},orderBy:{id:'asc'}});
   const expected=new Map(parsed.jobs.map(j=>[j.externalId,digest(j.raw)]));
   if(representations.some(r=>expected.get(r.externalId)!==digest(r.raw)))throw new Error(`RAW changed ${key}`);
   evidence.push({sourceKey:key,portal:r.portal,officialProof:r.official,boardHash:r.boardHash,
    path:'vacancy.company.group',sourceValue:'Armand Thiery',reviewedConfidence:'HIGH',
    companyId:company.id,parentGroup:company.parentGroup,jobs:jobs.length,
    jobsHash:digest(jobs),jobsWithNullGroupSearchHash:digest(jobs.map(j=>({...j,searchText:search(j,null)}))),
    searchIndexConsistent:true,representationsHash:digest(representations),eventsHash:digest(events),events:events.length});
  }
  return json({at:new Date().toISOString(),companies,evidence});
 },{timeout:60000});
 if(arg('plan')){
  if(snapshot.companies.some(c=>c.parentGroup!==null))throw new Error('Before-image must have null group');
  const plan:RepairPlan={version:1,batchId:'20260908-FLATCHR-REVIEWED-GROUPS-v1',finding:'Flatchr reviewed parent group omitted',
   createdAt:snapshot.at,sourceKeys:keys,companyIds:snapshot.companies.map(c=>c.id),
   operations:snapshot.companies.map(c=>({entity:'Company',id:c.id,before:c,patch:{parentGroup:'Armand Thiery'},
    reason:'All archived postings on this verified employer portal explicitly name Armand Thiery as group; reviewed reference now retains it.'})),
   evidence:{sources:snapshot.evidence,originalManifestHash:digest(manifest)},invariants:['oracle','lifecycle']};
  writeFileSync(arg('plan')!,JSON.stringify(plan,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({plan:arg('plan'),hash:digest(plan),operations:plan.operations.length}));
 }
 if(arg('before')){
  const before=JSON.parse(readFileSync(arg('before')!,'utf8'));
  for(const e of snapshot.evidence){
   const b=before.evidence.find((b:any)=>b.sourceKey===e.sourceKey);
   if(!b || b.parentGroup!==null || e.parentGroup!==findMaison(snapshot.companies.find(c=>c.id===e.companyId)!.name)?.group || e.parentGroup!=='Armand Thiery' ||
    e.jobsWithNullGroupSearchHash!==b.jobsHash || ['representationsHash','eventsHash'].some(k=>(e as any)[k]!==b[k]))throw new Error(`Repair postcondition failed: ${e.sourceKey}`);
  }
 }
 if(arg('out'))writeFileSync(arg('out')!,JSON.stringify(snapshot,null,2)+'\n');
 console.log(JSON.stringify(snapshot.evidence,null,2));
} finally {await db.$disconnect();}
