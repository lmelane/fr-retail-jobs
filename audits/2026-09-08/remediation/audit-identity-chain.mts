import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { tenantKeyOf } from '../../../apps/aggregator/src/connectors/sourceStore.js';
import { parseCsvLine } from '../../../apps/aggregator/src/discovery/validateDiscovered.js';
const p=new PrismaClient();
const history=readFileSync('apps/aggregator/data/sources.gated.csv','utf8').trim().split(/\r?\n/).slice(1).map(line=>{
 const [maison,careersDomain,kind,config,,note,,verified]=parseCsvLine(line);
 return {maison,kind,note,verified,tenantKey:tenantKeyOf(kind,config,careersDomain,maison)};
});
const data=await p.$transaction(async tx=>{
 await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
 const sources=await tx.source.findMany({orderBy:{key:'asc'}});
 const counts=await tx.$queryRawUnsafe<any[]>(`SELECT js."sourceKey",count(*)::int n,count(DISTINCT j."companyId")::int companies,count(*) FILTER(WHERE js.raw IS NULL)::int without_raw FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" WHERE js."isActive" AND j."isActive" GROUP BY 1`);
 return sources.map(s=>({key:s.key,maison:s.maison,kind:s.kind,status:s.status,tenantKey:s.tenantKey,careersDomain:s.careersDomain,note:s.note,verifiedJobCount:s.verifiedJobCount,history:history.filter(h=>h.tenantKey===s.tenantKey),...(counts.find(c=>c.sourceKey===s.key)??{n:0,companies:0,without_raw:0})}));
},{timeout:25000});
writeFileSync('backups/remediation-20260908/source-identity-chain.json',JSON.stringify(data,null,2),{mode:0o600});
const active=data.filter(s=>s.status==='ACTIVE');const by:Record<string,{sources:number,representations:number}>={};
for(const s of active){const type=s.history.length===0?'ARCHIVE_GATE_ABSENTE':s.history.length>1?'PLUSIEURS_ARCHIVES':s.history[0].verified;by[type]??={sources:0,representations:0};by[type].sources++;by[type].representations+=s.n;}
console.log(JSON.stringify({active:active.length,by},null,2));
await p.$disconnect();
