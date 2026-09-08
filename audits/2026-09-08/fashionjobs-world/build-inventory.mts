/** Uses the APPLICATION parser for every archived country directory. No DB writes. */
import{readFileSync,writeFileSync}from'node:fs';import*as cheerio from'cheerio';
import{parseFashionJobsCompanies}from'../../../apps/aggregator/src/connectors/fashionjobs/companyDirectory.js';
import{resolveCompany}from'../../../apps/aggregator/src/normalize/company.js';
import{canonicalCompanyKey}from'../../../apps/aggregator/src/lib/normalize.js';
const root=process.argv.find(a=>a.startsWith('--input-dir='))?.slice(12)??'backups/remediation-20260908/fashionjobs-world';const out='audits/2026-09-08/fashionjobs-world';
const log=readFileSync(`${root}/fetch-results.jsonl`,'utf8').trim().split('\n').map(l=>JSON.parse(l));
const latest=new Map(log.map(r=>[r.edition,r]));
const prod=JSON.parse(readFileSync('backups/remediation-20260908/directory-production-current.json','utf8'));
const companies=new Map<string,Set<string>>();
for(const c of prod.companies){for(const value of [c.name,c.canonicalKey,...(c.aliases??[]).map((a:any)=>a.aliasKey??a.displayName)]){
 if(!value)continue;const key=canonicalCompanyKey(value);const ids=companies.get(key)??new Set<string>();ids.add(c.id);companies.set(key,ids);
}}
const editions=[];const byName=new Map<string,any>();let rows=0;
for(const r of latest.values()){
 if(r.state!=='FETCHED_PENDING_PARSER'){editions.push(r);continue;}
 const html=readFileSync(`${root}/${r.edition}.html`,'utf8');const $=cheerio.load(html);
 try{
  const entries=parseFashionJobsCompanies(html,{directoryUrl:r.finalUrl,minExpected:1,allowExplicitEmpty:true});
  if(entries.length && !$('li.tw-text-12 > a.tw-font-secondary[href]').length)throw new Error('Alphabetical inventory absent: featured cards are not completeness proof');
  if($('a[rel="next"],link[rel="next"]').length)throw new Error('Pagination requires explicit traversal');
  rows+=entries.length;
  editions.push({...r,state:entries.length?'DIRECTORY_PARSED':'EXPLICIT_EMPTY_DIRECTORY',profiles:entries.length,alphabeticalAnchors:$('li.tw-text-12 > a.tw-font-secondary[href]').length,announcedOffersSum:entries.reduce((n,e)=>n+(e.offerCount??0),0),missingCounters:entries.filter(e=>e.offerCount===undefined).length,entries});
  for(const e of entries){const key=canonicalCompanyKey(e.name);const n=byName.get(key)??{key,labels:new Set<string>(),editions:new Set<string>(),profiles:[],candidateCompanyIds:new Set<string>()};
   n.labels.add(e.name);n.editions.add(r.edition);n.profiles.push({edition:r.edition,url:e.fashionjobsUrl,announcedOffers:e.offerCount});
   for(const probe of [key,canonicalCompanyKey(resolveCompany(e.name).companyId)])for(const id of companies.get(probe)??[])n.candidateCompanyIds.add(id);
   byName.set(key,n);
  }
 }catch(e){editions.push({...r,state:'UNRESOLVED',error:String(e)});}
}
const certified=JSON.parse(readFileSync('audits/2026-09-08/direct-sources/flatchr-certificates.json','utf8')).records;
const names=[...byName.values()].map(n=>{
 const ids=[...n.candidateCompanyIds] as string[];
 const keys=new Set((prod.links??[]).filter((l:any)=>ids.includes(l.companyId)).map((l:any)=>l.sourceKey));
 const canonical=new Set([...n.labels].map((label:any)=>resolveCompany(label).companyId));
 for(const source of prod.sources)if(canonical.has(resolveCompany(source.maison.split('(')[0].trim()).companyId))keys.add(source.key);
 const catalogueSources=prod.sources.filter((s:any)=>keys.has(s.key)).map((s:any)=>({key:s.key,kind:s.kind,status:s.status,tier:s.tier,careersDomain:s.careersDomain,
  configuredUrls:[...new Set(Object.values(s.config??{}).filter((v:any)=>typeof v==='string'&&/^https?:\/\//.test(v)))]}));
 const verified=certified.find((r:any)=>canonical.has(r.canonicalKey));
 return {...n,labels:[...n.labels],editions:[...n.editions],candidateCompanyIds:ids,catalogueSources,
  jobsFromSingleMatchedCompany:ids.length===1?prod.counts.find((c:any)=>c.companyId===ids[0])??null:null,
  identityStatus:verified?'OFFICIAL_SOURCE_REVIEWED_20260908':'CANDIDATE_NOT_CERTIFIED'};
}).sort((a,b)=>a.key.localeCompare(b.key));
const summary={at:new Date().toISOString(),productionComparisonAt:prod.at,editions:editions.length,parsedEditions:editions.filter(e=>e.state==='DIRECTORY_PARSED').length,
 explicitEmptyEditions:editions.filter(e=>e.state==='EXPLICIT_EMPTY_DIRECTORY').map(e=>e.edition),unresolved:editions.filter(e=>e.state==='UNRESOLVED').map(e=>({edition:e.edition,error:e.error})),
 countryProfileRows:rows,distinctNormalizedLabels:names.length,labelsNotInFrance:names.filter(n=>!n.editions.includes('fr')).length,
 labelsWithActiveDirectCatalogueCandidate:names.filter(n=>n.catalogueSources.some((s:any)=>s.status==='ACTIVE'&&['ATS_OFFICIAL','EMPLOYER_DIRECT','GROUP_OFFICIAL'].includes(s.tier))).length,
 candidateLabelsWithDbMatch:names.filter(n=>n.candidateCompanyIds.length).length,candidateLabelsWithoutDbMatch:names.filter(n=>!n.candidateCompanyIds.length).length,
 ambiguousDbMatches:names.filter(n=>n.candidateCompanyIds.length>1).map(n=>({label:n.key,ids:n.candidateCompanyIds})),
 offerPagesFetched:0,productionWrites:0,limits:['Normalized labels are not certified legal or commercial identities.','Same brand may have multiple labels; no forced merge.','Country directory counters overlap and do not equal distinct global vacancies.','Comparison uses the dated production export; direct portal research remains incomplete.']};
writeFileSync(`${out}/summary.json`,JSON.stringify(summary,null,2)+'\n');writeFileSync(`${out}/editions.json`,JSON.stringify(editions,null,2)+'\n');writeFileSync(`${out}/employers.json`,JSON.stringify(names,null,2)+'\n');
const cell=(v:any)=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
writeFileSync(`${out}/employers.csv`,['normalized_label,labels,editions,candidate_company_ids,catalogue_sources,existing_ats,configured_portals,existing_world_jobs,existing_france_jobs,profiles,identity_status',...names.map(n=>[n.key,n.labels.join(' | '),n.editions.join(' | '),n.candidateCompanyIds.join(' | '),n.catalogueSources.map((s:any)=>s.key+':'+s.status).join(' | '),[...new Set(n.catalogueSources.map((s:any)=>s.kind))].join(' | '),n.catalogueSources.flatMap((s:any)=>s.configuredUrls).join(' | '),n.jobsFromSingleMatchedCompany?.world,n.jobsFromSingleMatchedCompany?.france,n.profiles.map((p:any)=>p.url).join(' | '),n.identityStatus].map(cell).join(','))].join('\n')+'\n');
console.log(JSON.stringify({...summary,ambiguousDbMatches:summary.ambiguousDbMatches.length},null,2));
