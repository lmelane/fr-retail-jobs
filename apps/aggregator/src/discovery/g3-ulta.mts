import { fetchWithRetry, fetchText } from '../lib/http.js';

/**
 * Ulta — portail Jibe (careers.ulta.com) devant iCIMS. Le navigateur obtient
 * 540 Ko sur /api/jobs ; Node obtient `jobs: []`. Hypothèse : cookie de session
 * Jibe (jasession/jrasession) posé par la page. On rejoue avec le cookie.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAGE = 'https://careers.ulta.com/careers/jobs?keywords=&location=';

const first = await fetchWithRetry(PAGE, { headers: { 'user-agent': UA } });
const setCookies = first.headers.getSetCookie?.() ?? [];
const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
console.log(`page: ${first.status} ; set-cookie: ${setCookies.map((c) => c.split('=')[0]).join(',')}`);
await first.text();

const headers = {
  'user-agent': UA,
  accept: 'application/json, text/plain, */*',
  referer: PAGE,
  ...(cookie ? { cookie } : {}),
};

async function api(params: string) {
  const url = `https://careers.ulta.com/api/jobs?${params}`;
  let body: string;
  try {
    body = await fetchText(url, { headers });
  } catch (e) {
    return { url, total: -1, n: 0, first: undefined, size: 0, raw: (e as Error).message.slice(0, 80) };
  }
  try {
    const j = JSON.parse(body);
    return { url, total: j.totalCount, n: j.jobs?.length ?? 0, first: j.jobs?.[0]?.data, size: body.length };
  } catch {
    return { url, total: -1, n: 0, first: undefined, size: body.length, raw: body.slice(0, 200) };
  }
}

for (const params of [
  'keywords=&location=&page=1&sortBy=relevance&descending=false&internal=false',
  'page=2&sortBy=relevance&descending=false&internal=false',
  'page=1&limit=100&sortBy=relevance&descending=false&internal=false',
  'page=1&limit=500&internal=false',
]) {
  const r = await api(params);
  console.log(`\n${r.url}\n  total ${r.total} ; jobs ${r.n} ; ${r.size}o ${r.raw ?? ''}`);
  if (r.first) {
    const d = r.first;
    console.log(`  keys: ${Object.keys(d).join(',')}`);
    console.log(`  ex: ${d.req_id} | ${d.title} | ${d.city}, ${d.state}, ${d.country_code ?? d.country} | ${d.posted_date ?? d.create_date} | ${d.apply_url ?? d.meta_data?.canonical_url} | desc ${String(d.description ?? '').length}`);
  }
}

// Sous-portail iCIMS : que rend-il réellement sans session ?
for (const origin of ['https://fdcnmcareers-ulta.icims.com', 'https://cdcmcareers-ulta.icims.com']) {
  const url = `${origin}/jobs/search?ss=1&in_iframe=1&pr=0`;
  try {
    const r = await fetchWithRetry(url, { headers: { 'user-agent': UA } });
    const html = await r.text();
    console.log(`\n${url}: ${r.status} ${html.length}o ; title ${html.match(/<title>([^<]*)/)?.[1]?.trim().slice(0, 80)} ; cards ${(html.match(/iCIMS_JobCardItem/g) ?? []).length} ; login ${/login/i.test(html)}`);
  } catch (e) {
    console.log(`\n${url}: KO ${(e as Error).message.slice(0, 120)}`);
  }
}
