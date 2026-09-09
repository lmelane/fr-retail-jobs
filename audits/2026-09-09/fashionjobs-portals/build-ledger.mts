/** Resume all discovered labels without confusing name matches, identity proof and ATS completion. No writes to production. */
import { readFileSync, writeFileSync } from 'node:fs';
import { canonicalCompanyKey } from '../../../apps/aggregator/src/lib/normalize.js';
import { resolveCompany } from '../../../apps/aggregator/src/normalize/company.js';
const privateRoot=process.argv.find(a=>a.startsWith('--private-root='))?.slice(15);
if(!privateRoot) throw new Error('--private-root=<repository>/backups is required');
const out='audits/2026-09-09/fashionjobs-portals';
const directory=JSON.parse(readFileSync('audits/2026-09-08/fashionjobs-world/employers.json','utf8'));
const prod=JSON.parse(readFileSync(`${privateRoot}/remediation-20260909/run-integrity/directory-production.json`,'utf8'));
const reprocessed=JSON.parse(readFileSync('audits/2026-09-08/fashionjobs-coverage/discovery-evidence.json','utf8'));
const research=['known','profiles'].flatMap(mode=>readFileSync(`${privateRoot}/remediation-20260908/portal-research-${mode}.jsonl`,'utf8').trim().split('\n').map(l=>JSON.parse(l))).map(r=>{
 const replay=reprocessed.find((p:any)=>p.name===r.name&&p.attemptAt===r.at);
 if(!replay)throw new Error(`Missing archived-page replay for ${r.name}/${r.at}`);
 return {...r,historicalLinks:r.links??[],links:replay.links.map((l:any)=>({...l,directCandidate:!l.indirectBoard})),reprocessedAt:replay.reprocessedAt,extractorVersion:replay.extractorVersion};
});
const decisions=[...JSON.parse(readFileSync('audits/2026-09-08/fashionjobs-coverage/identity-and-portal-decisions.json','utf8')),...JSON.parse(readFileSync(`${out}/portal-reviews.json`,'utf8'))];
const keyCache=new Map<string,string[]>();
const keys=(value:string)=>{let k=keyCache.get(value);if(!k){k=[canonicalCompanyKey(value),canonicalCompanyKey(resolveCompany(value).companyId)].filter(Boolean);keyCache.set(value,k);}return k;};
const intersects=(a:string[],b:string[])=>a.some(v=>b.includes(v));
const rows=directory.map((entry:any)=>{
 const probes=[...new Set(entry.labels.flatMap(keys))] as string[];
 const companies=prod.companies.filter((c:any)=>intersects(probes,[c.name,c.canonicalKey,...c.aliases.flatMap((a:any)=>[a.aliasKey,a.displayName])].filter(Boolean).flatMap(keys)));
 const ids=companies.map((c:any)=>c.id);
 const sourceKeys=new Set(prod.links.filter((l:any)=>ids.includes(l.companyId)).map((l:any)=>l.sourceKey));
 const reviews=prod.identityReviews.filter((r:any)=>intersects(probes,keys(r.subjectKey)));
 for(const review of reviews)sourceKeys.add(review.sourceKey);
 const sources=prod.sources.filter((s:any)=>sourceKeys.has(s.key)||intersects(probes,keys(s.maison.split('(')[0].trim())));
 const direct=sources.filter((s:any)=>['ATS_OFFICIAL','GROUP_OFFICIAL','EMPLOYER_DIRECT'].includes(s.tier));
 const observations=research.filter((r:any)=>intersects(probes,keys(r.name)));
 const reviewed=decisions.filter((r:any)=>r.directoryNames.some((n:string)=>intersects(probes,keys(n))));
 const evidence=[...reviews.map((r:any)=>({kind:'SOURCE_IDENTITY_REVIEW',proofUrl:r.proofUrl,portalUrl:r.portalUrl,subjectKey:r.subjectKey,sourceKey:r.sourceKey,verdict:r.verdict,checkedAt:r.checkedAt})),
  ...reviewed.map((r:any)=>({kind:'OFFICIAL_LINK_REVIEW',verdict:r.verdict,portalUrl:r.portalUrl,ats:r.ats,evidenceUrls:r.evidenceUrls,technicalValidation:r.technicalValidation,technicalRead:r.technicalRead}))];
 const active=direct.filter((s:any)=>s.status==='ACTIVE');
 const foundLinks=observations.flatMap((r:any)=>(r.links??[]).filter((l:any)=>l.directCandidate));
 const manualPortal=reviewed.some((r:any)=>r.portalUrl);
 const stage=ids.length>1?'IDENTITY_MATCH_AMBIGUOUS':active.length?'ACTIVE_SOURCE_CANDIDATE':manualPortal?'OFFICIAL_PORTAL_TECHNICAL_VALIDATION_REQUIRED':foundLinks.length?'CAREER_LINK_REVIEW_REQUIRED':observations.length?'RESEARCH_INCOMPLETE':'RESEARCH_NOT_STARTED';
 return {labels:entry.labels,discoveryKey:entry.key||`UNICODE:${entry.labels[0].normalize('NFKC').toLocaleUpperCase()}`,
  editions:entry.editions,profiles:entry.profiles,stage,
  franceDirectoryCount:Math.max(0,...entry.profiles.filter((p:any)=>p.edition==='fr').map((p:any)=>p.announcedOffers??0)),
  candidateCompanies:companies.map((c:any)=>({id:c.id,name:c.name,canonicalKey:c.canonicalKey,domain:c.domain,parentGroup:c.parentGroup,kind:c.kind})),
  catalogueSources:direct.map((s:any)=>({key:s.key,kind:s.kind,status:s.status,maison:s.maison,careersDomain:s.careersDomain})),
  existingJobs:ids.length===1?prod.counts.find((c:any)=>c.companyId===ids[0])??null:null,
  identityEvidence:evidence,
  researchObservations:observations.map((r:any)=>({at:r.at,originalStatus:r.status,status:r.links.some((l:any)=>l.directCandidate)?'ARCHIVED_CAREER_LINKS_TO_REVIEW':r.pages?.length?'NO_CAREER_LINK_FOUND_ON_ARCHIVED_PAGES':r.status,reprocessedAt:r.reprocessedAt,extractorVersion:r.extractorVersion,failures:r.failures??[],declaredWebsites:r.declaredWebsites??[],pagesRead:(r.pages??[]).map((p:any)=>({url:p.url,sha256:p.sha256,atsHint:p.atsHint?.type})),historicalLinks:r.historicalLinks.filter((l:any)=>l.directCandidate),links:(r.links??[]).filter((l:any)=>l.directCandidate)})),
  evidenceLimit:stage==='ACTIVE_SOURCE_CANDIDATE'?'A catalogue relation is not proof of complete global coverage or of every brand on a group portal.':stage==='RESEARCH_INCOMPLETE'?'Previous discovery did not establish a portal; absence of a public portal has NOT been proved.':null};
});
rows.sort((a:any,b:any)=>b.franceDirectoryCount-a.franceDirectoryCount||a.discoveryKey.localeCompare(b.discoveryKey));
const stages:Record<string,number>={};for(const r of rows)stages[r.stage]=(stages[r.stage]??0)+1;
const summary={at:new Date().toISOString(),productionAt:prod.at,labels:rows.length,profiles:rows.reduce((n:number,r:any)=>n+r.profiles.length,0),franceLabels:rows.filter((r:any)=>r.editions.includes('fr')).length,stages,
 productionCompanies:prod.companies.length,productionSources:prod.sources.length,activeSources:prod.sources.filter((s:any)=>s.status==='ACTIVE').length,
 productionWrites:0,activatedByThisLedger:0,limits:['No automatic company creation or identity merge.','Catalogue presence is not certified world exhaustiveness.','No missing portal is declared impossible on the basis of an empty discovery result.','Old research observations are dated and are not silently recertified today.']};
if(rows.length!==directory.length||summary.profiles!==3971)throw new Error('Inventory conservation failed');
writeFileSync(`${out}/ledger.json`,JSON.stringify(rows,null,2)+'\n');writeFileSync(`${out}/summary.json`,JSON.stringify(summary,null,2)+'\n');
const cell=(v:any)=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
writeFileSync(`${out}/ledger.csv`,['labels,stage,france_directory_count,candidate_companies,sources,official_portals,observed_links',...rows.map((r:any)=>[r.labels.join(' | '),r.stage,r.franceDirectoryCount,r.candidateCompanies.map((c:any)=>c.name).join(' | '),r.catalogueSources.map((s:any)=>`${s.key}:${s.status}`).join(' | '),r.identityEvidence.map((e:any)=>e.portalUrl).filter(Boolean).join(' | '),[...new Set(r.researchObservations.flatMap((o:any)=>o.links.map((l:any)=>l.to)))].join(' | ')].map(cell).join(','))].join('\n')+'\n');
console.log(JSON.stringify(summary,null,2));
