import { fetchWithRetry } from '../lib/http.js';
/** Audit a4 — 2 requêtes : détail Eightfold d'une offre GUCCI (Kering) ; page publique Phenom de Foot Locker. */
async function grab(name: string, url: string) {
  try {
    const r = await fetchWithRetry(url, {}, 1);
    const t = await r.text();
    const title = t.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
    console.log(`${name}: http=${r.status} final=${r.url} bytes=${t.length} title=${title ?? ''}`);
    return t;
  } catch (e) { console.log(`${name}: ERR ${(e as Error).message.slice(0, 120)}`); return ''; }
}
const d = await grab('kering-detail-gucci', 'https://careers.kering.com/api/apply/v2/jobs/563705892604101?domain=kering.com');
try { const j = JSON.parse(d); console.log('  business_unit=', JSON.stringify(j.business_unit), 'brand=', JSON.stringify(j.brand), 'efcustomTextBrand=', JSON.stringify(j.efcustomTextBrand), 'location=', JSON.stringify(j.location), 'custom_JD.data_fields=', JSON.stringify(j.custom_JD?.data_fields)); } catch { console.log('  parse fail', d.slice(0, 200)); }
const p = await grab('footlocker-phenom-page', 'https://careers.footlocker.com/job/71906');
const ld = p.match(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/i)?.[1];
console.log('  jsonld present =', !!ld, ld ? ld.slice(0, 160).replace(/\s+/g, ' ') : '');
