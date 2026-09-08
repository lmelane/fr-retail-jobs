/** Captures public identity/board/robots evidence. No production writes. */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { fetchText } from '../../../apps/aggregator/src/lib/http.js';
import { parseFlatchrBoard } from '../../../apps/aggregator/src/ats/adapters/flatchr.js';
import { normalizeCountry } from '../../../apps/aggregator/src/normalize/country.js';
import { resolveCompany } from '../../../apps/aggregator/src/normalize/company.js';
const root = 'backups/remediation-20260908';
const definitions = [
 { key:'adopt-parfums', name:'Adopt Parfums', domain:'adopt.com', official:'https://www.adopt.com/fr/', portal:'https://adopt.flatchr.io/fr/company/adopt/', sector:'BEAUTY', expected:121 },
 { key:'riu-paris', name:'RIU Paris', domain:'riuparis.fr', official:'https://www.riuparis.fr/fr-fr/recrutement', portal:'https://riuparis.flatchr.io/fr/company/riuparis/', sector:'FASHION', expected:15 },
 { key:'toscane', name:'Toscane', domain:'toscane-boutique.fr', official:'https://www.toscane-boutique.fr/', portal:'https://toscane.flatchr.io/fr/company/toscane/', sector:'FASHION', expected:20 },
];
const hash = (s:string) => createHash('sha256').update(s).digest('hex');
const records=[];
for (const d of definitions) {
 const official = await fetchText(d.official);
 const $ = cheerio.load(official);
 const links = $('a[href]').toArray().map(a=>({href:$(a).attr('href')!,label:$(a).text().trim()}))
   .filter(l=>{try{return new URL(l.href,d.official).hostname===new URL(d.portal).hostname;}catch{return false;}});
 if(!links.length)throw new Error(`No official link: ${d.key}`);
 const html = await fetchText(d.portal);
 const result = parseFlatchrBoard(html,d.portal);
 if(!result.complete || result.jobs.length!==d.expected || result.jobs.some(j=>j.company!==d.name))throw new Error(`Changed/incomplete/mixed-employer feed ${d.key}`);
 const robots = await fetchText(new URL('/robots.txt',d.portal).href);
 // Reviewed vendor robots: restrictions for named bots only, none for our UA or *.
 if (/user-agent:\s*(?:\*|Catwalks)/i.test(robots))throw new Error(`Robots requires renewed path-specific review: ${d.key}`);
 const countries:Record<string,number>={};
 for(const j of result.jobs){const c=normalizeCountry(j.country)??'UNKNOWN';countries[c]=(countries[c]??0)+1;}
 if(countries.UNKNOWN)throw new Error(`Unresolved countries ${d.key}`);
 const paths = { official:`${root}/${d.key}-official-proof.html`, board:`${root}/${d.key}-board-proof.html`, robots:`${root}/${d.key}-robots-proof.txt` };
 for(const [k,v] of Object.entries({official,board:html,robots}))writeFileSync(paths[k as keyof typeof paths],v,{mode:0o600});
 records.push({...d, canonicalKey:resolveCompany(d.name).companyId, kind:'MAISON', parentGroup:null,
   parentGroupStatus:'NOT_REVIEWED_NOT_ASSERTED', aliases: d.key==='adopt-parfums'?['Adopt','Adopt Parfums']:[d.name],
   checkedAt:new Date().toISOString(), paths, officialHash:hash(official), boardHash:hash(html), robotsHash:hash(robots),
   officialLinks:links, robotsVerdict:'ALLOWED', jobs:result.jobs.length, countries, ids:result.jobs.map(j=>j.externalId).sort(),
   enumeration:'Public unfiltered Next.js data.items; UI count equals unique vacancy count; no country filter.',
   identityStatement:`${d.official} links explicitly to ${new URL(d.portal).hostname}; the unfiltered Flatchr board names ${d.name} on every vacancy. Identity reviewed from employer website, not a guessed ATS slug.`,
 });
 console.log(JSON.stringify({key:d.key,jobs:result.jobs.length,countries,identityLink:links[0]}));
}
const manifest={version:1,batchId:'20260908-FLATCHR-DIRECT-v1',records};
writeFileSync(`${root}/flatchr-manifest.json`,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
writeFileSync('audits/2026-09-08/direct-sources/flatchr-certificates.json',JSON.stringify(manifest,null,2)+'\n');
