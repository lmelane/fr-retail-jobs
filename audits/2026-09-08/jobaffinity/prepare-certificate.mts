import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';import{digest}from'../../../apps/aggregator/src/remediation/plan.js';
const root='/Users/lmelane/Downloads/catwalks-job-aggregator/backups/remediation-20260908';
const before=JSON.parse(readFileSync(root+'/jobaffinity-db-before.json','utf8'));
const validation=JSON.parse(readFileSync('audits/2026-09-08/jobaffinity/live-validation.json','utf8'));
const records=validation.map((v:any)=>{
 const key=v.key, inter=key==='intersport-france',name=inter?'Intersport':'Blackstore',domain=inter?'intersport.fr':'blackstore.fr',canonicalKey=inter?'INTERSPORT':'BLACKSTORE';
 const artifactPath=`audits/2026-09-08/jobaffinity/${inter?'intersport':'blackstore'}-official-browser.json`;const artifactText=readFileSync(artifactPath,'utf8');const identity=JSON.parse(artifactText);
 if(!identity.links.some((l:any)=>l.url===v.config.listingUrl))throw new Error('Official career link absent');
 const company=before.companies.find((c:any)=>c.canonicalKey===canonicalKey);const {aliases:_,...base}=company??{};
 return{key,name,domain,canonicalKey,config:v.config,aliases:[canonicalKey],parentGroup:inter?null:'Intersport',sector:inter?'RETAIL':'FASHION',checkedAt:v.at,publishable:v.publishable,
  existingCompanyId:company?.id??null,beforeCompanyHash:company?digest(base):null,artifactPath,artifactHash:createHash('sha256').update(artifactText).digest('hex'),proofUrl:identity.url,
  statement:`Official employer domain ${identity.url} links to ${v.config.listingUrl}. Unfiltered active-board enumeration, included-ID WordPress details and all JobAffinity application endpoints were checked. Closed endpoints and invalid mission text are held with archived RAW. Blackstore is a separate enseigne of Intersport, confirmed at https://www.blackstore.fr/qui-sommes-nous/.`};
});
const m={version:1,batchId:'20260908-JOBAFFINITY-DIRECT-v1',records};writeFileSync('audits/2026-09-08/jobaffinity/certificates.json',JSON.stringify(m,null,2)+'\n');console.log(digest(m));
