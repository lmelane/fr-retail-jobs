import { fetchRitualsJobs } from '../ats/adapters/rituals.js';

/**
 * g4 — Rituals en direct : `npx tsx src/discovery/g4-rituals.mts [locale,locale…]`
 * Sans argument : fr-FR seule (le défaut de l'adaptateur).
 */
const languages = process.argv[2]?.split(',') ?? ['fr-FR'];
const t0 = Date.now();
const r = await fetchRitualsJobs({ languages });
const j = r.jobs;
console.log(
  `rituals (${languages.join(',')}): ${j.length} offres | ${j.filter((k) => k.location || k.city).length} lieu | ${j.filter((k) => (k.description ?? '').length > 200).length} desc | ${j.filter((k) => k.postedAt).length} date | ${Math.round((Date.now() - t0) / 1000)}s | declaredTotal=${r.declaredTotal} truncated=${r.truncated}`,
);
if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 50)} @ ${j[0].location ?? j[0].city ?? '-'} → ${j[0].url}`);
