/** Explicit reference-data update; never executed by ingestion or deployment.
 * The checked-in snapshot prevents runtime ICU versions changing canonical output.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { normalizeCountry } from '../src/normalize/country.js';
const file=fileURLToPath(new URL('../data/reference/country-labels.json',import.meta.url));
const previous=JSON.parse(readFileSync(file,'utf8'));
const {values}=parseArgs({options:{write:{type:'boolean'},'cldr-dir':{type:'string'},version:{type:'string'}}});
if(process.versions.icu!==previous.provenance.icu || process.versions.cldr!==previous.provenance.cldr) throw Error(`Reference runtime required: ICU ${previous.provenance.icu}, CLDR ${previous.provenance.cldr}; review a new release before changing them`);
const locales=previous.provenance.locales as string[];
const codes:string[]=[];
for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){const code=String.fromCharCode(a,b);if(normalizeCountry(code)===code)codes.push(code);}
const labels=new Map<string,Set<string>>(),legacy=new Map<string,string>();
for(const locale of locales){const names=new Intl.DisplayNames([locale],{type:'region'});for(const code of codes){const name=names.of(code);if(!name||name===code)continue;const key=name.trim().normalize('NFC').toLowerCase().replace(/\s+/g,' ');if(!labels.has(key))labels.set(key,new Set());labels.get(key)!.add(code);}}
// Intl.DisplayNames exposes the preferred name, not CLDR's historical/formal
// variants (e.g. Czech republic vs Czechia). Import the publisher's alternative
// labels as data, with the same collision checks as preferred names.
let territoryVariants=previous.provenance.territoryVariants;
if (territoryVariants && !values['cldr-dir']) throw Error('Pinned CLDR package directory required to reproduce this reference');
if (values['cldr-dir']) {
 const root=resolve(values['cldr-dir']),pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
 if (pkg.name!=='cldr-localenames-full'||pkg.version!=='48.0.0') throw Error('Expected cldr-localenames-full@48.0.0');
 const hashes:Record<string,string>={};let count=0;
 for(const locale of locales){
  const bytes=readFileSync(resolve(root,'main',locale,'territories.json'));hashes[locale]=createHash('sha256').update(bytes).digest('hex');
  const territories=JSON.parse(bytes.toString()).main[locale].localeDisplayNames.territories;
  for(const [id,name]of Object.entries(territories)){
   const match=/^([A-Z]{2})-alt-(?:variant|short)$/.exec(id);
   if(!match||!codes.includes(match[1])||typeof name!=='string')continue;
   const key=name.trim().normalize('NFC').toLowerCase().replace(/\s+/g,' ');
   if(!labels.has(key))labels.set(key,new Set());labels.get(key)!.add(match[1]);count++;
  }
 }
 const contentHash=createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
 if(territoryVariants&&territoryVariants.contentHash!==contentHash)throw Error('CLDR source content differs from pinned reference');
 territoryVariants={package:pkg.name,version:pkg.version,source:'https://github.com/unicode-org/cldr-json/tree/48.0.0/cldr-json/cldr-localenames-full',contentHash,files:hashes,observations:count};
}
// Preserve the pre-release English/French precedence separately from the new
// multilingual collision-aware lookup, with a check against the frozen baseline.
for(const locale of ['en','fr']){const names=new Intl.DisplayNames([locale],{type:'region'});for(const code of codes){const name=names.of(code);if(name&&name!==code)legacy.set(name.toLowerCase(),code);}}
for(const [key,code] of Object.entries(previous.legacyEnglishFrenchLabels))if(legacy.get(key)!==code)throw Error(`Legacy reference changed: ${key}`);
const ordered=(rows:Iterable<[string,unknown]>)=>Object.fromEntries([...rows].sort(([a],[b])=>a<b?-1:a>b?1:0));
const result={version:values.version??previous.version,provenance:{...previous.provenance,source:'https://cldr.unicode.org/',license:'https://www.unicode.org/license.txt',...(territoryVariants?{territoryVariants}:{})},
 labels:ordered([...labels].map(([key,value])=>[key,[...value].sort()])),legacyEnglishFrenchLabels:ordered(legacy)};
const output=JSON.stringify(result,null,2)+'\n';
if(values.write)writeFileSync(file,output);else if(output!==readFileSync(file,'utf8'))throw Error('Reference differs; inspect --write diff');
console.log(JSON.stringify({version:result.version,codes:codes.length,labels:labels.size,ambiguous:[...labels].filter(([,v])=>v.size>1).length,mode:values.write?'write':'check'}));
