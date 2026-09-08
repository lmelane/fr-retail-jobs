import{readFileSync,writeFileSync}from'node:fs';import{parseJobaffinityGrid,normalizeJobaffinityPost}from'../../../apps/aggregator/src/ats/adapters/jobaffinityWordpress.js';
const root='/Users/lmelane/Downloads/catwalks-job-aggregator/backups/remediation-20260908';
const geo=readFileSync(root+'/jobaffinity-geo.jsonl','utf8').trim().split('\n').map(x=>JSON.parse(x));
const records=[];
for(const key of ['intersport-france','blackstore']){
 const d=JSON.parse(readFileSync(root+'/'+key+'-board-data.json','utf8'));const html=readFileSync(root+'/'+key+'-board.html','utf8');
 const config={listingUrl:d.origin+'/',employer:key==='blackstore'?'Blackstore':'Intersport',brands:{Intersport:'Intersport','Intersport Montagne':'Intersport','Intersport Outlet':'Intersport',BlackStore:'Blackstore','Intersport, Intersport Montagne':'Intersport'}};
 const grid=parseJobaffinityGrid(html,config.listingUrl);const jobs=grid.rows.map(r=>{const g=geo.find(x=>x.key===[r.attrs['data-latitude'],r.attrs['data-longitude'],r.attrs['data-codepostal']].join(','));return normalizeJobaffinityPost(r,d.posts.find((p:any)=>String(p.id)===r.attrs['data-id']),config,g?{url:g.url,communes:g.communes}:undefined)});
 const counts=(f:string)=>Object.fromEntries([...new Set(jobs.map((j:any)=>j[f]??'UNKNOWN'))].map(x=>[String(x),jobs.filter((j:any)=>(j[f]??'UNKNOWN')===x).length]));
 const summary={key,config,jobs:jobs.length,countries:counts('country'),employers:counts('company'),contracts:counts('contract'),workingTimes:counts('workingTime'),dates:jobs.filter(j=>j.postedAt).length};
 console.log(JSON.stringify(summary));records.push(summary);writeFileSync(root+'/'+key+'-normalized-jobs.json',JSON.stringify(jobs,null,2)+'\n');
}
writeFileSync('audits/2026-09-08/jobaffinity/capture-normalization.json',JSON.stringify(records,null,2)+'\n');
