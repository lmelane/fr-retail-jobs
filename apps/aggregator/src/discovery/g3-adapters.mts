import { fetchJibeJobs } from '../ats/adapters/jibe.js';
import { fetchVolcanicJobs } from '../ats/adapters/volcanic.js';

/**
 * Mesure des deux adaptateurs écrits pour ce lot (appel direct, hors dispatch).
 * Usage : npx tsx src/discovery/g3-adapters.mts [ulta] [fenwick]
 */
const RUNS: Record<string, () => Promise<any>> = {
  fenwick: () => fetchVolcanicJobs({ origin: 'https://www.careers.fenwick.co.uk' }),
  ulta: () => fetchJibeJobs({ origin: 'https://careers.ulta.com' }),
};

for (const name of process.argv.slice(2)) {
  const run = RUNS[name];
  if (!run) {
    console.log(`${name}: inconnu`);
    continue;
  }
  const t0 = Date.now();
  try {
    const r = await run();
    const j: any[] = r.jobs;
    console.log(
      `${name}: ${j.length} offres | ${j.filter((k) => k.location || k.city).length} lieu | ${j.filter((k) => (k.description ?? '').length > 200).length} desc | ${j.filter((k) => k.postedAt).length} date | ${Math.round((Date.now() - t0) / 1000)}s ; declaredTotal ${r.declaredTotal} truncated ${r.truncated}`,
    );
    if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 60)} @ ${j[0].location ?? j[0].city ?? '-'} — ${j[0].url}`);
    const countries = new Map<string, number>();
    for (const k of j) countries.set(k.country ?? '-', (countries.get(k.country ?? '-') ?? 0) + 1);
    console.log(`   pays: ${[...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c}:${n}`).join(' ')}`);
    console.log(`   ids uniques: ${new Set(j.map((k) => k.externalId)).size}`);
  } catch (error) {
    console.log(`${name}: KO ${(error as Error).message.slice(0, 200)} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
}
