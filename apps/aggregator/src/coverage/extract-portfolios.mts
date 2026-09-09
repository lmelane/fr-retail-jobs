/** Reproducible extraction from archived official portfolios. No inferred ownership. */
import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import * as cheerio from 'cheerio';
const [root,specFile,output]=process.argv.slice(2);if(!root||!specFile||!output)throw Error('archive-directory selectors.json output.json');
type Spec={file:string;group:string;selector:string;urlPattern?:string;labelAttribute?:string;allowUrlLabel?:boolean};
const specs:Spec[]=JSON.parse(readFileSync(specFile,'utf8'));const rows:any[]=[];
for(const spec of specs){
 const meta=JSON.parse(readFileSync(`${root}/${spec.file}.json`,'utf8'));const html=readFileSync(`${root}/${meta.sha256}.html`,'utf8');
 if(createHash('sha256').update(html).digest('hex')!==meta.sha256)throw Error(`Archive hash mismatch: ${spec.file}`);
 const $=cheerio.load(html,{scriptingEnabled:false});const pattern=spec.urlPattern?new RegExp(spec.urlPattern):null;const seen=new Map<string,any>();
 $(spec.selector).each((_,element)=>{
  const href=$(element).closest('a').attr('href');const url=href?new URL(href,meta.url).toString():meta.url;if(pattern&&!pattern.test(url))return;
  let name=(spec.labelAttribute?$(element).attr(spec.labelAttribute):$(element).text())?.trim().replace(/\s+/g,' ');let labelOrigin='PUBLISHER_LABEL';
  if((!name||name==='Discover')&&spec.allowUrlLabel){name=new URL(url).pathname.split('/').filter(Boolean).at(-1)?.replace(/-/g,' ');labelOrigin='PORTFOLIO_URL_SLUG_TO_REVIEW';}
  if(!name||name.length>100||/[<>]/.test(name))return;
  const key=pattern?url:name;const prior=seen.get(key);if(prior&&prior.name.length<=name.length)return;
  seen.set(key,{name,labelOrigin,portfolioGroup:spec.group,relationship:'OFFICIAL_PORTFOLIO_LISTING_NOT_OWNERSHIP_INFERENCE',profileUrl:url,proofUrl:meta.url,artifactHash:meta.sha256,checkedAt:meta.at,scopeVerdict:'TO_REVIEW',canonicalMatchVerdict:'TO_REVIEW',sourceActivated:false});
 });rows.push(...seen.values());
}
for(const r of rows)r.id='portfolio-'+createHash('sha256').update(JSON.stringify([r.portfolioGroup,r.profileUrl,r.name])).digest('hex').slice(0,20);
writeFileSync(output,JSON.stringify(rows,null,2));console.log(JSON.stringify({observations:rows.length,groups:Object.fromEntries(specs.map(s=>[s.group,rows.filter(r=>r.portfolioGroup===s.group).length]))}));
