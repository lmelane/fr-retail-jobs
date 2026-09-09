/** Explicit reference-data update; never executed by ingestion or deployment.
 * The checked-in snapshot prevents runtime ICU versions changing canonical output.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeCountry } from '../src/normalize/country.js';
const file=fileURLToPath(new URL('../data/country-labels.json',import.meta.url));
const previous=JSON.parse(readFileSync(file,'utf8'));
if(process.versions.icu!==previous.provenance.icu || process.versions.cldr!==previous.provenance.cldr) throw Error(`Reference runtime required: ICU ${previous.provenance.icu}, CLDR ${previous.provenance.cldr}; review a new release before changing them`);
const locales=previous.provenance.locales as string[];
const codes:string[]=[];
for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){const code=String.fromCharCode(a,b);if(normalizeCountry(code)===code)codes.push(code);}
const labels=new Map<string,Set<string>>(),legacy=new Map<string,string>();
for(const locale of locales){const names=new Intl.DisplayNames([locale],{type:'region'});for(const code of codes){const name=names.of(code);if(!name||name===code)continue;const key=name.trim().normalize('NFC').toLowerCase().replace(/\s+/g,' ');if(!labels.has(key))labels.set(key,new Set());labels.get(key)!.add(code);}}
// Preserve the pre-release English/French precedence separately from the new
// multilingual collision-aware lookup, with a check against the frozen baseline.
for(const locale of ['en','fr']){const names=new Intl.DisplayNames([locale],{type:'region'});for(const code of codes){const name=names.of(code);if(name&&name!==code)legacy.set(name.toLowerCase(),code);}}
for(const [key,code] of Object.entries(previous.legacyEnglishFrenchLabels))if(legacy.get(key)!==code)throw Error(`Legacy reference changed: ${key}`);
const ordered=(rows:Iterable<[string,unknown]>)=>Object.fromEntries([...rows].sort(([a],[b])=>a<b?-1:a>b?1:0));
const result={version:previous.version,provenance:{...previous.provenance,source:'https://cldr.unicode.org/',license:'https://www.unicode.org/license.txt'},
 labels:ordered([...labels].map(([key,value])=>[key,[...value].sort()])),legacyEnglishFrenchLabels:ordered(legacy)};
const output=JSON.stringify(result,null,2)+'\n';
if(process.argv.includes('--write'))writeFileSync(file,output);else if(output!==readFileSync(file,'utf8'))throw Error('Reference differs; inspect --write diff');
console.log(JSON.stringify({version:result.version,codes:codes.length,labels:labels.size,ambiguous:[...labels].filter(([,v])=>v.size>1).length,mode:process.argv.includes('--write')?'write':'check'}));
