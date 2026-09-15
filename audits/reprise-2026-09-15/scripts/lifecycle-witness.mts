import {PrismaClient} from '/Users/lmelane/Downloads/catwalks-job-aggregator/node_modules/@prisma/client/default.js';
import {runRefresh} from '/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/pipeline/refresh.ts';
import fs from 'node:fs';
const u=new URL(process.env.DATABASE_URL!);if(u.hostname!=='127.0.0.1'||u.port!=='55452'||u.pathname!=='/catwalks_audit_test')throw Error('Disposable DB required');
const p=new PrismaClient();
try{
 const key='audit-'+Date.now();const c=await p.company.create({data:{name:key,canonicalKey:key,fashionjobsUrl:'resolved:'+key}});
 const ids={};
 for(const [label,hours] of [['allowed',72],['outside',72],['broken',72],['expired',1]] as const){
  const sourceKey=key+'-'+label; const j=await p.job.create({data:{companyId:c.id,externalId:sourceKey,source:'GENERIC_JSONLD',title:'Sales Advisor',url:'https://example.test/'+sourceKey,fingerprint:sourceKey,isActive:true,lastSeenAt:new Date(Date.now()-hours*3600000),...(label==='expired'?{validThrough:new Date(Date.now()-86400000)}:{}),sources:{create:{sourceKey,externalId:sourceKey,sourceTier:'ATS_OFFICIAL',url:'https://example.test/'+sourceKey,lastSeenAt:new Date(Date.now()-hours*3600000),isActive:true}}}});ids[label]=j.id;
  await p.sourceRun.create({data:{sourceKey,status:label==='broken'?'BROKEN':'OK',jobs:1,canAttestAbsence:label!=='broken'}});
 }
 const stats=await runRefresh(p,{onlyKeys:[key+'-allowed'],minCloseForGuard:100000});
 const after=await p.job.findMany({where:{companyId:c.id},select:{id:true,isActive:true,validThrough:true}});
 let salary;try{salary=await p.job.update({where:{id:ids.expired},data:{salaryMin:12.31,salaryMax:20.8},select:{salaryMin:true,salaryMax:true}});}catch(e){salary={error:e.message};}
 fs.writeFileSync('/tmp/catwalks-audit-20260915/lifecycle-witness.json',JSON.stringify({ids,stats,after,salary},null,2));console.log({stats,salary});
}finally{await p.$disconnect();}
