/** Replays actual stored RAW and actual captured HTML through application parsers. No DB writes. */
import {readFileSync,writeFileSync}from'node:fs';import{gunzipSync}from'node:zlib';import{createHash}from'node:crypto';
import * as cheerio from'cheerio';
import{readPostingEvidence}from'../../../apps/aggregator/src/lib/postingEvidence.js';
import{parseMicrodataDetail}from'../../../apps/aggregator/src/ats/adapters/successfactors.js';
import{normalizeMagnetOffer}from'../../../apps/aggregator/src/ats/adapters/magnet.js';
import{plausiblePostedAt}from'../../../apps/aggregator/src/lib/normalize.js';
import{digest}from'../../../apps/aggregator/src/remediation/plan.js';
const base='backups/remediation-20260908';
const input=JSON.parse(readFileSync(`${base}/missing-dates.json`,'utf8'));
const captures=new Map<string,any>();
for(const line of readFileSync(`${base}/date-details/captures.jsonl`,'utf8').trim().split('\n')){const r=JSON.parse(line);captures.set(r.requestedUrl,r);}
const key=(r:any)=>{const u=new URL(r.url);if(u.hostname.endsWith('.icims.com'))u.search='?in_iframe=1';return u.href;};
const now=new Date();const results=[];
for(const row of input.rows){
 let date:Date|undefined;let evidence:any;const raw=row.raw??{};
 if(['element-6','eram-3'].includes(row.sourceKey)&&raw.publication_date){
  date=normalizeMagnetOffer(raw,new URL(row.url).origin)?.postedAt;
  evidence={method:'MAGNET_PUBLICATION_DATE',path:'raw.publication_date',rawValue:raw.publication_date,rawHash:digest(raw),url:row.url};
 }else if(row.sourceKey==='lvmh'&&raw.publicationTimestamp){
  date=new Date(Number(raw.publicationTimestamp)*1000);
  evidence={method:'LVMH_PUBLICATION_TIMESTAMP_SECONDS',path:'raw.publicationTimestamp',rawValue:raw.publicationTimestamp,rawHash:digest(raw),url:row.url};
 }else{
  const capture=captures.get(key(row));
  if(capture?.outcome!=='CAPTURED'){
   results.push({sourceKey:row.sourceKey,externalId:row.externalId,jobId:row.jobId,status:capture?.outcome??'NOT_CAPTURED',evidence:capture});continue;
  }
  const bytes=gunzipSync(readFileSync(capture.path));
  if(createHash('sha256').update(bytes).digest('hex')!==capture.sha256)throw new Error('Archive hash mismatch');
  const html=bytes.toString('utf8');const detail=readPostingEvidence(html,capture.finalUrl);
  date=detail.postedAt;
  evidence={method:'OFFICIAL_JOBPOSTING_DATE',path:'JobPosting.datePosted',rawValue:(detail.evidence.jobPosting as any)?.datePosted??null,
   url:capture.finalUrl,htmlSha256:capture.sha256,archive:capture.path,observedAt:capture.at};
  if(!date && row.sourceKey==='adidas'){
   date=parseMicrodataDetail(html).postedAt;
   evidence={...evidence,method:'SUCCESSFACTORS_VISIBLE_DATE',path:'[data-careersite-propertyid=date]',rawValue:cheerio.load(html)('[data-careersite-propertyid="date"]').first().text().trim()};
  }
  // A redirect to a different host/path may be a replacement vacancy, not evidence for this identity.
  const from=new URL(capture.requestedUrl),to=new URL(capture.finalUrl);
  if(from.hostname!==to.hostname || from.pathname.replace(/\/$/,'')!==to.pathname.replace(/\/$/,'')){
   results.push({sourceKey:row.sourceKey,externalId:row.externalId,jobId:row.jobId,status:'REDIRECT_IDENTITY_REVIEW_REQUIRED',evidence});continue;
  }
 }
 const valid=plausiblePostedAt(date,now);
 results.push({sourceKey:row.sourceKey,externalId:row.externalId,jobId:row.jobId,postedAt:valid?.toISOString()??null,
  status:valid?'DATE_PROVEN':date?'SOURCE_DATE_INVALID_OR_FUTURE':'NO_DATE_IN_CHECKED_FORMATS',evidence});
}
const byJob=new Map<string,any[]>();for(const r of results){const a=byJob.get(r.jobId)??[];a.push(r);byJob.set(r.jobId,a);}
const qualified=[];const conflicts=[];
for(const[jobId,rs]of byJob){const proven=rs.filter(r=>r.status==='DATE_PROVEN');const values=new Set(proven.map(r=>r.postedAt));
 if(values.size===1)qualified.push({jobId,postedAt:proven[0].postedAt,representations:proven});
 else if(values.size>1)conflicts.push({jobId,representations:proven});
}
const statuses:Record<string,number>={};for(const r of results)statuses[r.status]=(statuses[r.status]??0)+1;
const proof={at:now.toISOString(),cohortJobs:byJob.size,qualifiedJobs:qualified.length,conflictingJobs:conflicts.length,representationStatuses:statuses,qualified,conflicts,results};
writeFileSync(`${base}/dates-recovery-evidence.json`,JSON.stringify(proof,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({...proof,qualified:undefined,conflicts:undefined,results:undefined,digest:digest(proof)}));
