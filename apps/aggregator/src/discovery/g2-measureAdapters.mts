import { fetchGeoDirectoryJobs } from '../ats/adapters/geodirectory.js';
import { fetchEqwaJobs } from '../ats/adapters/eqwa.js';
import { fetchRivoliTypesenseJobs } from '../ats/adapters/rivoliTypesense.js';
import { fetchFrontityJobs } from '../ats/adapters/frontityJobs.js';

/**
 * g2 — mesure des quatre adaptateurs écrits pour ce lot, appelés directement
 * (le dispatch `src/ats/index.ts` n'est pas touché). Lecture seule.
 * `npx tsx src/discovery/g2-measureAdapters.mts [nom]`
 */
const RUNS: Record<string, () => Promise<any>> = {
  'beauty-success': () => fetchGeoDirectoryJobs({ origin: 'https://recrutement.beautysuccess.fr', restBase: 'offres' }),
  nocibe: () => fetchEqwaJobs({ origin: 'https://recrutement-nocibe.fr' }),
  rivoli: () =>
    fetchRivoliTypesenseJobs({
      typesenseOrigin: 'https://typesense.rivoligroup.com',
      apiKey: 'XVzrzN4lSwOowagLCo3jidFzJoDnq7ww',
      collection: 'vacancy',
      origin: 'https://www.rivoligroup.com',
    }),
  douglas: () => fetchFrontityJobs({ origin: 'https://careers.douglas.group', lang: 'fr' }),
};

const only = process.argv[2];
for (const [name, run] of Object.entries(RUNS)) {
  if (only && only !== name) continue;
  const t0 = Date.now();
  try {
    const r = await run();
    const j = Array.isArray(r) ? r : r.jobs ?? [];
    console.log(
      `${name}: ${j.length} offres | ${j.filter((k: any) => k.location || k.city).length} lieu | ${j.filter((k: any) => (k.description ?? '').length > 200).length} desc | ${Math.round((Date.now() - t0) / 1000)}s` +
        (r.declaredTotal !== undefined ? ` | declaredTotal ${r.declaredTotal}${r.truncated ? ' TRUNCATED' : ''}` : ''),
    );
    if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 50)} @ ${j[0].location ?? j[0].city ?? '-'} | ${j[0].postedAt?.toISOString?.().slice(0, 10) ?? '-'} | ${j[0].url}`);
  } catch (error) {
    console.log(`${name}: ERREUR ${(error as Error).message.slice(0, 200)}`);
  }
}
