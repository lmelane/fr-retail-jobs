import{readFileSync,writeFileSync,existsSync}from'node:fs';import{normalizeJobaffinityPost,applyJobaffinityEvidence}from'../../../apps/aggregator/src/ats/adapters/jobaffinityWordpress.js';
const p='/Users/lmelane/Downloads/catwalks-job-aggregator/backups/remediation-20260908';
const validation=JSON.parse(readFileSync('audits/2026-09-08/jobaffinity/live-validation.json','utf8'));
for(const v of validation){const path=p+'/'+v.key+'-live-adapter.json';const original=readFileSync(path,'utf8');if(!existsSync(path+'.before-city-proof'))writeFileSync(path+'.before-city-proof',original);const d=JSON.parse(original);
 d.jobs=d.jobs.map((j:any)=>{const r=j.raw;const next=normalizeJobaffinityPost(r.board.row,r.post,v.config,r.geographyEvidence);applyJobaffinityEvidence(next,r.applicationEvidence);Object.assign(next.raw as object,{applicationEvidence:r.applicationEvidence,listingEvidence:r.listingEvidence});return next});
 writeFileSync(path,JSON.stringify(d,null,2)+'\n');const eligible=d.jobs.filter((j:any)=>!j.publicationHold);v.countries=Object.fromEntries([...new Set(eligible.map((j:any)=>j.country??'UNKNOWN'))].map(c=>[c,eligible.filter((j:any)=>(j.country??'UNKNOWN')===c).length]));v.geographyReplayAt=new Date().toISOString();console.log(v.key,v.countries);
}
writeFileSync('audits/2026-09-08/jobaffinity/live-validation.json',JSON.stringify(validation,null,2)+'\n');
