import fs from 'node:fs';
const dir='audits/2026-09-08/reaudit/evidence/';
const jobs=JSON.parse(fs.readFileSync(dir+'job-metadata.json')).filter(j=>j.isActive);
const result=[];
for (const code of ['monde','FR','US','GB','DE','CA','IT','ES','NL','CH','JP']) {
 const params=new URLSearchParams({pays:code});const url='https://modecareers.com/api/jobs?'+params;
 const response=await fetch(url,{signal:AbortSignal.timeout(20000)});const data=await response.json();
 const expected=jobs.filter(j=>code==='monde'||(code==='FR'?j.isFrance:j.countryCode===code));
 const ids=new Set(expected.map(j=>j.id));
 result.push({at:new Date().toISOString(),url,status:response.status,expectedFromDatabase:expected.length,apiTotal:data.total,delta:data.total-expected.length,firstPageRows:data.jobs?.length,unexpectedIds:data.jobs?.filter(j=>!ids.has(j.id)).map(j=>j.id),countryFacets:data.facets?.countries});
}
fs.writeFileSync(dir+'api-country-chain.json',JSON.stringify(result,null,2)+'\n');
console.log(result.map(({countryFacets,...r})=>r));
// A real filtered directory request: preserve its returned facet scope for comparison.
const url='https://modecareers.com/api/companies?pays=FR&secteur=BEAUTY';
const r=await fetch(url,{signal:AbortSignal.timeout(20000)});const d=await r.json();
fs.writeFileSync(dir+'api-companies-fr-beauty.json',JSON.stringify({url,status:r.status,...d},null,2)+'\n');
console.log('directory',r.status,d.total);
