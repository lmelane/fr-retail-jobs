import { fetchAtsJobs } from '../ats/index.js';
import { attachWorkdayDescriptions, fetchWorkdayJobs } from '../ats/adapters/workday.js';
import { normalizeContract, normalizeWorkingTime, isWorkingTimeValue, extractContract } from '../normalize/contract.js';
import { normalizeCountry } from '../normalize/country.js';
import type { NormalizedJob } from '../types.js';

/**
 * l2 — la ligne de mesure avant/après, calculée comme la frontière `ingest` :
 *   n | contrat structuré | contrat effectif (repli titre/description) | temps |
 *   pays ISO | langue déclarée | date | validThrough | sociétés (top 5) | exemple
 * Usage : npx tsx src/discovery/l2-measure.mts <cible> [limite-détails]
 * Cibles : tapestry chanel elc kering footlocker ulta hmgroup primark douglas lvmh loreal taleo
 * Lecture seule : aucune écriture en base.
 */
const WD = {
  tapestry: { tenant: 'tapestry', site: 'Tapestry_Careers', origin: 'https://tapestry.wd108.myworkdayjobs.com' },
  chanel: { tenant: 'cc', site: 'ChanelCareers', origin: 'https://cc.wd3.myworkdayjobs.com' },
} as const;

const target = process.argv[2] ?? '';
const limit = Number(process.argv[3] ?? 100);
const t0 = Date.now();

async function load(): Promise<NormalizedJob[]> {
  if (target in WD) {
    const cfg = WD[target as keyof typeof WD];
    const { jobs } = await fetchWorkdayJobs({ ...cfg, withDescriptions: false });
    console.log(`  liste: ${jobs.length} offres ; détails sur les ${Math.min(limit, jobs.length)} premières`);
    return attachWorkdayDescriptions(jobs.slice(0, limit), `${cfg.origin}/wday/cxs/${cfg.tenant}/${cfg.site}`);
  }
  const run = (type: string, config: Record<string, unknown>) => fetchAtsJobs(type as never, config).then((r) => r.jobs);
  switch (target) {
    case 'elc': return run('EIGHTFOLD', { origin: 'https://careers.elcompanies.com', domain: 'elcompanies.com', withDescriptions: limit > 0 ? undefined : false });
    case 'kering': return run('EIGHTFOLD', { origin: 'https://careers.kering.com', domain: 'kering.com', withDescriptions: limit > 0 ? undefined : false });
    case 'footlocker': return run('PHENOM', { origin: 'https://careers.footlocker.com' });
    case 'ulta': return run('JIBE', { origin: 'https://careers.ulta.com' });
    case 'hmgroup': return run('SMARTRECRUITERS', { company: 'HMGroup', withDescriptions: false });
    case 'primark': return run('SMARTRECRUITERS', { company: 'primark', withDescriptions: false });
    case 'douglas': return run('SUCCESSFACTORS', { origin: 'https://jobs.douglas.group', withDescriptions: false });
    case 'lvmh': return run('LVMH_ALGOLIA', { country: null });
    case 'loreal': return run('AVATURE', { listingUrl: 'https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0', origin: 'https://careers.loreal.com', maxPages: limit });
    case 'taleo': return run('TALEO', { origin: 'https://lde.tbe.taleo.net/lde02', org: 'ARNOTTS', cws: [79, 70, 60] });
    default: throw new Error(`cible inconnue: ${target}`);
  }
}

const jobs = await load();
const n = jobs.length;
const pct = (k: number) => `${k} (${n ? Math.round((100 * k) / n) : 0} %)`;
const structured = jobs.filter((j) => !isWorkingTimeValue(j.contract) && normalizeContract(j.contract) !== 'UNKNOWN').length;
const effective = jobs.filter((j) => {
  const c = isWorkingTimeValue(j.contract) ? 'UNKNOWN' : normalizeContract(j.contract);
  return (c === 'UNKNOWN' ? extractContract(j.title, j.description) : c) !== 'UNKNOWN';
}).length;
const time = jobs.filter((j) => normalizeWorkingTime(isWorkingTimeValue(j.contract) ? j.contract : j.workingTime) !== 'UNKNOWN').length;
const countryIso = jobs.filter((j) => normalizeCountry(j.country)).length;
const countryRaw = jobs.filter((j) => j.country).length;
const lang = jobs.filter((j) => j.language).length;
const dated = jobs.filter((j) => j.postedAt).length;
const valid = jobs.filter((j) => j.validThrough).length;
const remote = jobs.filter((j) => j.remote).length;
const top = (f: (j: NormalizedJob) => string | undefined, k = 5) => {
  const m = new Map<string, number>();
  for (const j of jobs) { const v = f(j) ?? '∅'; m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([v, c]) => `${v}:${c}`).join(' · ');
};
console.log(`[${target}] ${n} offres | contrat structuré ${pct(structured)} | contrat effectif ${pct(effective)} | temps ${pct(time)} | pays brut ${pct(countryRaw)} / ISO ${pct(countryIso)} | langue ${pct(lang)} | date ${pct(dated)} | validThrough ${pct(valid)} | remote ${pct(remote)} | ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`  sociétés: ${top((j) => j.company)}`);
console.log(`  pays bruts: ${top((j) => j.country, 8)}`);
console.log(`  contrat bruts: ${top((j) => j.contract, 6)} | temps bruts: ${top((j) => j.workingTime, 6)}`);
const ex = jobs[0];
if (ex) console.log(`  ex: ${String(ex.title).slice(0, 60)} @ ${ex.location ?? ex.city ?? '-'} [${ex.country ?? '-'}] ${ex.company ?? ''} | ${(ex.description ?? '').replace(/\s+/g, ' ').slice(0, 90)}`);
