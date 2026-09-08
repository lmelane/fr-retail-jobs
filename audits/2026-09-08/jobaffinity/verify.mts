import{PrismaClient}from'@prisma/client';import{readFileSync,writeFileSync}from'node:fs';import{digest}from'../../../apps/aggregator/src/remediation/plan.js';
const p=new PrismaClient();const root='/Users/lmelane/Downloads/catwalks-job-aggregator/backups/remediation-20260908';
try{const result=await p.$transaction(async t=>{await t.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');const sources=[];
for(const key of ['intersport-france','blackstore']){
 const captured=JSON.parse(readFileSync(root+'/'+key+'-live-adapter.json','utf8'));const expected=new Map<string,any>(captured.jobs.filter((j:any)=>!j.publicationHold).map((j:any)=>[j.externalId,j]));
 const held=captured.jobs.filter((j:any)=>j.publicationHold);const actual=await t.jobSource.findMany({where:{sourceKey:key},include:{job:{include:{company:true}}}});
 if(actual.length!==expected.size)throw new Error(`${key}: count discrepancy ${actual.length}/${expected.size}`);
 let rawSame=0;for(const s of actual){const e=expected.get(s.externalId);if(!e||!s.isActive||!s.job.isActive||s.url!==e.url||s.job.company.canonicalKey!==(e.company==='Blackstore'?'BLACKSTORE':'INTERSPORT'))throw new Error(`Identity/activity mismatch ${s.externalId}`);
  if(s.postedAt?.toISOString()!==e.postedAt)throw new Error(`Representation date mismatch ${s.externalId}`);
  if(e.country&&s.job.countryCode!==e.country)throw new Error(`Country mismatch ${s.externalId}`);
  if(digest(s.raw)===digest(e.raw))rawSame++;
 }
 for(const h of held){if(await t.jobSource.count({where:{sourceKey:key,externalId:h.externalId}}))throw new Error('Held job published');if(!await t.sourceObservation.count({where:{sourceKey:key,externalId:h.externalId}}))throw new Error('Held evidence lost');}
 sources.push({key,representations:actual.length,uniqueJobs:new Set(actual.map(s=>s.jobId)).size,rawSame,rawChanged:actual.length-rawSame,held:held.length,rawPresent:actual.filter(s=>s.raw).length,source:await t.source.findUnique({where:{key},select:{status:true,lastRunStatus:true,lastRunJobs:true}}),latestRun:await t.sourceRun.findFirst({where:{sourceKey:key},orderBy:{ranAt:'desc'},select:{ranAt:true,complete:true,canAttestAbsence:true,errors:true,fetched:true,accepted:true,note:true}})});
}
const rows=await t.jobSource.findMany({where:{sourceKey:{in:['intersport-france','blackstore']}},include:{job:true}});const ids=[...new Set(rows.map(s=>s.jobId))];
return{at:new Date().toISOString(),sources,uniqueNewJobs:ids.length,sharedJobs:rows.length-ids.length,newFrance:rows.filter((r,i,a)=>a.findIndex(s=>s.jobId===r.jobId)===i&&r.job.isFrance).length,newMissingCountry:rows.filter((r,i,a)=>a.findIndex(s=>s.jobId===r.jobId)===i&&!r.job.countryCode).length,totals:{active:await t.job.count({where:{isActive:true}}),france:await t.job.count({where:{isActive:true,isFrance:true}}),companies:await t.company.count(),sources:await t.source.count(),activeSources:await t.source.count({where:{status:'ACTIVE'}})},newCompanyRows:await t.company.findMany({where:{canonicalKey:{in:['INTERSPORT','BLACKSTORE']}},select:{id:true,name:true,kind:true,sector:true,parentGroup:true}})};
},{timeout:120000});const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6);if(out)writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}finally{await p.$disconnect()}
