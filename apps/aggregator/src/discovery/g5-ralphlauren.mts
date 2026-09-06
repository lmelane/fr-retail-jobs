import { fetchAtsJobs } from '../ats/index.js';

/**
 * g5 — mesure du mode « portail » de l'adaptateur Avature sur Ralph Lauren
 * (careers.ralphlauren.com, portail Avature 47 derrière AWS WAF — le challenge
 * est levé par le transport commun, `fetchWithRetry` + `primeWafToken`).
 *
 * Lecture seule. `npx tsx src/discovery/g5-ralphlauren.mts [--no-desc] [--lists a,b]`
 */

const NO_DESC = process.argv.includes('--no-desc');
const listsArg = process.argv.indexOf('--lists');
const LISTS =
  listsArg > 0
    ? process.argv[listsArg + 1].split(',')
    : [
        'en_US/CareersCorporate/SearchJobsCorporate',
        'en_US/CareersCorporate/SearchJobsRetail',
        'en_US/CareersCorporate/SearchJobsNorthCarolinaCampus',
      ];

const config = { origin: 'https://careers.ralphlauren.com', lists: LISTS, withDescriptions: !NO_DESC };

const t0 = Date.now();
const r = await fetchAtsJobs('AVATURE' as never, config as never);
const j = Array.isArray(r) ? r : (r as { jobs: Array<Record<string, unknown>> }).jobs ?? [];
const declared = Array.isArray(r) ? undefined : (r as { declaredTotal?: number }).declaredTotal;
const seconds = Math.round((Date.now() - t0) / 1000);
console.log(
  `Ralph Lauren (${LISTS.length} listes): ${j.length} offres (annoncé ${declared ?? '-'}) | ${j.filter((k) => k.location || k.city).length} lieu | ${
    j.filter((k) => String(k.description ?? '').length > 200).length
  } desc>200 | ${j.filter((k) => k.city).length} ville | ${j.filter((k) => k.country).length} pays | ${j.filter((k) => k.postedAt).length} date | ${seconds}s`,
);
const countries = new Map<string, number>();
for (const k of j) countries.set(String(k.country ?? '?'), (countries.get(String(k.country ?? '?')) ?? 0) + 1);
console.log(`   pays: ${[...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, n]) => `${c}=${n}`).join(' ')}`);
const lists = new Map<string, number>();
for (const k of j) {
  const route = String(k.url).match(/JobDetail([A-Za-z]*)\?/)?.[1] ?? '?';
  lists.set(route, (lists.get(route) ?? 0) + 1);
}
console.log(`   par liste: ${[...lists.entries()].map(([c, n]) => `${c}=${n}`).join(' ')}`);
if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 60)} @ ${j[0].location ?? j[0].city ?? '-'} — ${j[0].url}`);
const fr = j.find((k) => k.country === 'France');
if (fr) console.log(`   ex FR: ${fr.title} @ ${fr.location} — desc ${String(fr.description ?? '').length} car.`);
