/** Produce bounded, atomic date-only repair plans from the reviewed live/RAW evidence. */
import{PrismaClient}from'@prisma/client';import{readFileSync,writeFileSync,mkdirSync}from'node:fs';
import{digest,json,type RepairPlan}from'../../../apps/aggregator/src/remediation/plan.js';
import{plausiblePostedAt}from'../../../apps/aggregator/src/lib/normalize.js';
const arg=(n:string)=>process.argv.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const evidence=JSON.parse(readFileSync('backups/remediation-20260908/dates-recovery-evidence.json','utf8'));
const dir=arg('out');if(!dir)throw new Error('--out required');mkdirSync(dir,{recursive:true});
const db=new PrismaClient();
try{
 const result=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  const plans=[];const snapshots=[];
  const qualified=evidence.qualified.sort((a:any,b:any)=>a.jobId.localeCompare(b.jobId));
  for(let offset=0;offset<qualified.length;offset+=250){
   const cohort=qualified.slice(offset,offset+250);const ids=cohort.map((j:any)=>j.jobId);
   const jobs=await tx.job.findMany({where:{id:{in:ids}},omit:{searchText:true},orderBy:{id:'asc'}});
   const sources=await tx.jobSource.findMany({where:{jobId:{in:ids}},orderBy:{id:'asc'}});
   if(jobs.length!==cohort.length)throw new Error('Missing cohort rows');
   const operations:RepairPlan['operations']=[];
   for(const q of cohort){
    const job=jobs.find(j=>j.id===q.jobId)!;
    if(!job.isActive || job.postedAt!==null || !plausiblePostedAt(new Date(q.postedAt)))throw new Error(`Changed or invalid target ${job.id}`);
    const witnesses=[];
    for(const r of q.representations){
     const source=sources.find(s=>s.jobId===job.id&&s.sourceKey===r.sourceKey&&s.externalId===r.externalId);
     if(!source || !source.isActive || source.postedAt!==null)throw new Error(`Changed representation ${r.externalId}`);
     if(r.evidence.rawHash && digest(source.raw)!==r.evidence.rawHash)throw new Error('Archived RAW no longer matches');
     witnesses.push(r.evidence);
     operations.push({entity:'JobSource',id:source.id,before:json(source),patch:{postedAt:q.postedAt},reason:JSON.stringify({field:'postedAt',sourceKey:r.sourceKey,externalId:r.externalId,...r.evidence})});
    }
    if(!witnesses.length)throw new Error('Date without source proof');
    operations.push({entity:'Job',id:job.id,before:json(job),patch:{postedAt:q.postedAt},reason:JSON.stringify({field:'postedAt',witnesses})});
   }
   const batchId=`20260908-ORIGINAL-PUBLICATION-DATES-v1-${String(plans.length+1).padStart(2,'0')}`;
   const plan:RepairPlan={version:1,batchId,finding:'Employer publication date omitted',createdAt:new Date().toISOString(),
    sourceKeys:[...new Set(sources.map(s=>s.sourceKey))].sort(),companyIds:[],operations,
    evidence:{manifestHash:digest(evidence),manifestPath:'audits/2026-09-08/publication-dates/recovery-evidence.json',rule:'Only unanimous, plausible employer dates; firstSeenAt is never a fallback.'},invariants:['oracle','lifecycle']};
   const path=`${dir}/${batchId}.json`;writeFileSync(path,JSON.stringify(plan,null,2)+'\n',{mode:0o600});
   plans.push({batchId,path,hash:digest(plan),jobs:jobs.length,operations:operations.length});
   const history=await tx.jobEvent.findMany({where:{jobId:{in:ids}},orderBy:{id:'asc'}});
   snapshots.push({batchId,jobs:json(jobs),sources:json(sources),history:json(history)});
  }
  return{at:new Date().toISOString(),evidenceHash:digest(evidence),jobs:qualified.length,plans,snapshots};
 },{timeout:180000});
 writeFileSync(`${dir}/manifest.json`,JSON.stringify(result,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({...result,snapshots:undefined},null,2));
}finally{await db.$disconnect()}
