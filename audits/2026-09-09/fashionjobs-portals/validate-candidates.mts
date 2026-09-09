/** Read existing adapters against employer-linked portals, without database mutation. */
import { fetchAtsJobs } from '../../../apps/aggregator/src/ats/index.js';
import { withSourceBudget } from '../../../apps/aggregator/src/lib/sourceBudget.js';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const results=[];
for(const subject of [{label:'SUD EXPRESS',type:'TALENTVIEW' as const,config:{slug:'sud-express'}},{label:'AUBADE',type:'WTTJ' as const,config:{slug:'aubade'}}]){
 const at=new Date().toISOString();
 try{const r=await withSourceBudget(()=>fetchAtsJobs(subject.type,subject.config),180000,subject.label);
 const rows=r.jobs.map(j=>({id:j.externalId,title:j.title,url:j.url,country:j.country,location:j.location,postedAt:j.postedAt,descriptionLength:j.description?.length??0}));
 results.push({at,label:subject.label,ats:subject.type,config:subject.config,complete:r.complete,truncated:r.truncated,declaredTotal:r.declaredTotal,fetched:rows.length,unique:new Set(rows.map(j=>j.id)).size,rowsSha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),productionWrites:0,rows});
 }catch(e){results.push({at,label:subject.label,error:String(e),productionWrites:0})}
}
writeFileSync('audits/2026-09-09/fashionjobs-portals/candidate-validation.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(r=>({...r,rows:undefined})),null,2));
