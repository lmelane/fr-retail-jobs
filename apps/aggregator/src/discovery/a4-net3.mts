import { fetchWithRetry } from '../lib/http.js';
/** Audit a4 — 3 requêtes : où atterrit le candidat sur un lien LVMH (Lumesse apply-app, Oracle HCM) et variante d'URL Phenom Foot Locker. */
async function grab(name: string, url: string) {
  try {
    const r = await fetchWithRetry(url, {}, 1);
    const t = await r.text();
    const title = t.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
    const forms = (t.match(/<form/gi) ?? []).length;
    const hasLd = /ld\+json/.test(t);
    console.log(`${name}: http=${r.status} final=${r.url} bytes=${t.length} forms=${forms} jsonld=${hasLd} title=${title ?? ''}`);
    return t;
  } catch (e) { console.log(`${name}: ERR ${(e as Error).message.slice(0, 120)}`); return ''; }
}
const lv = await grab('lvmh-emea3-apply-app', 'https://emea3.recruitmentplatform.com/apply-app/pages/application-form?jobId=PYZFK026203F3VBQB798N7VG6-1090114&langCode=en_US');
console.log('  mentions:', ['application-form', 'Create account', 'Sign in', 'password', 'Job description', 'Apply'].map((k) => `${k}=${lv.toLowerCase().includes(k.toLowerCase())}`).join(' '));
await grab('lvmh-oracle-job', 'https://eljs.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/63723');
await grab('footlocker-phenom-slug', 'https://careers.footlocker.com/job/71906/sales-lead');
