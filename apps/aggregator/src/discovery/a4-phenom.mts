import { fetchJson } from '../lib/http.js';
/** Audit a4 — lecture seule : les champs que l'API Phenom de Foot Locker publie réellement (2 offres). */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const data = await fetchJson<{ jobs?: Array<{ data?: Record<string, unknown> }>; totalCount?: number }>(
  'https://careers.footlocker.com/api/jobs?limit=2&page=1',
  { headers: { 'user-agent': UA, accept: 'application/json' } },
);
console.log('totalCount', data.totalCount);
for (const entry of data.jobs ?? []) {
  const d = entry.data ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) out[k] = typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : v;
  console.log(JSON.stringify(out, null, 1));
}
