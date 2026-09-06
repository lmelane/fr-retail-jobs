import { fetchText } from '../lib/http.js';

/**
 * Boots — WordPress, recherche via admin-ajax.php (action=boots_job_search).
 * Le nonce est public (action=get_dynamic_nonces). On rejoue l'appel du
 * navigateur et on regarde la forme de la réponse et la pagination.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const AJAX = 'https://www.boots.jobs/wp-admin/admin-ajax.php';
const headers = { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', referer: 'https://www.boots.jobs/search-jobs?jobfeed=external' };

const nonces = JSON.parse(await fetchText(AJAX, { method: 'POST', headers, body: 'action=get_dynamic_nonces' }));
const nonce = nonces.data.jobs_nonce;
console.log(`nonce: ${nonce}`);

async function search(page: number, perPage: number) {
  const data = { jobfeed: 'external', search_text: '', location: '', show: String(perPage), show_job_alert_card: '0', sort_by: '', store_last_search: true, page: String(page), per_page: String(perPage) };
  const body = `action=boots_job_search&nonce=${nonce}&data=${encodeURIComponent(JSON.stringify(data))}`;
  const text = await fetchText(AJAX, { method: 'POST', headers, body });
  try {
    return { json: JSON.parse(text), size: text.length };
  } catch {
    return { json: null, size: text.length, raw: text.slice(0, 300) };
  }
}

const r1 = await search(0, 24);
console.log(`\npage0/24: ${r1.size}o ; ${r1.raw ?? ''}`);
if (r1.json) {
  const j = r1.json;
  console.log(`  keys: ${Object.keys(j).join(',')} ; data keys: ${j.data ? Object.keys(j.data).join(',') : '-'}`);
  const d = j.data ?? j;
  const list = d.jobs ?? d.results ?? d.items ?? (Array.isArray(d) ? d : null);
  console.log(`  total: ${d.total ?? d.total_jobs ?? d.count ?? d.found} ; liste: ${Array.isArray(list) ? list.length : typeof list}`);
  if (Array.isArray(list) && list[0]) console.log(`  ex: ${JSON.stringify(list[0]).slice(0, 700)}`);
  else if (typeof d.html === 'string') console.log(`  html ${d.html.length}o ; liens: ${(d.html.match(/href="[^"]*\/jobs\/[^"]+"/g) ?? []).length} ; ex ${d.html.match(/href="([^"]*\/jobs\/[^"]+)"/)?.[1]}`);
  else console.log(`  brut: ${JSON.stringify(d).slice(0, 600)}`);
}

const r2 = await search(0, 200);
if (r2.json) {
  const d = r2.json.data ?? r2.json;
  const list = d.jobs ?? d.results ?? d.items;
  console.log(`\npage0/200: ${r2.size}o ; total ${d.total ?? d.total_jobs ?? d.count ?? d.found} ; liste ${Array.isArray(list) ? list.length : typeof list} ; html liens ${typeof d.html === 'string' ? (d.html.match(/href="[^"]*\/jobs\/[^"]+"/g) ?? []).length : '-'}`);
}
const r3 = await search(1, 24);
if (r3.json) {
  const d = r3.json.data ?? r3.json;
  const list = d.jobs ?? d.results ?? d.items;
  console.log(`page1/24: ${r3.size}o ; liste ${Array.isArray(list) ? list.length : typeof list} ; first ${Array.isArray(list) && list[0] ? JSON.stringify(list[0]).slice(0, 120) : (typeof d.html === 'string' ? d.html.match(/href="([^"]*\/jobs\/[^"]+)"/)?.[1] : '-')}`);
}
