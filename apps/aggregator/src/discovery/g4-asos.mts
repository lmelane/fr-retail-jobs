import { fetchAsosJobs } from '../ats/adapters/asosAlgolia.js';

/** g4 — ASOS (Algolia) en direct : `npx tsx src/discovery/g4-asos.mts` */
const t0 = Date.now();
const r = await fetchAsosJobs({});
const j = r.jobs;
console.log(
  `asos: ${j.length} offres | ${j.filter((k) => k.location || k.city).length} lieu | ${j.filter((k) => (k.description ?? '').length > 200).length} desc | ${j.filter((k) => k.postedAt).length} date | ${Math.round((Date.now() - t0) / 1000)}s | declaredTotal=${r.declaredTotal} truncated=${r.truncated}`,
);
if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 50)} @ ${j[0].location ?? j[0].city ?? '-'} → ${j[0].url}`);
