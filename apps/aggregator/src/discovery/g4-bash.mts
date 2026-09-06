import { fetchBashTalentsJobs } from '../ats/adapters/bashTalents.js';

/** g4 — Ba&sh (talents.ba-sh.com) en direct : `npx tsx src/discovery/g4-bash.mts [--no-detail]` */
const withDescriptions = !process.argv.includes('--no-detail');
const t0 = Date.now();
const r = await fetchBashTalentsJobs({ withDescriptions });
const j = r.jobs;
console.log(
  `bash (detail=${withDescriptions}): ${j.length} offres | ${j.filter((k) => k.location || k.city).length} lieu | ${j.filter((k) => (k.description ?? '').length > 200).length} desc | ${j.filter((k) => k.postedAt).length} date | ${Math.round((Date.now() - t0) / 1000)}s | declaredTotal=${r.declaredTotal} truncated=${r.truncated}`,
);
if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 50)} @ ${j[0].location ?? j[0].city ?? '-'} → ${j[0].url}`);
console.log(`   contrats: ${[...new Set(j.map((k) => k.contract))].join(' | ')}`);
console.log(`   descriptions avec entités HTML résiduelles: ${j.filter((k) => /&[a-z]+;/i.test(k.description ?? '')).length}`);
if (j[0]?.description) console.log(`   desc[0]: ${j[0].description.slice(0, 160).replace(/\n/g, ' ')}`);
