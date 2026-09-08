/** Normal, bounded reads of actual career feeds. Never connects to the database. */
import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{createHash}from'node:crypto';import pLimit from'p-limit';
import{fetchTeamtailorJobs}from'../../../apps/aggregator/src/ats/adapters/teamtailor.js';
import{normalizeSourceConfig}from'../../../apps/aggregator/src/connectors/sourceConfig.js';
import{withSourceBudget}from'../../../apps/aggregator/src/lib/sourceBudget.js';
const arg=(n:string)=>process.argv.find(s=>s.startsWith(`--${n}=`))?.slice(n.length+3);
const input=arg('configs'),out=arg('out');if(!input||!out)throw new Error('--configs and --out required');mkdirSync(out,{recursive:true});
const sources=JSON.parse(readFileSync(input,'utf8'));const limit=pLimit(3);
const rows=await Promise.all(sources.map((s:any)=>limit(async()=>{
 const at=new Date().toISOString();const config=normalizeSourceConfig(s.config);
 try{const result=await withSourceBudget(()=>fetchTeamtailorJobs(config),60000,s.key);
 const serialized=JSON.stringify(result);writeFileSync(`${out}/${s.key}.json`,serialized+'\n',{mode:0o600});
 const proof={key:s.key,origin:config.origin,at,complete:result.complete,truncated:result.truncated,jobs:result.jobs.length,unique:new Set(result.jobs.map(j=>j.externalId)).size,rawSha256:createHash('sha256').update(JSON.stringify(result.jobs.map(j=>j.raw))).digest('hex')};console.log(JSON.stringify(proof));return proof;
 }catch(e){const proof={key:s.key,origin:config.origin,at,error:String(e)};console.log(JSON.stringify(proof));return proof;}
})));
writeFileSync(`${out}/summary.json`,JSON.stringify({at:new Date().toISOString(),sources:rows.length,complete:rows.filter((r:any)=>r.complete).length,failures:rows.filter((r:any)=>r.error),rows},null,2)+'\n');
