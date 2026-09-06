import { fetchJson } from '../lib/http.js';

/**
 * Fenwick — plateforme Volcanic (careers.fenwick.co.uk). Pas de JSON-LD sur
 * les pages détail, mais une API JSON publique : /api/v1/jobs.json.
 * On mesure : total, pagination, champs utiles, description.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const headers = { 'user-agent': UA };

type Page = { jobs: any[]; total_count: number; page_count: number; current_page: number };

const all: any[] = [];
let page = 1;
let meta: Page | undefined;
for (;;) {
  const r = await fetchJson<Page>(`https://www.careers.fenwick.co.uk/api/v1/jobs.json?page=${page}`, { headers });
  meta = r;
  all.push(...r.jobs);
  console.log(`page ${page}: ${r.jobs.length} jobs ; total_count ${r.total_count} ; page_count ${r.page_count} ; current_page ${r.current_page}`);
  if (r.jobs.length === 0 || page >= r.page_count) break;
  page += 1;
}

const j = all[0];
console.log(`\nchamps: ${Object.keys(j).join(',')}`);
console.log(`ex brut: ${JSON.stringify(j).slice(0, 1500)}`);

const ids = new Set(all.map((x) => x.id));
const withLoc = all.filter((x) => x.location || x.job_location || x.locations?.length || x.city).length;
const withDesc = all.filter((x) => String(x.description ?? x.job_description ?? x.summary ?? '').length > 200).length;
console.log(`\n${ids.size} offres uniques | ${withLoc} lieu | ${withDesc} desc>200 | date: ${all.filter((x) => x.published_at ?? x.posted_at ?? x.created_at ?? x.publish_date).length}`);
console.log(`ex: ${j.title} @ ${j.location ?? j.job_location ?? JSON.stringify(j.locations)?.slice(0, 80)} — ${j.url ?? j.job_url ?? j.path}`);
console.log(`dates: start_date=${j.start_date} end_date=${j.end_date} ; cached_slug=${j.cached_slug} ; job_location=${JSON.stringify(j.job_location)} ; summary=${String(j.summary).slice(0, 80)} ; clean_description len=${String(j.clean_description).length}`);
console.log(`start_date renseignée: ${all.filter((x) => x.start_date).length}/${all.length} ; job_location string: ${all.filter((x) => typeof x.job_location === 'string' && x.job_location).length}`);
console.log(`lieux: ${[...new Set(all.map((x) => x.job_location))].join(' | ')}`);
