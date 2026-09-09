/** Read-only adapter validation: all existing production TalentView tenants plus Sud Express. */
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fetchTalentViewJobs } from '../../../apps/aggregator/src/ats/adapters/talentview.js';
import { withSourceBudget } from '../../../apps/aggregator/src/lib/sourceBudget.js';
import pLimit from 'p-limit';
const snapshot=process.argv.find(a=>a.startsWith('--snapshot='))?.slice(11);if(!snapshot)throw new Error('--snapshot=<private source catalogue> required');
const prod=JSON.parse(readFileSync(snapshot,'utf8'));
const sources=prod.sources.filter((s:any)=>s.status==='ACTIVE'&&s.kind==='talentview');
sources.push({key:'sud-express-candidate',config:{slug:'sud-express'}});
const limit=pLimit(2);
const results=await Promise.all(sources.map((source:any)=>limit(async()=>{
 const at=new Date().toISOString();
 try{const r=await withSourceBudget(()=>fetchTalentViewJobs({...source.config,withDescriptions:false}),180000,source.key);
 const rows=r.jobs.map(j=>({id:j.externalId,url:j.url,country:j.country,title:j.title,location:j.location}));
 return {source:source.key,at,complete:r.complete,truncated:r.truncated,fetched:rows.length,unique:new Set(rows.map(j=>j.id)).size,countries:[...new Set(rows.map(j=>j.country))],rowsSha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),rows};
 }catch(e){return{source:source.key,at,complete:false,error:String(e)}}
})));
const proof={at:new Date().toISOString(),productionWrites:0,scope:'ALL_PUBLIC_WEBSITES_ALL_COUNTRIES',descriptionsRead:false,results};writeFileSync('audits/2026-09-09/talentview/live-validation.json',JSON.stringify(proof,null,2));
console.log(JSON.stringify({...proof,results:results.map(r=>({...r,rows:undefined}))},null,2));
