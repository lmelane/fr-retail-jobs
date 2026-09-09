/** Read-only, evidence-preserving career discovery. FashionJobs: identity metadata only. */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { fetchRenderedHtml, closeBrowser } from '../lib/browser.js';
import { fetchWithRetry, readBodyBounded } from '../lib/http.js';
import { detectFromHtml, detectAllLinkedAts, unadaptedVendorIn } from '../ats/detect.js';
import { careerCandidates } from '../ats/careerLinks.js';
import { isPublicHttpUrl } from '../lib/ssrf.js';
import { withSourceBudget } from '../lib/sourceBudget.js';

type Subject = { id: string; name: string; labels?: string[]; profileUrls: string[]; urls: string[]; origin: string };
const [inputPath, outputRoot, mode = 'all'] = process.argv.slice(2);
if (!inputPath || !outputRoot || !['all','known','profiles'].includes(mode)) throw Error('input.json output-directory [all|known|profiles]');
const version = 'lot4-careers-v3';
const hash = (x: string) => createHash('sha256').update(x).digest('hex');
const input: Subject[] = JSON.parse(readFileSync(inputPath, 'utf8'));
mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
mkdirSync(`${outputRoot}/artifacts`, { recursive: true, mode: 0o700 });
const output = `${outputRoot}/research.jsonl`;
const completed = new Set(existsSync(output) ? readFileSync(output,'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x)).filter(r=>r.status!=='RESEARCH_INTERRUPTED').map(r=>`${r.id}:${r.inputHash}:${r.version}`) : []);
const indirect = (u: string) => /(^|\.)(fashionjobs\.com|fashionnetwork\.com|linkedin\.com|indeed\.[a-z.]+|hellowork\.com|glassdoor\.[a-z.]+|jobijoba\.com)$/.test(new URL(u).hostname);
function archive(url: string, content: string, scope: string, at = new Date().toISOString()) {
 const sha256=hash(content); writeFileSync(`${outputRoot}/artifacts/${sha256}.txt`,content,{mode:0o600});
 return { url, at,sha256,scope };
}
async function readUncached(url: string) {
 if (!isPublicHttpUrl(url)) throw Error('Non-public URL refused');
 let httpFailure: string | undefined;
 try {
  const response = await fetchWithRetry(url,{signal:AbortSignal.timeout(20000)},1);
  const html = await readBodyBounded(response,url);
  if (/just a moment|cf-chl-|captcha/i.test(html.slice(0,20000))) throw Error('Challenge page, not employer content');
  return {html,url:response.url || url,transport:'HTTP',httpFailure,fetchedAt:new Date().toISOString()};
 } catch(e) { httpFailure=String(e).slice(0,500); }
 const html=await fetchRenderedHtml(url);
 if (/just a moment|cf-chl-|verify you are human/i.test(html.slice(0,20000))) throw Error(`Browser still challenged; HTTP: ${httpFailure}`);
 return {html,url,transport:'BROWSER',httpFailure,fetchedAt:new Date().toISOString()};
}
// Multiple brands often link the same group portal. Reuse its dated public
// artifact during this pass; never archive FashionJobs profile HTML or its offers.
const cache = new Map<string, Omit<Awaited<ReturnType<typeof readUncached>>, 'html'> & { sha256: string }>();
const pendingReads = new Map<string, Promise<Awaited<ReturnType<typeof readUncached>>>>();
function fetchUrl(value: string) { const url = new URL(value); url.hash=''; return url.toString(); }
async function read(value: string) {
 const url=fetchUrl(value);
 if(indirect(url))return readUncached(url);
 const cached=cache.get(url);
 if(cached)return {...cached,html:readFileSync(`${outputRoot}/artifacts/${cached.sha256}.txt`,'utf8')};
 const pending=pendingReads.get(url);if(pending)return pending;
 const request=readUncached(url).then(result=>{
  const evidence=archive(result.url,result.html,'SHARED_PUBLIC_PAGE_CACHE',result.fetchedAt);
  const {html,...metadata}=result;cache.set(url,{...metadata,sha256:evidence.sha256});return result;
 }).finally(()=>pendingReads.delete(url));
 pendingReads.set(url,request);return request;
}
const progress = new Map<string, any>();
async function inspect(s: Subject) {
 const r: any={id:s.id,name:s.name,inputHash:hash(JSON.stringify(s)),version,at:new Date().toISOString(),identityCertified:false,sourceActivated:false,profiles:[],pages:[],links:[],failures:[],unvisited:[]};
 progress.set(s.id,r);
 const urls = new Set(s.urls.filter(isPublicHttpUrl).filter(u=>!indirect(u)));
 // Read only explicitly inventoried employer profile URLs, never FashionJobs job URLs.
 if (!urls.size) for (const url of s.profileUrls.slice(0,2)) {
  try {
   if (!/(^|\.)fashionjobs\.com$/.test(new URL(url).hostname)) throw Error('Not a benchmark employer profile');
   const p=await read(url); const $=cheerio.load(p.html);
   const sites=$('a[href]').map((_,a)=>/site internet|site web|website|webseite|sitio web|sito web|网站|網址/i.test($(a).text()) ? $(a).attr('href') : '').get().filter((u):u is string=>!!u && isPublicHttpUrl(u) && !indirect(u));
   for (const u of sites) urls.add(u);
   const metadata={profileUrl:url,title:$('title').text(),websites:[...new Set(sites)]};
   r.profiles.push({...archive(url,JSON.stringify(metadata),'PROFILE_IDENTITY_METADATA_ONLY',p.fetchedAt),...metadata,transport:p.transport,httpFailure:p.httpFailure});
  } catch(e) { r.failures.push({url,error:String(e).slice(0,1000),step:'PROFILE_METADATA'}); }
  if (urls.size) break;
 }
 const queue=[...urls].map(url=>({url:fetchUrl(url),depth:0,from:s.origin})); const visited=new Set<string>();
 while(queue.length && visited.size<8) {
  const t=queue.shift()!; if(visited.has(t.url))continue;visited.add(t.url);
  try {
   if (indirect(t.url)) throw Error('Indirect board is a discovery reference only');
   const p=await read(t.url);
   if(indirect(p.url)) throw Error('Redirect to indirect board; no job collection');
   const evidence=archive(p.url,p.html,'OFFICIAL_SITE_CANDIDATE_PAGE',p.fetchedAt);
   const all=detectAllLinkedAts(p.html,p.url);const fallback=detectFromHtml(p.html,p.url);
   r.pages.push({...evidence,from:t.from,transport:p.transport,httpFailure:p.httpFailure,title:cheerio.load(p.html)('title').text().slice(0,200),atsCandidates:all.length?all:fallback?[fallback]:[],unsupportedVendor:unadaptedVendorIn(p.html)});
   for(const link of careerCandidates(p.html,p.url)) {
    if(!isPublicHttpUrl(link.to))continue;
    r.links.push({...link,fromPageHash:evidence.sha256,directCandidate:!indirect(link.to)});
    if(t.depth<2 && !indirect(link.to) && !visited.has(fetchUrl(link.to)))queue.push({url:fetchUrl(link.to),depth:t.depth+1,from:p.url});
   }
  } catch(e) {r.failures.push({url:t.url,error:String(e).slice(0,1000),step:'CAREER_DISCOVERY'});}
 }
 r.unvisited=queue.filter(t=>!visited.has(t.url));
 r.remainingProfileUrls=s.profileUrls.filter(u=>!r.profiles.some((p:any)=>p.profileUrl===u) && !r.failures.some((f:any)=>f.url===u));
 r.status=r.pages.some((p:any)=>p.atsCandidates.length)?'ATS_CANDIDATES_TO_QUALIFY':r.links.some((l:any)=>l.directCandidate)?'CAREER_LINKS_TO_QUALIFY':r.pages.length?'NO_CAREER_LINK_ON_PAGES_READ':'WEBSITE_SEARCH_REQUIRED';
 r.nextAction=r.status==='ATS_CANDIDATES_TO_QUALIFY'?'Verify official employer ownership, all regional portals and real API enumeration.':r.unvisited.length?'Continue unvisited career links; current bounded pass is not proof of absence.':'Search official domain and alternate regional/group career portals; inspect documented failures.';
 r.finishedAt=new Date().toISOString();return r;
}
const subjects=input.filter(s=>(mode==='all'||(mode==='known'?s.urls.length>0:s.urls.length===0))&&!completed.has(`${s.id}:${hash(JSON.stringify(s))}:${version}`));
const limit=pLimit(2);let done=0;
console.log(JSON.stringify({version,mode,total:subjects.length,alreadyRecorded:completed.size}));
try {
 await Promise.all(subjects.map(s=>limit(async()=>{
  let r:any;
  try {r=await withSourceBudget(()=>inspect(s),150000,s.id);}catch(e){r={...(progress.get(s.id)??{}),id:s.id,name:s.name,inputHash:hash(JSON.stringify(s)),version,at:new Date().toISOString(),status:'RESEARCH_INTERRUPTED',error:String(e).slice(0,1000),nextAction:'Continue from the preserved pages and metadata; investigate transport/deadline before concluding.'};}
  appendFileSync(output,JSON.stringify(r)+'\n',{mode:0o600});progress.delete(s.id);done++;
  if(done%10===0||done===subjects.length)console.log(JSON.stringify({done,total:subjects.length,status:r.status}));
 })));
} finally {await closeBrowser();}
