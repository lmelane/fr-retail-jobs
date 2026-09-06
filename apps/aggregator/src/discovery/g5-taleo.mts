import { fetchTaleoJobs } from '../ats/adapters/taleo.js';

/**
 * g5 — mesure de l'adaptateur Taleo Business Edition sur Brown Thomas Arnotts.
 * Les 17 sections `cws` sont celles liées depuis brownthomasarnottscareers.com
 * (retail : 70-79 ; head office : 60-66 sauf 65 ; 79 = « all »), relevées le
 * 2026-09-06. Lecture seule. `npx tsx src/discovery/g5-taleo.mts [--no-desc]`
 */

const NO_DESC = process.argv.includes('--no-desc');
const CONFIG = {
  origin: 'https://lde.tbe.taleo.net/lde02',
  org: 'ARNOTTS',
  cws: [79, 70, 71, 72, 73, 74, 75, 76, 77, 78, 60, 61, 62, 63, 64, 66],
};

const t0 = Date.now();
const r = await fetchTaleoJobs({ ...CONFIG, withDescriptions: !NO_DESC });
const j = r.jobs;
console.log(
  `Brown Thomas Arnotts: ${j.length} offres | ${j.filter((k) => k.location || k.city).length} lieu | ${
    j.filter((k) => (k.description ?? '').length > 200).length
  } desc>200 | ${j.filter((k) => k.postedAt).length} date | ${Math.round((Date.now() - t0) / 1000)}s`,
);
if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 60)} @ ${j[0].location ?? '-'} — ${j[0].url}`);
for (const k of j) console.log(`   ${k.externalId}  ${k.title.slice(0, 50).padEnd(50)} @ ${k.location ?? '-'}  desc=${(k.description ?? '').length}`);
