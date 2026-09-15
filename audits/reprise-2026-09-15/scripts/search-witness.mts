import fs from 'node:fs';import {prisma} from '/Users/lmelane/Downloads/catwalks-job-aggregator/packages/db/index.ts';
import {getJobs,parseFilters,suggestCities} from '/Users/lmelane/Downloads/catwalks-job-aggregator/apps/api/lib/jobs.ts';
process.chdir('/Users/lmelane/Downloads/catwalks-job-aggregator/apps/api');
try{
 const guard=await prisma.$queryRawUnsafe("SELECT current_setting('default_transaction_read_only') AS readonly");if(guard[0].readonly!=='on')throw Error('READ ONLY REQUIRED');
 const cases=[];for(const params of [{marche:'US'},{marche:'US',pays:'US'},{marche:'FR'},{marche:'CN'},{q:'beauty advisor',pays:'US'},{q:'école',pays:'FR'},{q:'ecole',pays:'FR'},{q:'销售',pays:'CN'}]){
  const f=parseFilters(params),start=Date.now();const r=await getJobs(f);cases.push({params,filters:f,ms:Date.now()-start,total:r.total,countries:[...new Set(r.jobs.map(j=>j.countryCode))],titles:r.jobs.slice(0,3).map(j=>j.title),facets:Object.keys(r).filter(k=>Array.isArray(r[k]))});
 }
 const cities={US:await suggestCities('Pa','US'),FR:await suggestCities('Pa','FR'),CN:await suggestCities('Pa','CN')};fs.writeFileSync('/tmp/catwalks-audit-20260915/search-witness.json',JSON.stringify({guard,cases,cities},null,2));console.log(cases.map(({params,total,ms,countries})=>({params,total,ms,countries})));
}finally{await prisma.$disconnect();}
