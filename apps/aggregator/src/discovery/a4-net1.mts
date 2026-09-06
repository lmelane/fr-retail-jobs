import { fetchWithRetry } from '../lib/http.js';
const S = '/private/tmp/claude-501/-Users-lmelane-Downloads-catwalks-job-aggregator/cb987be9-6318-41c2-be50-828162123854/scratchpad';
async function grab(name: string, url: string) {
  try {
    const r = await fetchWithRetry(url, {}, 1);
    const t = await r.text();
    const title = t.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
    console.log(`${name}: http=${r.status} final=${r.url} bytes=${t.length} title=${title ?? ''}`);
    return t;
  } catch (e) { console.log(`${name}: ERR ${(e as Error).message.slice(0, 120)}`); return ''; }
}
// 1. URL adidas avec &amp; stockée telle quelle
await grab('adidas-amp-url', 'https://jobs.adidas-group.com/job/Jakarta-Manager%2C-Internal-Control-&amp;-Profit-Protection-JK/1419018033/');
// 2. page site d'un titre porteur d'entité HTML
const site = await grab('site-entity-title', 'https://modecareers.com/offre/cmtpivhy3069spf5l8k89jzrt');
const h1 = site.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim();
console.log('  h1 =', h1);
// 3. Kering eightfold search : business_unit / brand des 8 premières offres
const s = await grab('kering-search', 'https://careers.kering.com/api/pcsx/search?domain=kering.com&query=&location=&start=0&num=8');
try { const j = JSON.parse(s); const pos = j.positions ?? j.data?.positions ?? []; for (const p of pos) console.log('  ', p.id, '|', p.name, '|', JSON.stringify(p.standardizedLocations), '|', p.department); } catch (e) { console.log('  parse fail', s.slice(0, 200)); }
