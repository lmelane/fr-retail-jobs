import { fetchText } from '../lib/http.js';
import { fetchAtsJobs } from '../ats/index.js';
import { parseAvaturePortalDetail } from '../ats/adapters/avature.js';

/**
 * l2 — deux vérifications après mesure (lecture seule) :
 *  - Ulta/Jibe : quels tags les entrées portent réellement (l'audit a1 disait tags2 = « Regular »).
 *  - L'Oréal/Avature : les offres sans date après correctif — la fiche porte-t-elle un datePosted ?
 */
const which = process.argv[2] ?? 'ulta';

if (which === 'ulta') {
  const r = await fetchAtsJobs('JIBE' as never, { origin: 'https://careers.ulta.com' });
  const dist = new Map<string, number>();
  for (const j of r.jobs) {
    const raw = j.raw as Record<string, unknown>;
    const keys = Object.entries(raw).filter(([k]) => /^tags\d+$/.test(k)).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    dist.set(keys, (dist.get(keys) ?? 0) + 1);
  }
  console.log(`ulta ${r.jobs.length} offres ; combinaisons de tags (top 12) :`);
  for (const [k, v] of [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${v}\t${k.slice(0, 200)}`);
}

if (which === 'loreal') {
  const r = await fetchAtsJobs('AVATURE' as never, {
    listingUrl: 'https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0',
    origin: 'https://careers.loreal.com',
    maxPages: 6,
    withDescriptions: false,
  });
  const undated = r.jobs.filter((j) => !j.postedAt);
  console.log(`loreal liste 6 pages : ${r.jobs.length} offres, ${undated.length} sans date en liste`);
  for (const job of undated.slice(0, 3)) {
    const html = await fetchText(job.url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' } });
    const detail = parseAvaturePortalDetail(html);
    const ld = html.match(/"datePosted"\s*:\s*"([^"]+)"/i)?.[1];
    console.log(`  ${job.url}\n    html=${html.length} o | datePosted brut=${ld ?? '∅'} | parsé=${detail.postedAt?.toISOString().slice(0, 10) ?? '∅'} | desc=${detail.description?.length ?? 0} c.`);
  }
}
