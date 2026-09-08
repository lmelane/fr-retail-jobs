import {PrismaClient} from '@prisma/client';
import {writeFileSync} from 'node:fs';
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);if(!out)throw new Error('--out required');
const db=new PrismaClient();
try{
const data=await db.$transaction(async tx=>{
await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
const sources=await tx.jobSource.findMany({where:{raw:{path:['source'],equals:'successfactors-rmk-v2'}},orderBy:{id:'asc'}});
const ids=[...new Set(sources.map(s=>s.jobId))];
const jobs=await tx.job.findMany({where:{id:{in:ids}},omit:{searchText:true},orderBy:{id:'asc'}});
const history=await tx.jobEvent.findMany({where:{jobId:{in:ids}},orderBy:{id:'asc'}});
const runs=await tx.sourceRun.findMany({where:{sourceKey:{in:[...new Set(sources.map(s=>s.sourceKey))]}},orderBy:{ranAt:'desc'},take:12});
return {at:new Date().toISOString(),sources,jobs,history,runs};
},{timeout:30000});writeFileSync(out,JSON.stringify(data,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({at:data.at,jobs:data.jobs.length,sources:data.sources.length,runs:data.runs.map(r=>({source:r.sourceKey,at:r.ranAt,status:r.status}))}));
}finally{await db.$disconnect()}
