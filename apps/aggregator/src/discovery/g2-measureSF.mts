import { fetchSuccessFactorsJobs } from '../ats/adapters/successfactors.js';

/**
 * g2 — mesure de l'adaptateur SuccessFactors (chemin HTML Career Site Builder
 * ET chemin JSON RMK v2) sur les tenants du lot. Lecture seule.
 * `npx tsx src/discovery/g2-measureSF.mts [nom] [--no-desc]`
 */
const CONFIGS: Record<string, Record<string, unknown>> = {
  douglas: { origin: 'https://jobs.douglas.group' },
  breitling: { origin: 'https://careers.breitling.com' },
  'puig-rmk-old': { origin: 'https://jobs.puig.com' },
  'puig-careers': { origin: 'https://careers.puig.com' },
};

const only = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
const noDesc = process.argv.includes('--no-desc');
for (const [name, config] of Object.entries(CONFIGS)) {
  if (only && only !== name) continue;
  const t0 = Date.now();
  try {
    const r: any = await fetchSuccessFactorsJobs({ ...config, ...(noDesc ? { withDescriptions: false } : {}) });
    const j = Array.isArray(r) ? r : r.jobs ?? [];
    console.log(
      `${name}: ${j.length} offres | ${j.filter((k: any) => k.location || k.city).length} lieu | ${j.filter((k: any) => (k.description ?? '').length > 200).length} desc | ${Math.round((Date.now() - t0) / 1000)}s` +
        (r.declaredTotal !== undefined ? ` | declaredTotal ${r.declaredTotal}${r.truncated ? ' TRUNCATED' : ''}` : ''),
    );
    if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 50)} @ ${j[0].location ?? j[0].city ?? '-'} | ${j[0].country ?? '-'} | ${j[0].postedAt?.toISOString?.().slice(0, 10) ?? '-'} | ${j[0].url}`);
    const bad = j.filter((k: any) => !k.url || !k.title);
    if (bad.length) console.log(`   sans url/titre: ${bad.length}`);
  } catch (error) {
    console.log(`${name}: ERREUR ${(error as Error).message.slice(0, 200)}`);
  }
}
