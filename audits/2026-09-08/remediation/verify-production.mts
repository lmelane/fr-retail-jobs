import {PrismaClient} from '@prisma/client';import{writeFileSync,readFileSync}from'node:fs';
const p=new PrismaClient();const mode=process.argv[2], file=process.argv[3];
if(!file||!['baseline','verify'].includes(mode))throw new Error('baseline|verify <private baseline file>');
const state=await p.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return{
 jobs:await tx.job.findMany({select:{id:true,firstSeenAt:true}}),
 sources:await tx.jobSource.findMany({select:{id:true,firstSeenAt:true}}),
 events:await tx.jobEvent.findMany({select:{id:true}}),
};},{timeout:25000});
if(mode==='baseline'){writeFileSync(file,JSON.stringify(state),{mode:0o600});console.log(JSON.stringify({baseline:true,jobs:state.jobs.length,sources:state.sources.length,events:state.events.length}));}
else{
 const before=JSON.parse(readFileSync(file,'utf8'));
 const jobs=new Map(state.jobs.map(j=>[j.id,j.firstSeenAt.toISOString()]));const sources=new Map(state.sources.map(s=>[s.id,s.firstSeenAt.toISOString()]));const events=new Set(state.events.map(e=>e.id));
 const lostJobs=before.jobs.filter((j:any)=>!jobs.has(j.id));const changedFirst=before.jobs.filter((j:any)=>jobs.has(j.id)&&jobs.get(j.id)!==j.firstSeenAt);
 const lostSources=before.sources.filter((s:any)=>!sources.has(s.id));const changedSourceFirst=before.sources.filter((s:any)=>sources.has(s.id)&&sources.get(s.id)!==s.firstSeenAt);
 const lostEvents=before.events.filter((e:any)=>!events.has(e.id));
 const corrections=await p.dataCorrection.groupBy({by:['batchId','planHash','commitHash'],_count:true});
 const summary={at:new Date().toISOString(),jobs:state.jobs.length,active:await p.job.count({where:{isActive:true}}),sources:state.sources.length,events:state.events.length,lostJobs:lostJobs.length,changedFirstSeen:changedFirst.length,lostSources:lostSources.length,changedSourceFirstSeen:changedSourceFirst.length,lostHistoricalEvents:lostEvents.length,corrections};
 console.log(JSON.stringify(summary,null,2));if(lostJobs.length+changedFirst.length+lostSources.length+changedSourceFirst.length+lostEvents.length)throw new Error('Preservation invariant failed');
}
await p.$disconnect();
