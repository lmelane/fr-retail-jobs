import { fetchAltamiraJobs } from '../ats/adapters/altamira.js';
import { fetchJobylonJobs } from '../ats/adapters/jobylon.js';

/**
 * g1 — rejoue les deux adaptateurs écrits pour le lot (hors dispatch) et
 * imprime la ligne de mesure. Lecture seule.
 *   npx tsx src/discovery/g1-acne.mts acne   → Jobylon, Acne Studios (companyId 2631)
 *   npx tsx src/discovery/g1-acne.mts zegna  → Altamira, Ermenegildo Zegna Group
 */

const which = process.argv[2] ?? 'acne';

const t0 = Date.now();
const result =
  which === 'zegna'
    ? await fetchAltamiraJobs({ origin: 'https://careers.zegnagroup.com' })
    : await fetchJobylonJobs({ companyId: '2631' });
const j = result.jobs;
const withLoc = j.filter((k) => k.location || k.city).length;
const withDesc = j.filter((k) => (k.description ?? '').length > 200).length;
console.log(`${which}: ${j.length} offres | ${withLoc} lieu | ${withDesc} desc | ${Math.round((Date.now() - t0) / 1000)}s | declaredTotal=${result.declaredTotal ?? '-'} truncated=${result.truncated ?? false}`);
if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 60)} @ ${j[0].location ?? j[0].city ?? '-'} | ${j[0].url}`);
const companies = new Map<string, number>();
for (const k of j) companies.set(String(k.company ?? '-'), (companies.get(String(k.company ?? '-')) ?? 0) + 1);
console.log('   sociétés:', [...companies.entries()].map(([n, v]) => `${n}=${v}`).join(', '));
const countries = new Map<string, number>();
for (const k of j) countries.set(String(k.country ?? '-'), (countries.get(String(k.country ?? '-')) ?? 0) + 1);
console.log('   pays:', [...countries.entries()].map(([n, v]) => `${n}=${v}`).join(', '));
console.log('   dates:', j.filter((k) => k.postedAt).length, '| sans lieu:', j.filter((k) => !k.location && !k.city).map((k) => k.title).slice(0, 5).join(' / '));
