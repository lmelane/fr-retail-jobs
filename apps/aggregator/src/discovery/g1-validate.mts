import { fetchAtsJobs } from '../ats/index.js';

/**
 * g1 — valide les configs candidates des portails du lot avec les adaptateurs
 * existants. Lecture seule, aucune écriture en base.
 * Exécution : cd apps/aggregator && npx tsx src/discovery/g1-validate.mts [nom]
 */

const CANDIDATES: Array<{ name: string; type: string; config: Record<string, unknown> }> = [
  {
    name: 'luxexperience (YNAP + Mytheresa, portail groupe)',
    type: 'GENERIC_JSONLD',
    config: {
      listingUrl: 'https://career.luxexperience.com/open-positions',
      linkPattern: '/open-positions/job-detail/',
      pageParam: 'page',
      pageStart: 1,
      maxPages: 40,
    },
  },
  {
    name: 'mytheresa',
    type: 'GENERIC_JSONLD',
    config: {
      listingUrl: 'https://career.mytheresa.com/en/open-positions',
      linkPattern: '/open-positions/job-detail/',
      pageParam: 'page',
      pageStart: 1,
      maxPages: 40,
    },
  },
  {
    name: 'audemars-piguet',
    type: 'SMARTRECRUITERS',
    config: { company: 'AudemarsPiguet' },
  },
  {
    // Drupal, pagination ?page=N 0-based (pager « dernier » = 27 mesuré le 2026-09-06).
    name: 'swatch-group',
    type: 'GENERIC_JSONLD',
    config: {
      listingUrl: 'https://www.swatchgroup.com/fr/job-finder',
      linkPattern: '/job/',
      pageParam: 'page',
      pageStart: 0,
      maxPages: Number(process.env.G1_MAX_PAGES ?? 60),
    },
  },
];

const only = process.argv[2];
for (const c of CANDIDATES) {
  if (only && !c.name.startsWith(only)) continue;
  const t0 = Date.now();
  try {
    const r: any = await fetchAtsJobs(c.type as any, c.config as any);
    const j: any[] = Array.isArray(r) ? r : r.jobs ?? [];
    const withLoc = j.filter((k) => k.location || k.city).length;
    const withDesc = j.filter((k) => (k.description ?? '').length > 200).length;
    console.log(`${c.name}: ${j.length} offres | ${withLoc} lieu | ${withDesc} desc | ${Math.round((Date.now() - t0) / 1000)}s`);
    if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 60)} @ ${j[0].location ?? j[0].city ?? '-'} | ${j[0].url}`);
    const companies = new Map<string, number>();
    for (const k of j) companies.set(String(k.company ?? '-'), (companies.get(String(k.company ?? '-')) ?? 0) + 1);
    if (companies.size > 1) console.log('   sociétés:', [...companies.entries()].map(([n, v]) => `${n}=${v}`).join(', '));
  } catch (error) {
    console.log(`${c.name}: ERREUR ${(error as Error).message.slice(0, 200)}`);
  }
}
