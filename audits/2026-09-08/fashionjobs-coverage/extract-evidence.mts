/** Re-read archived employer pages; no network or data writes to production. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { careerCandidates } from './career-links.mjs';
const root = 'backups/remediation-20260908';
const rows: any[] = [];
for (const mode of ['known','profiles']) {
  const path = `${root}/portal-research-${mode}.jsonl`;
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path,'utf8').split('\n').filter(Boolean)) {
    let r: any; try { r=JSON.parse(line); } catch { continue; }
    const links: any[] = [];
    for (const p of r.pages ?? []) {
      const html = readFileSync(`${root}/portal-evidence/${p.sha256}.html`,'utf8');
      for (const l of careerCandidates(html,p.url)) {
        const url = new URL(l.to);
        for (const key of [...url.searchParams.keys()]) if (/token|signature|auth|api.?key|jwt|^utm_/i.test(key)) url.searchParams.delete(key);
        links.push({...l,to:url.toString(),observedAt:p.at,fromPageHash:p.sha256,
          indirectBoard:/\b(fashionjobs|linkedin|indeed|hellowork|glassdoor)\./i.test(url.hostname)});
      }
    }
    rows.push({name:r.name,attemptAt:r.at,status:r.status,candidateOrigin:r.candidateOrigin,
      declaredWebsites:r.declaredWebsites ?? [],identityCertified:false,sourceActivated:false,
      pages:(r.pages ?? []).map((p:any)=>({url:p.url,at:p.at,sha256:p.sha256,title:p.title,ats:p.atsHint?.type ?? p.unsupportedVendorHint ?? null})),
      links:[...new Map(links.map(l=>[l.from+' '+l.to,l])).values()],
      failures:(r.failures ?? []).map((f:any)=>({url:f.url,error:f.error}))});
  }
}
writeFileSync('audits/2026-09-08/fashionjobs-coverage/discovery-evidence.json',JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify({subjects:rows.length,withCareerCandidates:rows.filter(r=>r.links.some((l:any)=>!l.indirectBoard)).length,withReadablePages:rows.filter(r=>r.pages.length).length}));
