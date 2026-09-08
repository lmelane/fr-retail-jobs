import { writeFileSync } from 'node:fs';
import { fetchJson } from '../lib/http.js';

/**
 * l2 — Eightfold : forme réelle de `standardizedLocations` (ELC, Kering) sur la
 * recherche, et le détail d'une position (business_unit, assignmentcat…).
 * Lecture seule ; fixtures tronquées.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const tenants = [
  { key: 'elc', origin: 'https://careers.elcompanies.com', domain: 'elcompanies.com' },
  { key: 'kering', origin: 'https://careers.kering.com', domain: 'kering.com' },
];
for (const t of tenants) {
  const headers = { 'user-agent': UA, accept: 'application/json', referer: `${t.origin}/careers` };
  const search = await fetchJson<{ data?: { positions?: Array<Record<string, unknown>>; count?: number } }>(
    `${t.origin}/api/pcsx/search?domain=${t.domain}&query=&location=&start=0&num=10`,
    { headers },
  );
  const positions = search.data?.positions ?? [];
  console.log(`\n[${t.key}] count=${search.data?.count} page0=${positions.length}`);
  for (const p of positions.slice(0, 3)) {
    console.log(`  id=${p.id} name=${String(p.name).slice(0, 50)} locations=${JSON.stringify(p.locations)} standardizedLocations=${JSON.stringify(p.standardizedLocations)} keys=${Object.keys(p).join(',')}`);
  }
  writeFileSync(`src/ats/adapters/__fixtures__/l2-eightfold-${t.key}-search.json`, JSON.stringify({ data: { count: search.data?.count, positions: positions.slice(0, 3) } }, null, 1));

  const id = positions[0]?.id;
  const detail = await fetchJson<{ data?: Record<string, unknown> }>(
    `${t.origin}/api/pcsx/position_details?position_id=${id}&domain=${t.domain}&hl=fr`,
    { headers },
  );
  const d = detail.data ?? {};
  const custom = (d.custom_JD as { data_fields?: Record<string, unknown> } | undefined)?.data_fields;
  console.log(`  detail keys=${Object.keys(d).join(',')}`);
  console.log(`  business_unit=${JSON.stringify(d.business_unit)} brand=${JSON.stringify(d.brand)} efcustomTextBrand=${JSON.stringify(d.efcustomTextBrand)} department=${JSON.stringify(d.department)}`);
  console.log(`  custom_JD.data_fields=${JSON.stringify(custom)?.slice(0, 600)}`);
  const trimmed = { ...d, jobDescription: String(d.jobDescription ?? '').slice(0, 300), job_description: undefined };
  writeFileSync(`src/ats/adapters/__fixtures__/l2-eightfold-${t.key}-detail.json`, JSON.stringify({ data: trimmed }, null, 1));
}
