/** Compare every real source identity and RAW row to the reviewed payload. Read-only. */
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { parseFlatchrBoard } from '../../../apps/aggregator/src/ats/adapters/flatchr.js';
import { normalizeCountry } from '../../../apps/aggregator/src/normalize/country.js';
import { digest } from '../../../apps/aggregator/src/remediation/plan.js';
const manifest=JSON.parse(readFileSync('audits/2026-09-08/direct-sources/flatchr-certificates.json','utf8'));
const db=new PrismaClient();
try{
 const result=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  const sources=[];
  for(const r of manifest.records){
   const parsed=parseFlatchrBoard(readFileSync(r.paths.board,'utf8'),r.portal);
   const rows=await tx.jobSource.findMany({where:{sourceKey:r.key},include:{job:{include:{company:true}}},orderBy:{externalId:'asc'}});
   const expected=new Map(parsed.jobs.map(j=>[j.externalId,j]));
   if(rows.length!==expected.size || new Set(rows.map(j=>j.jobId)).size!==expected.size)throw new Error(`Count/merge discrepancy ${r.key}`);
   const countries:Record<string,number>={};let rawExact=0;
   for(const row of rows){
    const e=expected.get(row.externalId);if(!e)throw new Error(`Unexpected id ${row.externalId}`);
    if(!row.isActive || !row.job.isActive || row.job.countryCode!==normalizeCountry(e.country) ||
       row.job.isFrance!==(normalizeCountry(e.country)==='FR') || row.job.company.canonicalKey!==r.canonicalKey ||
       row.url!==e.url || !row.raw)throw new Error(`Canonical discrepancy ${row.externalId}`);
    if(digest(row.raw)===digest(e.raw))rawExact++;
    countries[row.job.countryCode!]=(countries[row.job.countryCode!]??0)+1;
   }
   const source=await tx.source.findUniqueOrThrow({where:{key:r.key},select:{key:true,status:true,lastRunJobs:true,lastRunStatus:true}});
   const review=await tx.sourceIdentityReview.findFirst({where:{sourceKey:r.key},orderBy:{createdAt:'desc'},select:{verdict:true,sourceHash:true,artifactHash:true}});
   const latestRun=await tx.sourceRun.findFirst({where:{sourceKey:r.key},orderBy:{ranAt:'desc'},select:{status:true,fetched:true,accepted:true,declaredTotal:true,truncated:true,complete:true,canAttestAbsence:true,ranAt:true,errors:true}});
   sources.push({...source,review,latestRun,jobs:rows.length,uniqueJobIds:new Set(rows.map(j=>j.jobId)).size,countries,
    rawExactAgainstArchivedPayload:rawExact,rawPresent:rows.length,rawChangedSinceArchive:rows.length-rawExact,
    nullJobFunction:rows.filter(x=>!x.job.jobFunction).length,idsHash:digest(rows.map(x=>x.externalId).sort())});
  }
  return {at:new Date().toISOString(),sources,
   allJobs:await tx.job.count(),activeJobs:await tx.job.count({where:{isActive:true}}),france:await tx.job.count({where:{isActive:true,isFrance:true}}),
   allRepresentations:await tx.jobSource.count(),allEvents:await tx.jobEvent.count(),
   fashionjobs:await tx.source.findUnique({where:{key:'fashionjobs'},select:{status:true,lastRunAt:true}})};
 },{timeout:60000});
 const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);if(out)writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}finally{await db.$disconnect();}
