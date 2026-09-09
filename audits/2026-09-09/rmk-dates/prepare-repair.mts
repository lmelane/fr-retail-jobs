/** Freeze date-only corrections after re-reading the current rows. No writes. */
import {PrismaClient} from '@prisma/client';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {digest,json,type RepairPlan} from '../../../apps/aggregator/src/remediation/plan.js';
import {parseRmkDate} from '../../../apps/aggregator/src/ats/adapters/successfactors.js';
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);if(!out)throw new Error('--out required');mkdirSync(out,{recursive:true});
const evidence=JSON.parse(readFileSync('audits/2026-09-09/rmk-dates/measurement.json','utf8'));
const db=new PrismaClient();
try{const manifest=await db.$transaction(async tx=>{
 await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
 const ids=evidence.changed.map((q:any)=>q.jobId);
 const jobs=await tx.job.findMany({where:{id:{in:ids}},omit:{searchText:true},orderBy:{id:'asc'}});
 const sources=await tx.jobSource.findMany({where:{jobId:{in:ids}},orderBy:{id:'asc'}});
 const history=await tx.jobEvent.findMany({where:{jobId:{in:ids}},orderBy:{id:'asc'}});
 if(jobs.length!==ids.length)throw new Error('Missing cohort rows');
 const operations:RepairPlan['operations']=[];
 for(const q of evidence.changed){
  const job=jobs.find(j=>j.id===q.jobId)!;const source=sources.find(s=>s.id===q.sourceId);const raw=source?.raw as Record<string,any>;
  if(!source || digest(raw)!==q.rawHash || source.postedAt?.toISOString()!==q.beforeSource || job.postedAt?.toISOString()!==q.beforeJob)throw new Error(`Changed target ${q.jobId}; measure again`);
  if(parseRmkDate(raw.unifiedStandardStart,raw.locale)?.toISOString()!==q.after)throw new Error('Parser does not reproduce reviewed date');
  if(sources.some(s=>s.jobId===job.id&&s.id!==source.id))throw new Error('Multiple representations need a reviewed consensus');
  const reason=JSON.stringify({field:'postedAt',rawField:'unifiedStandardStart',rawValue:q.rawDate,locale:q.locale,rawHash:q.rawHash,parserVersion:'rmk-locale-calendar-v1',evidence:'audits/2026-09-09/rmk-dates/source-semantics.json'});
  operations.push({entity:'JobSource',id:source.id,before:json(source),patch:{postedAt:q.after},reason});
  operations.push({entity:'Job',id:job.id,before:json(job),patch:{postedAt:q.after},reason});
 }
 const batchId='20260909-RMK-LOCALE-DATES-v1';
 const plan:RepairPlan={version:1,batchId,finding:'Douglas US publication dates parsed as day/month',createdAt:new Date().toISOString(),sourceKeys:['douglas-sf'],companyIds:[...new Set(jobs.map(j=>j.companyId))].sort(),operations,evidence:{manifestHash:digest(evidence),manifestPath:'audits/2026-09-09/rmk-dates/measurement.json',rule:'Decode original recorded publication date using recorded RMK locale; preserve RAW and lifecycle.'},invariants:['oracle','lifecycle']};
 const path=`${out}/${batchId}.json`;writeFileSync(path,JSON.stringify(plan,null,2)+'\n',{mode:0o600});
 return{at:new Date().toISOString(),evidenceHash:digest(evidence),jobs:jobs.length,plans:[{batchId,path,hash:digest(plan),jobs:jobs.length,operations:operations.length}],snapshots:[{batchId,jobs:json(jobs),sources:json(sources),history:json(history)}]};
},{timeout:30000});writeFileSync(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({...manifest,snapshots:undefined}));
}finally{await db.$disconnect()}
