import { writeFileSync } from 'node:fs';
import { fetchText } from '../lib/http.js';
import { fetchAtsJobs } from '../ats/index.js';

/**
 * l2 — trois sondes en lecture seule :
 *  - SuccessFactors RMK v2 (Douglas) : `unifiedStandardEmploymentType` présent ? valeurs ?
 *  - LVMH Algolia : `publicationTimestamp` sur les hits vs `postedAt` rendu.
 *  - Taleo TBE (Brown Thomas) : la fiche publie-t-elle une date (JSON-LD `datePosted`) ?
 */
const which = new Set(process.argv.slice(2).length ? process.argv.slice(2) : ['sf', 'lvmh', 'taleo']);

if (which.has('sf')) {
  const t0 = Date.now();
  const r = await fetchAtsJobs('SUCCESSFACTORS' as never, { origin: 'https://jobs.douglas.group', withDescriptions: false });
  const raws = r.jobs.map((j) => j.raw as Record<string, unknown>);
  const dist = new Map<string, number>();
  for (const raw of raws) { const k = JSON.stringify(raw.unifiedStandardEmploymentType ?? null); dist.set(k, (dist.get(k) ?? 0) + 1); }
  console.log(`[sf douglas] ${r.jobs.length} offres | ${Math.round((Date.now() - t0) / 1000)}s | contract rempli avant: ${r.jobs.filter((j) => j.contract).length} | temps: ${r.jobs.filter((j) => j.workingTime).length}`);
  console.log(`  unifiedStandardEmploymentType → ${[...dist.entries()].map(([k, v]) => `${k}:${v}`).join(' ')}`);
  console.log(`  keys raw[0]: ${Object.keys(raws[0] ?? {}).join(',')}`);
  if (raws[0]) writeFileSync('src/ats/adapters/__fixtures__/l2-successfactors-douglas-item.json', JSON.stringify(raws[0], null, 1));
}

if (which.has('lvmh')) {
  const t0 = Date.now();
  const r = await fetchAtsJobs('LVMH_ALGOLIA' as never, { country: null });
  const raws = r.jobs.map((j) => j.raw as Record<string, unknown>);
  const withTs = raws.filter((raw) => raw.publicationTimestamp !== undefined && raw.publicationTimestamp !== null);
  const types = new Map<string, number>();
  for (const raw of withTs) { const k = typeof raw.publicationTimestamp; types.set(k, (types.get(k) ?? 0) + 1); }
  console.log(`[lvmh] ${r.jobs.length} offres (declared ${r.declaredTotal}) | ${Math.round((Date.now() - t0) / 1000)}s | raw.publicationTimestamp présent: ${withTs.length} (${[...types.entries()].map(([k, v]) => `${k}:${v}`).join(' ')}) | postedAt rendu: ${r.jobs.filter((j) => j.postedAt).length} | language rendu: ${r.jobs.filter((j) => j.language).length} | raw.language présent: ${raws.filter((raw) => raw.language).length}`);
  const sample = withTs[0];
  console.log(`  ex: publicationTimestamp=${JSON.stringify(sample?.publicationTimestamp)} language=${JSON.stringify(sample?.language)} keys=${Object.keys(sample ?? {}).join(',')}`);
  const langs = new Map<string, number>();
  for (const raw of raws) { const k = String(raw.language ?? '∅'); langs.set(k, (langs.get(k) ?? 0) + 1); }
  console.log(`  raw.language → ${[...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  if (sample) writeFileSync('src/ats/adapters/__fixtures__/l2-lvmh-hit.json', JSON.stringify({ ...sample, description: String(sample.description ?? '').slice(0, 200), jobResponsabilities: undefined, profile: undefined, additionalInformation: undefined }, null, 1));
}

if (which.has('taleo')) {
  const r = await fetchAtsJobs('TALEO' as never, { origin: 'https://lde.tbe.taleo.net/lde02', org: 'ARNOTTS', cws: [79, 70, 60], withDescriptions: false });
  console.log(`[taleo brown thomas] ${r.jobs.length} offres | postedAt rendu: ${r.jobs.filter((j) => j.postedAt).length}`);
  const job = r.jobs[0];
  if (job) {
    const html = await fetchText(job.url);
    const dates = [...html.matchAll(/"datePosted"\s*:\s*"([^"]+)"|datePosted[^<]{0,80}/gi)].map((m) => m[0].slice(0, 120));
    const ld = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i)?.[1]?.slice(0, 800);
    console.log(`  ${job.url}\n  datePosted occurrences: ${JSON.stringify(dates)}\n  ld+json: ${ld?.replace(/\s+/g, ' ')}`);
    writeFileSync('src/ats/adapters/__fixtures__/l2-taleo-brownthomas-detail.html', html);
  }
}
