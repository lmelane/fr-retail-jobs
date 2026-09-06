import { fetchAtsJobs } from '../ats/index.js';

/**
 * g2 — mesure des portails résolus avec l'adaptateur GENERIC_JSONLD existant
 * (listing paginé + JSON-LD JobPosting sur les pages de détail).
 * Lecture seule. `npx tsx src/discovery/g2-measureGeneric.mts [nom]`
 */
const CONFIGS: Record<string, Record<string, unknown>> = {
  beiersdorf: {
    listingUrl:
      'https://www.beiersdorf.com/ajax/Jobboard/JobResultAjax?db=web&contextItemId={213FB95D-4545-426C-9F6A-7CD5753A00EA}&lang=en',
    linkPattern: 'career/jobs/',
    pageParam: 'page',
    pageStart: 1,
    maxPages: 40,
  },
  globus: {
    listingUrl: 'https://jobs.globus.ch/offre-emplois.html',
    linkPattern: '-j',
    maxPages: 2,
  },
};

const only = process.argv[2];
for (const [name, config] of Object.entries(CONFIGS)) {
  if (only && only !== name) continue;
  const t0 = Date.now();
  try {
    const r: any = await fetchAtsJobs('GENERIC_JSONLD' as any, config as any);
    const j = Array.isArray(r) ? r : r.jobs ?? [];
    console.log(
      `${name}: ${j.length} offres | ${j.filter((k: any) => k.location || k.city).length} lieu | ${j.filter((k: any) => (k.description ?? '').length > 200).length} desc | ${Math.round((Date.now() - t0) / 1000)}s`,
    );
    if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 50)} @ ${j[0].location ?? j[0].city ?? '-'}`);
    const urls = new Set(j.map((k: any) => k.url));
    console.log(`   urls uniques: ${urls.size}`);
  } catch (error) {
    console.log(`${name}: ERREUR ${(error as Error).message.slice(0, 200)}`);
  }
}
