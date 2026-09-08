/** Direct official pages only. No FashionJobs offers; no database writes. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { fetchRenderedHtml, closeBrowser } from '../../../apps/aggregator/src/lib/browser.js';
import { fetchWithRetry, readBodyBounded } from '../../../apps/aggregator/src/lib/http.js';
import { withSourceBudget } from '../../../apps/aggregator/src/lib/sourceBudget.js';
const urls = [
  'https://careers.werecruit.io/fr/armor-lux',
  'https://www.oniverse.it/en/careers/join-oniverse',
  'https://careers.oniverse.it/fr-FR/home',
  'https://recrutement.intersport.fr/',
  'https://www.blackstore.fr/qui-sommes-nous/',
  'https://blackstore.candidater.fr/',
  'https://gerarddarel.com/fr-fr/recruitment',
  'https://gerarddarel.taleez.com/',
  'https://careers.skechers.com/fr/fr/search-results',
  'https://careers.hugoboss.com/global/en',
  'https://support.adopt.com/hc/fr/articles/11675835227804-Comment-faire-pour-postuler-chez-Adopt-Parfums',
];
const path = 'backups/remediation-20260908/priority-portals.json';
const results: any[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
const limit = pLimit(3);
try {
  await Promise.all(urls.filter(url=>!results.some(r=>r.url===url)).map(url=>limit(async()=>{
    let result: any;
    try {
      result = await withSourceBudget(async()=>{
        let html: string;
        try { html = await readBodyBounded(await fetchWithRetry(url, { signal: AbortSignal.timeout(20000) }, 1), url); }
        catch { html = await fetchRenderedHtml(url); }
        // WeRecruit renders its job list client-side: inspect the real UI too.
        if (url.includes('careers.werecruit.io')) html = await fetchRenderedHtml(url);
        const sha256 = createHash('sha256').update(html).digest('hex');
        writeFileSync(`backups/remediation-20260908/portal-evidence/${sha256}.html`,html,{mode:0o600});
        const $ = cheerio.load(html);
        return { url, at: new Date().toISOString(), sha256, title: $('title').text(),
          relevantLinks: $('a[href]').map((_,a)=>({text:$(a).text().trim().slice(0,100),href:$(a).attr('href')})).get().filter(a=>/career|carri[eè]re|recrut|rejoindre|taleez|werecruit|candidater|jobs|emplois|oniverse|smartrecruiters/i.test(a.text+' '+a.href)),
          counterFragments: $('body').text().replace(/\s+/g,' ').match(/.{0,60}\d+\s+(?:offres?|jobs|positions|résultats|results).{0,80}/gi)?.slice(0,15) ?? [],
          identityOrCompletionCertified: false };
      }, 65000, url);
    } catch(error) { result = {url,at:new Date().toISOString(),error:String(error).slice(0,300)}; }
    results.push(result); writeFileSync(path,JSON.stringify(results,null,2),{mode:0o600});
    console.log(JSON.stringify({url,error:result.error,counterFragments:result.counterFragments,links:result.relevantLinks?.length}));
  })));
} finally { await closeBrowser(); }
