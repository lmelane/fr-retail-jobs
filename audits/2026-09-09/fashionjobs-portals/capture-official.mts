import { fetchText } from '../../../apps/aggregator/src/lib/http.js';
import { careerCandidates } from '../../2026-09-08/fashionjobs-coverage/career-links.mjs';
import { detectFromHtml } from '../../../apps/aggregator/src/ats/detect.js';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const privateOut=process.argv.find(a=>a.startsWith('--out='))?.slice(6);if(!privateOut)throw new Error('--out=<private evidence directory> required');mkdirSync(privateOut,{recursive:true});
const targets=[['ARMOR LUX','https://careers.werecruit.io/fr/armor-lux'],["HISTOIRE D'OR",'https://rejoindre.histoiredor.com/offres-emploi/'],['AUBADE','https://aubade.com/'],['ISABEL MARANT','https://isabelmarant.com/'],['SUD EXPRESS','https://sudexpress.com/']];
const results=[];
for(const [label,url] of targets){
 const at=new Date().toISOString();
 try {const html=await fetchText(url,{signal:AbortSignal.timeout(30000)});const sha256=createHash('sha256').update(html).digest('hex');writeFileSync(`${privateOut}/${sha256}.html`,html);
 const links=careerCandidates(html,url);const detection=detectFromHtml(html,url);
 results.push({label,url,at,sha256,bytes:Buffer.byteLength(html),links,detectedAts:detection?.type,detectedPortal:detection?.careersUrl,productionWrites:0});
 }catch(e){results.push({label,url,at,error:String(e),productionWrites:0})}
}
writeFileSync('audits/2026-09-09/fashionjobs-portals/official-captures.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
