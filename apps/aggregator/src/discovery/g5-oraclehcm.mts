import { fetchOracleHcmJobs } from '../ats/adapters/oraclehcm.js';

/**
 * g5 — mesure de l'adaptateur Oracle HCM sur les deux tenants du lot.
 * Lecture seule. `npx tsx src/discovery/g5-oraclehcm.mts [--no-desc]`
 */

const NO_DESC = process.argv.includes('--no-desc');

const TENANTS = [
  { name: "Bloomingdale's", config: { origin: 'https://ebwh.fa.us2.oraclecloud.com', siteNumber: 'CX_1002' } },
  { name: 'Tiffany & Co.', config: { origin: 'https://eljs.fa.us2.oraclecloud.com', siteNumber: 'CX' } },
];

for (const tenant of TENANTS) {
  const t0 = Date.now();
  const r = await fetchOracleHcmJobs({ ...tenant.config, withDescriptions: !NO_DESC });
  const j = r.jobs;
  const seconds = Math.round((Date.now() - t0) / 1000);
  console.log(
    `${tenant.name}: ${j.length} offres (total annoncé ${r.declaredTotal ?? '-'}) | ${j.filter((k) => k.location || k.city).length} lieu | ${
      j.filter((k) => (k.description ?? '').length > 200).length
    } desc>200 | ${j.filter((k) => k.postedAt).length} date | ${j.filter((k) => k.latitude).length} coords | ${seconds}s`,
  );
  const countries = new Map<string, number>();
  for (const k of j) countries.set(k.country ?? '?', (countries.get(k.country ?? '?') ?? 0) + 1);
  console.log(`   pays: ${[...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c}=${n}`).join(' ')}`);
  if (j[0]) console.log(`   ex: ${String(j[0].title).slice(0, 60)} @ ${j[0].location ?? j[0].city ?? '-'} — ${j[0].url}`);
  const fr = j.find((k) => k.country === 'FR');
  if (fr) console.log(`   ex FR: ${fr.title} @ ${fr.location} — desc ${(fr.description ?? '').length} car.`);
}
