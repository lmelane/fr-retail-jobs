import { PrismaClient } from '@prisma/client';
import {readFileSync,writeFileSync} from 'node:fs';
const p=new PrismaClient();const chain=JSON.parse(readFileSync('backups/remediation-20260908/source-identity-chain.json','utf8'));
const keys=chain.filter((s:any)=>s.status==='ACTIVE'&&s.history.length===1&&s.history[0].verified==='validated-name').map((s:any)=>s.key);
const contradicted=['via','ashoka','coast','blend','tala','ion','gate','didi','fay','honor','hone','cleo','gridline','novara','sep','public','galileo','eclipse','seer','yes'];
const result=await p.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return {
 at:new Date().toISOString(),namesOnlySources:keys.length,
 jobsAffectedByNameOnlyHistory:await tx.job.count({where:{isActive:true,sources:{some:{isActive:true,sourceKey:{in:keys}}}}}),
 contradictedSources:contradicted.length,
 contradictedActiveJobs:await tx.job.count({where:{isActive:true,sources:{some:{isActive:true,sourceKey:{in:contradicted}}}}}),
 contradictedOtherSources:await tx.job.count({where:{isActive:true,AND:[{sources:{some:{isActive:true,sourceKey:{in:contradicted}}}},{sources:{some:{isActive:true,sourceKey:{notIn:contradicted}}}}]}}),
 labelledGroupSources:await tx.source.findMany({where:{key:{in:['parfums-chanel','l-oreal-professionnel','sandro','browns']}},select:{key:true,maison:true,kind:true,config:true}}),
 counts:await tx.jobSource.groupBy({by:['sourceKey'],where:{isActive:true,sourceKey:{in:['parfums-chanel','l-oreal-professionnel','sandro','browns']},job:{isActive:true}},_count:true})
 };},{timeout:25000});
writeFileSync('audits/2026-09-08/remediation/identity-scope.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await p.$disconnect();
