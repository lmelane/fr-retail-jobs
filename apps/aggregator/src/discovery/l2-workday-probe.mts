import { writeFileSync } from 'node:fs';
import { fetchJson } from '../lib/http.js';
import { fetchWorkdayJobs } from '../ats/adapters/workday.js';

/**
 * l2 — Workday Tapestry : la liste (timeType présent ?), puis UN détail lu
 * en fr-FR (transport par défaut) et en en-US. Les deux JSON sont gardés
 * comme fixtures (description tronquée) pour le test de non-régression.
 * Lecture seule.
 */
const cfg = { tenant: 'tapestry', site: 'Tapestry_Careers', origin: 'https://tapestry.wd108.myworkdayjobs.com' };
const t0 = Date.now();
const { jobs, declaredTotal } = await fetchWorkdayJobs({ ...cfg, withDescriptions: false });
const withTimeType = jobs.filter((j) => (j.raw as { timeType?: string })?.timeType).length;
console.log(`liste: ${jobs.length} offres (declared ${declaredTotal}) | timeType sur la liste: ${withTimeType} | ${Math.round((Date.now() - t0) / 1000)}s`);
console.log('exemple raw liste:', JSON.stringify(jobs[0]?.raw));

const path = (jobs.find((j) => /taiwan|malaysia|hong kong/i.test(j.location ?? '')) ?? jobs[0])?.raw as { externalPath?: string };
const cxs = `${cfg.origin}/wday/cxs/${cfg.tenant}/${cfg.site}${path.externalPath}`;
const fr = await fetchJson<Record<string, unknown>>(cxs);
const en = await fetchJson<Record<string, unknown>>(cxs, { headers: { 'accept-language': 'en-US,en;q=0.9' } });
const trim = (d: Record<string, unknown>) => {
  const info = { ...(d.jobPostingInfo as Record<string, unknown>) };
  info.jobDescription = String(info.jobDescription ?? '').slice(0, 400);
  return { ...d, jobPostingInfo: info, similarJobs: undefined };
};
for (const [lang, d] of [['fr-FR', fr], ['en-US', en]] as const) {
  const info = d.jobPostingInfo as Record<string, unknown>;
  console.log(`\n[${lang}] title=${info.title} | country=${JSON.stringify(info.country)} | timeType=${info.timeType} | remoteType=${info.remoteType} | hiringOrg=${JSON.stringify(d.hiringOrganization)} | startDate=${info.startDate} endDate=${info.endDate}`);
  console.log(`   desc: ${String(info.jobDescription).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`);
  console.log(`   keys: ${Object.keys(info).join(',')}`);
  writeFileSync(`src/ats/adapters/__fixtures__/l2-workday-tapestry-detail-${lang}.json`, JSON.stringify(trim(d), null, 1));
}
