/** Compare every corrected real row with its before-image, including RAW and original history. */
import{PrismaClient}from'@prisma/client';import{readFileSync,writeFileSync}from'node:fs';import{digest,json}from'../../../apps/aggregator/src/remediation/plan.js';
const dir=process.argv.find(x=>x.startsWith('--dir='))?.slice(6);if(!dir)throw new Error('--dir required');
const manifest=JSON.parse(readFileSync(`${dir}/manifest.json`,'utf8'));const p=new PrismaClient();
try{const proof=await p.$transaction(async t=>{await t.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');const batches=[];
 for(const snapshot of manifest.snapshots){
  const planInfo=manifest.plans.find((p:any)=>p.batchId===snapshot.batchId);
  const plan=JSON.parse(readFileSync(planInfo.path,'utf8'));
  const jobs=await t.job.findMany({where:{id:{in:snapshot.jobs.map((j:any)=>j.id)}},omit:{searchText:true},orderBy:{id:'asc'}});
  const sources=await t.jobSource.findMany({where:{jobId:{in:jobs.map(j=>j.id)}},orderBy:{id:'asc'}});
  if(jobs.length!==snapshot.jobs.length||sources.length!==snapshot.sources.length)throw new Error('Cohort count changed');
  for(const j of jobs){const before=snapshot.jobs.find((b:any)=>b.id===j.id),op=plan.operations.find((o:any)=>o.entity==='Job'&&o.id===j.id);
   if(!op || j.postedAt?.toISOString()!==op.patch.postedAt || digest({...json(j),postedAt:before.postedAt,updatedAt:before.updatedAt})!==digest(before))throw new Error(`Unexpected Job change ${j.id}`);
  }
  for(const s of sources){const before=snapshot.sources.find((b:any)=>b.id===s.id),op=plan.operations.find((o:any)=>o.entity==='JobSource'&&o.id===s.id);
   if(op && s.postedAt?.toISOString()!==op.patch.postedAt)throw new Error('Representation date mismatch');
   if(digest({...json(s),postedAt:before.postedAt})!==digest(before))throw new Error(`RAW or representation changed ${s.id}`);
  }
  const events=await t.jobEvent.findMany({where:{jobId:{in:jobs.map(j=>j.id)}},orderBy:{id:'asc'}});
  for(const e of snapshot.history){const actual=events.find(a=>a.id===e.id);if(!actual||digest(actual)!==digest(e))throw new Error('Original history changed');}
  const corrections=events.filter(e=>e.type==='CORRECTED'&&e.after===snapshot.batchId);
  if(corrections.length!==jobs.length||events.length!==snapshot.history.length+jobs.length)throw new Error('Unexpected correction history');
  const ledger=await t.dataCorrection.findMany({where:{batchId:snapshot.batchId},select:{planHash:true,commitHash:true}});
  if(ledger.length!==plan.operations.length||ledger.some(e=>e.planHash!==planInfo.hash))throw new Error('Ledger mismatch');
  batches.push({batchId:snapshot.batchId,jobs:jobs.length,representations:sources.length,correctedEvents:corrections.length,ledger:ledger.length,commits:[...new Set(ledger.map(e=>e.commitHash))],rawPreserved:true,originalHistoryPreserved:true,otherJobFieldsPreserved:true});
 }
 return{at:new Date().toISOString(),evidenceHash:manifest.evidenceHash,batches,counts:await t.$queryRaw`SELECT count(*)::int AS active,count(*) FILTER(WHERE "postedAt" IS NULL)::int AS "withoutPublicationDate",count(*) FILTER(WHERE "isFrance")::int AS france FROM "Job" WHERE "isActive"`};
 },{timeout:180000});const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6);if(out)writeFileSync(out,JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof,null,2));}finally{await p.$disconnect()}
