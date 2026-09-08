import{writeFileSync}from'node:fs';import{fetchJobaffinityWordpressJobs}from'../../../apps/aggregator/src/ats/adapters/jobaffinityWordpress.js';
const base='/Users/lmelane/Downloads/catwalks-job-aggregator/backups/remediation-20260908';
const all=[];
for(const [key,url,employer] of [['intersport-france','https://recrutement.intersport.fr/','Intersport'],['blackstore','https://blackstore.candidater.fr/','Blackstore']]){
 const config={listingUrl:url,employer,brands:employer==='Intersport'?{Intersport:'Intersport','Intersport Montagne':'Intersport','Intersport Outlet':'Intersport',BlackStore:'Blackstore','Intersport, Intersport Montagne':'Intersport'}:undefined};
 const result=await fetchJobaffinityWordpressJobs(config);const held=result.jobs.filter(j=>j.publicationHold);const eligible=result.jobs.filter(j=>!j.publicationHold);
 const record={at:new Date().toISOString(),key,config,declaredTotal:result.declaredTotal,enumerated:result.jobs.length,completeEnumeration:result.complete,held:held.map(j=>({id:j.externalId,title:j.title,url:j.url,reason:j.publicationHold})),publishable:eligible.length,countries:Object.fromEntries([...new Set(eligible.map(j=>j.country??'UNKNOWN'))].map(c=>[c,eligible.filter(j=>(j.country??'UNKNOWN')===c).length])),ids:eligible.map(j=>j.externalId).sort()};
 writeFileSync(base+'/'+key+'-live-adapter.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...record,ids:undefined,held:held.length}));all.push(record);
}
writeFileSync('audits/2026-09-08/jobaffinity/live-validation.json',JSON.stringify(all,null,2)+'\n');
