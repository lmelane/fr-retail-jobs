import { inspectCareerPage } from '/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/src/ats/detect.js';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import pLimit from 'p-limit';

const OUT = '/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/data/deadhost.rescue.tsv';
if (!existsSync(OUT)) appendFileSync(OUT, 'url_morte\tdomaine_teste\tresultat\tdetail\tmarques\n');

const rows = readFileSync('/Users/lmelane/Downloads/catwalks-job-aggregator/apps/aggregator/data/tenants.detection.tsv','utf8')
  .split('\n').slice(1).filter(Boolean).map(l=>l.split('\t')).filter(f=>f[3]==='DEAD_HOST');

const limit = pLimit(4);
let n=0;
await Promise.all(rows.map(f => limit(async () => {
  const host = f[0].replace(/^https?:\/\//,'').replace(/\/.*/,'');
  // Le sous-domaine invente est retire : on repart du domaine de la marque.
  const root = host.split('.').slice(1).join('.') || host;
  let res='rien', detail='';
  for (const base of [`https://www.${root}`, `https://${root}`]) {
    try {
      const d = await inspectCareerPage(base, 1);
      if (d) { res = d.type; detail = `${d.careersUrl} conf=${d.confidence}${d.note ? ' | '+d.note : ''}`.slice(0,140); break; }
    } catch { /* essai suivant */ }
  }
  appendFileSync(OUT, `${f[0]}\t${root}\t${res}\t${detail}\t${f[5]??''}\n`);
  if (++n % 20 === 0) console.log(`[rescue] ${n}/${rows.length}`);
})));
console.log(`[rescue] termine ${n}`);
