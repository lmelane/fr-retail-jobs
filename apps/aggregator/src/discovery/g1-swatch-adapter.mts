import { fetchSwatchGroupJobs } from '../ats/adapters/swatchgroup.js';

/**
 * g1 — mesure de l'adaptateur dédié Swatch Group (hors dispatch). Lecture seule.
 *   cd apps/aggregator && npx tsx src/discovery/g1-swatch-adapter.mts
 */

const t0 = Date.now();
const r = await fetchSwatchGroupJobs({ origin: 'https://www.swatchgroup.com', lang: 'fr' });
const j = r.jobs;
const withLoc = j.filter((k) => k.location || k.city).length;
const withDesc = j.filter((k) => (k.description ?? '').length > 200).length;
console.log(`swatch-group (adaptateur): ${j.length} offres | ${withLoc} lieu | ${withDesc} desc | ${Math.round((Date.now() - t0) / 1000)}s | declaredTotal=${r.declaredTotal}`);
if (j[0]) console.log(`   ex: ${j[0].title.slice(0, 60)} @ ${j[0].location ?? '-'} [${j[0].city ?? '-'} / ${j[0].country ?? '-'}] | ${j[0].company} | ${j[0].url}`);

const count = (pick: (k: (typeof j)[number]) => string) => {
  const m = new Map<string, number>();
  for (const k of j) m.set(pick(k), (m.get(pick(k)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n}=${v}`).join(' · ');
};
console.log('   marques:', count((k) => String(k.company)));
console.log('   pays:', count((k) => String(k.country ?? '-')));
console.log('   logos:', count((k) => String((k.raw as any)?.logo ?? '-').replace(/.*brands-logos\//, '')));
console.log('   dates:', j.filter((k) => k.postedAt).length, '| contrat:', j.filter((k) => k.contract).length, '| apply:', j.filter((k) => (k.raw as any)?.applyUrl).length);
const short = j.filter((k) => (k.description ?? '').length <= 200);
console.log('   desc ≤200:', short.map((k) => `${k.url} (${(k.description ?? '').length})`).join(', ') || 'aucune');
const noLoc = j.filter((k) => !k.location);
console.log('   sans lieu:', noLoc.map((k) => k.url).join(', ') || 'aucune');
const noCountry = j.filter((k) => !k.country);
console.log('   sans pays:', noCountry.map((k) => `${k.url} → "${k.location ?? '-'}"`).join(', ') || 'aucune');
const fallbackBrand = j.filter((k) => k.company === 'Swatch Group');
console.log('   « Swatch Group » (repli):', fallbackBrand.length, fallbackBrand.slice(0, 8).map((k) => `${k.title.slice(0, 40)} [${(k.raw as any)?.legalEntity}]`).join(' | '));
