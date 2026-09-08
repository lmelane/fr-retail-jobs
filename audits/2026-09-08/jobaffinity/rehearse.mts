/** Real captured jobs through the canonical production writer; local DB only. */
import{PrismaClient}from'@prisma/client';import{readFileSync,writeFileSync}from'node:fs';import{upsertDeduplicated}from'../../../apps/aggregator/src/dedup/upsert.js';import{toCandidate}from'../../../apps/aggregator/src/pipeline/ingest.js';import{archivePublicationHold}from'../../../apps/aggregator/src/pipeline/publicationHold.js';
if(!['localhost','127.0.0.1','::1'].includes(new URL(process.env.DATABASE_URL!).hostname))throw new Error('Local rehearsal only');
const p=new PrismaClient(),base='/Users/lmelane/Downloads/catwalks-job-aggregator/backups/remediation-20260908';
try{const before={active:await p.job.count({where:{isActive:true}}),france:await p.job.count({where:{isFrance:true,isActive:true}})};const runs=[];
for(const[key,company]of[['intersport-france','Intersport'],['blackstore','Blackstore']]){
 const captured=JSON.parse(readFileSync(base+'/'+key+'-live-adapter.json','utf8'));const counts={created:0,merged:0,updated:0,held:0};
 for(const j of captured.jobs){j.postedAt=j.postedAt?new Date(j.postedAt):undefined;j.publicationWithdrawnAt=j.publicationWithdrawnAt?new Date(j.publicationWithdrawnAt):undefined;
  if(j.publicationHold){await archivePublicationHold(p,key,j);counts.held++;continue;}
  const result=await upsertDeduplicated(p,toCandidate(j,{key,company,tier:'ATS_OFFICIAL'},j.company,'JOBAFFINITY_WORDPRESS'));counts[result.outcome.toLowerCase() as 'created'|'merged'|'updated']++;
 }
 runs.push({key,...counts});
}
const after={active:await p.job.count({where:{isActive:true}}),france:await p.job.count({where:{isFrance:true,isActive:true}})};const proof={at:new Date().toISOString(),before,runs,after};writeFileSync('audits/2026-09-08/jobaffinity/rehearsal.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));}finally{await p.$disconnect()}
