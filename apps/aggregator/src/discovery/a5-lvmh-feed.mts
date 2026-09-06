import { fetchLvmhJobs } from '../ats/adapters/lvmhAlgolia.js';

/**
 * Audit a5 — validation D23 par présence dans le feed : les ids LVMH passés en
 * argument (suffixe numérique du jobId `…-1085170`) sont-ils encore listés ?
 * Lecture seule (une lecture du feed Algolia LVMH, comme l'ingest).
 * Usage : npx tsx src/discovery/a5-lvmh-feed.mts 1085170 1092549 …
 */
const wanted = process.argv.slice(2);
const { jobs, declaredTotal } = await fetchLvmhJobs({ country: null });
console.log(`feed: ${jobs.length} offres (déclaré ${declaredTotal ?? '?'})`);
const byUrl = new Map(jobs.map((j) => [j.url, j]));
for (const id of wanted) {
  const hit = jobs.find((j) => j.url.includes(`-${id}&`) || j.url.endsWith(`-${id}`) || j.externalId === id);
  console.log(id, hit ? `PRÉSENT ${hit.title} ${hit.url}` : 'ABSENT');
}
const hosts: Record<string, number> = {};
for (const url of byUrl.keys()) {
  const h = url.match(/^https?:\/\/([^/]+)/)?.[1] ?? '?';
  hosts[h] = (hosts[h] ?? 0) + 1;
}
console.log('hosts:', JSON.stringify(hosts));
