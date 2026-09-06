import { fetchTalentFunnelJobs } from '../ats/adapters/talentFunnel.js';

/**
 * g4 — Dr. Martens (Talent Funnel) en direct :
 * `npx tsx src/discovery/g4-drmartens.mts [--no-detail]`
 * Le tenant est celui lu dans le `__NEXT_DATA__` de jobs.drmartens.com/results.
 */
const withDescriptions = !process.argv.includes('--no-detail');
const t0 = Date.now();
const r = await fetchTalentFunnelJobs({
  origin: 'https://jobs.drmartens.com',
  tenant: 'a3e88308-2615-4415-bb56-cc5267bc1ced',
  withDescriptions,
});
const j = r.jobs;
console.log(
  `drmartens (detail=${withDescriptions}): ${j.length} offres | ${j.filter((k) => k.location || k.city).length} lieu | ${j.filter((k) => (k.description ?? '').length > 200).length} desc | ${j.filter((k) => k.postedAt).length} date | ${Math.round((Date.now() - t0) / 1000)}s | declaredTotal=${r.declaredTotal} truncated=${r.truncated}`,
);
if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 50)} @ ${j[0].location ?? j[0].city ?? '-'} → ${j[0].url}`);
console.log(`   pays: ${[...new Set(j.map((k) => k.country))].join(',')}`);
