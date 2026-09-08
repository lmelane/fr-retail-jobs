import { writeFileSync } from 'node:fs';
import { fetchJson } from '../lib/http.js';

/**
 * l2 — SmartRecruiters : distribution de `typeOfEmployment.{id,label}` et de
 * `language.code` sur les listings (une page de 100 par société). Lecture seule.
 */
const companies = process.argv.slice(2).length ? process.argv.slice(2) : ['primark', 'HMGroup', 'hmgroup', 'H&MGroup'];
for (const company of companies) {
  try {
    const page = await fetchJson<{ content?: Array<Record<string, unknown>>; totalFound?: number }>(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100&offset=0`,
    );
    const rows = page.content ?? [];
    const count = (f: (r: Record<string, unknown>) => string | undefined) => {
      const m = new Map<string, number>();
      for (const r of rows) { const k = f(r) ?? '∅'; m.set(k, (m.get(k) ?? 0) + 1); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
    };
    const toe = (r: Record<string, unknown>) => r.typeOfEmployment as { id?: string; label?: string } | undefined;
    console.log(`\n[${company}] totalFound=${page.totalFound} page=${rows.length}`);
    console.log(`  typeOfEmployment.id    → ${count((r) => toe(r)?.id)}`);
    console.log(`  typeOfEmployment.label → ${count((r) => toe(r)?.label)}`);
    console.log(`  language.code          → ${count((r) => (r.language as { code?: string } | undefined)?.code)}`);
    console.log(`  department.label       → ${count((r) => (r.department as { label?: string } | undefined)?.label)}`);
    console.log(`  keys: ${Object.keys(rows[0] ?? {}).join(',')}`);
    if (rows[0]) writeFileSync(`src/ats/adapters/__fixtures__/l2-smartrecruiters-${company.toLowerCase().replace(/[^a-z]/g, '')}-posting.json`, JSON.stringify(rows[0], null, 1));
  } catch (error) {
    console.log(`\n[${company}] ERREUR ${(error as Error).message.slice(0, 120)}`);
  }
}
