/**
 * w1 — mesure réelle de l'adaptateur sectoriel WTTJ.
 *
 *   cd apps/aggregator && npx tsx src/discovery/w1-wttj-sector.mts [core|flbl] [--no-desc]
 *
 * `core` (défaut) : les cinq sous-secteurs du cœur de périmètre ;
 * `flbl`          : tout le parent « fashion-luxury-beauty-lifestyle ».
 * Imprime : offres | lieu | desc>200 | date, monde et France, par organisation
 * et par sous-secteur, et le temps. Lecture seule, aucune base.
 */
import { writeFileSync } from 'node:fs';
import { fetchWttjSectorJobs } from '../ats/adapters/wttjSector.js';
import { wttjSearch } from '../ats/adapters/wttj.js';
import { isFranceJob } from '../lib/france.js';
import type { NormalizedJob } from '../types.js';

const mode = process.argv[2] === 'flbl' ? 'flbl' : 'core';
const withDescriptions = !process.argv.includes('--no-desc');
const config =
  mode === 'flbl'
    ? { parentSectors: ['fashion-luxury-beauty-lifestyle'], sectors: [], withDescriptions }
    : { withDescriptions };

const t0 = Date.now();
const { jobs, declaredTotal, truncated } = await fetchWttjSectorJobs(config);
const seconds = Math.round((Date.now() - t0) / 1000);

type Row = { n: number; lieu: number; desc: number; date: number; fr: number };
const row = (): Row => ({ n: 0, lieu: 0, desc: 0, date: 0, fr: 0 });
const add = (r: Row, j: NormalizedJob) => {
  r.n++;
  if (j.location || j.city) r.lieu++;
  if ((j.description ?? '').length > 200) r.desc++;
  if (j.postedAt) r.date++;
  if (isFranceJob(j.country, j.location)) r.fr++;
};

const total = row();
const byOrg = new Map<string, Row>();
const bySector = new Map<string, Row>();
for (const j of jobs) {
  add(total, j);
  const raw = j.raw as { organization?: { slug?: string }; sectors?: { reference: string }[] };
  const org = raw.organization?.slug ?? '?';
  if (!byOrg.has(org)) byOrg.set(org, row());
  add(byOrg.get(org)!, j);
  for (const s of raw.sectors ?? []) {
    if (!bySector.has(s.reference)) bySector.set(s.reference, row());
    add(bySector.get(s.reference)!, j);
  }
}

const fmt = (label: string, r: Row) =>
  `${label.padEnd(34)} ${String(r.n).padStart(5)} offres | ${String(r.lieu).padStart(5)} lieu | ${String(r.desc).padStart(5)} desc | ${String(r.date).padStart(5)} date | ${String(r.fr).padStart(5)} FR`;

console.log(`\n=== WTTJ_SECTOR (${mode}, descriptions=${withDescriptions}) — ${seconds}s`);
console.log(fmt('TOTAL', total) + ` | déclaré ${declaredTotal} | truncated=${truncated}`);
console.log(`organisations lues : ${byOrg.size}`);
const ex = jobs[0];
if (ex) console.log(`ex: ${ex.title.slice(0, 60)} @ ${ex.location ?? ex.city ?? '-'} (${ex.company}) ${ex.url}`);

console.log('\n--- par sous-secteur (une offre compte dans chaque secteur de son organisation)');
for (const [k, r] of [...bySector].sort((a, b) => b[1].n - a[1].n)) console.log(fmt(k, r));

console.log('\n--- par organisation');
for (const [k, r] of [...byOrg].sort((a, b) => b[1].n - a[1].n)) console.log(fmt(k, r));

// Contrôle indépendant : ce que l'index annonce pour le même filtre.
const filter =
  mode === 'flbl'
    ? 'sectors.parent_reference:"fashion-luxury-beauty-lifestyle"'
    : ['luxury-1', 'fashion-1', 'cosmetics', 'jewelry-1', 'mode'].map((s) => `sectors.reference:"${s}"`).join(' OR ');
const check = await wttjSearch<{ nbHits?: number; facets?: Record<string, Record<string, number>> }>({
  query: '',
  filters: filter,
  hitsPerPage: 0,
  facets: ['organization.slug'],
  maxValuesPerFacet: 1000,
});
console.log(`\ncontrôle index : nbHits=${check.nbHits}, organisations=${Object.keys(check.facets?.['organization.slug'] ?? {}).length}`);

const out = `data/w1-wttj-sector-${mode}.json`;
writeFileSync(
  out,
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      mode,
      withDescriptions,
      seconds,
      total,
      declaredTotal,
      truncated,
      indexNbHits: check.nbHits,
      byOrg: Object.fromEntries(byOrg),
      bySector: Object.fromEntries(bySector),
      sample: jobs.slice(0, 3).map((j) => ({ ...j, raw: undefined, description: (j.description ?? '').slice(0, 300) })),
    },
    null,
    1,
  ),
);
console.log(`écrit ${out}`);
