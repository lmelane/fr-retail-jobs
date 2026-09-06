import { readFileSync, writeFileSync } from 'node:fs';
import { fetchWithRetry } from '../lib/http.js';

/**
 * Audit a5 — sonde réelle de liens : GET sur Job.url via fetchWithRetry (porte
 * par hôte, SSRF, WAF), User-Agent navigateur, 1 tentative (pas de martelage).
 * Lecture seule ; aucune écriture en base.
 * Usage : npx tsx src/discovery/a5-probe.mts <sample.json> <out.json>
 */
type Row = { sourceKey: string; id: string; job_url: string; js_url: string; title: string };
type Verdict = {
  sourceKey: string; id: string; url: string; finalUrl?: string; status?: number;
  klass: string; note?: string; ms: number;
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const EXPIRED = [
  /n['’]est plus disponible/i, /no longer (available|accepting|open|active|exists)/i, /has expired/i, /job expired/i,
  /offre (a )?expir/i, /cette offre n['’]est plus/i, /poste (a été )?pourvu/i, /position has been filled/i,
  /this (job|position|posting|vacancy) (is|has been) (closed|removed|filled)/i, /job (not found|no longer)/i,
  /ne correspond à aucune offre/i, /annonce (est )?(expirée|clôturée|fermée)/i, /vacancy (is )?closed/i,
  /sorry,? (this|the) (job|position)/i, /the job you (are looking for|requested)/i, /stellenanzeige (ist )?nicht mehr/i,
  /esta oferta ya no/i, /questa (offerta|posizione) non è più/i, /offre introuvable/i, /n['’]existe plus/i,
];

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').trim();
}
function titleVisible(body: string, title: string) {
  const b = norm(body);
  const t = norm(title);
  if (!t) return false;
  if (b.includes(t)) return true;
  const words = t.split(' ').filter((w) => w.length > 3);
  if (words.length === 0) return false;
  const hits = words.filter((w) => b.includes(w)).length;
  return hits / words.length >= 0.7;
}
function isListing(finalUrl: string, url: string) {
  try {
    const a = new URL(url); const b = new URL(finalUrl);
    if (a.host !== b.host) return b.pathname.length < 12;
    const idish = /\d{3,}|[A-Z]{2}\d{3,}|_JR\d+|[a-f0-9]{8,}/;
    const hadId = idish.test(a.pathname + a.search);
    const hasId = idish.test(b.pathname + b.search);
    return hadId && !hasId && b.pathname.length < a.pathname.length;
  } catch { return false; }
}
function workdayJson(url: string): string | undefined {
  const m = url.match(/^(https:\/\/([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/job\/(.+)$/);
  if (!m) return undefined;
  return `${m[1]}/wday/cxs/${m[2]}/${m[3]}/job/${m[4]}`;
}

async function probe(row: Row): Promise<Verdict> {
  const started = Date.now();
  const base = { sourceKey: row.sourceKey, id: row.id, url: row.job_url };
  try {
    const wd = workdayJson(row.job_url);
    if (wd) {
      const r = await fetchWithRetry(wd, { headers: { 'user-agent': UA, accept: 'application/json' } }, 1);
      const body = await r.text();
      const ok = /"jobPostingInfo"/.test(body);
      return { ...base, status: r.status, finalUrl: wd, klass: ok ? '200_visible' : '200_no_title', note: 'workday-json', ms: Date.now() - started };
    }
    const r = await fetchWithRetry(row.job_url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } }, 1);
    const body = await r.text();
    const finalUrl = r.url || row.job_url;
    const expired = EXPIRED.find((re) => re.test(body));
    const visible = titleVisible(body, row.title) || /"@type"\s*:\s*"JobPosting"/.test(body);
    if (isListing(finalUrl, row.job_url)) return { ...base, status: r.status, finalUrl, klass: '3xx_liste', ms: Date.now() - started };
    if (expired && !visible) return { ...base, status: r.status, finalUrl, klass: '200_expiree', note: expired.source, ms: Date.now() - started };
    if (visible) return { ...base, status: r.status, finalUrl, klass: '200_visible', note: expired ? `marqueur aussi: ${expired.source}` : undefined, ms: Date.now() - started };
    return { ...base, status: r.status, finalUrl, klass: '200_no_title', note: `len=${body.length}`, ms: Date.now() - started };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const m = msg.match(/HTTP (\d{3})/);
    if (m) {
      const s = Number(m[1]);
      const klass = s === 404 ? '404' : s === 410 ? '410' : [403, 405, 429, 401].includes(s) ? '403_waf' : s >= 500 ? '5xx' : `http_${s}`;
      return { ...base, status: s, klass, ms: Date.now() - started };
    }
    if (/WafChallenge|challenge/i.test(msg)) return { ...base, klass: '403_waf', note: 'waf-challenge', ms: Date.now() - started };
    return { ...base, klass: 'erreur_reseau', note: msg.slice(0, 120), ms: Date.now() - started };
  }
}

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Row[];
const out: Verdict[] = [];
let idx = 0;
const CONC = 12;
async function worker() {
  while (idx < rows.length) {
    const row = rows[idx++];
    const v = await probe(row);
    out.push(v);
    console.error(`${out.length}/${rows.length} ${v.klass} ${v.status ?? ''} ${v.sourceKey} ${v.ms}ms`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
const tally: Record<string, number> = {};
for (const v of out) tally[v.klass] = (tally[v.klass] ?? 0) + 1;
console.log(JSON.stringify(tally));
