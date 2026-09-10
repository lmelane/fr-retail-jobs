/**
 * Technical qualification of the ATS candidates found by the research passes — read-only, resumable.
 *
 * For every candidate (type + config detected on an official or candidate page), dedup by tenant key,
 * mark the tenants already catalogued, then run the REAL adapter once (listing only where the adapter
 * supports it) to measure: postings, enumeration proof, native employer labels, countries, sample titles.
 * Nothing is registered, promoted or written to the database: identity (employer ↔ tenant) stays a
 * reviewed decision; this pass answers "can we read this portal, and what does it say about itself?".
 *
 * Usage: qualify-candidates.mts snapshot.json output-dir research-dir [research-dir…]
 * State: output-dir/candidates.jsonl (one line per tenant, appended as it goes; existing tenants are skipped).
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import pLimit from 'p-limit';
import { KIND_TO_ATS } from '../../src/ats/catalogKinds.js';
import { fetchAtsJobs } from '../../src/ats/index.js';
import { tenantKeyOf } from '../../src/connectors/sourceStore.js';
import { closeBrowser } from '../../src/lib/browser.js';
import type { AtsType } from '@prisma/client';

const [snapshotPath, outDir, ...researchDirs] = process.argv.slice(2);
if (!snapshotPath || !outDir || !researchDirs.length) throw Error('snapshot.json output-dir research-dir…');
mkdirSync(outDir, { recursive: true });
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const catalogued = new Map<string, { key: string; status: string }>(snapshot.sources.map((s: any) => [s.tenantKey, { key: s.key, status: s.status }]));
const ATS_TO_KIND = new Map(Object.entries(KIND_TO_ATS).map(([kind, ats]) => [ats, kind]));
const statePath = `${outDir}/candidates.jsonl`;
const done = new Set(existsSync(statePath) ? readFileSync(statePath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).tenantKey) : []);

type Candidate = { tenantKey: string; type: string; kind: string; config: Record<string, unknown>; careersUrl: string; actors: Set<string>; labels: Set<string>; proofs: { url: string; sha256: string; at?: string; pass: string }[]; confidence: number };
const candidates = new Map<string, Candidate>();
let raw = 0, generic = 0, unsupported = 0, badTenant = 0;
for (const dir of researchDirs) {
  const file = `${dir}/research.jsonl`; if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue; const r = JSON.parse(line);
    for (const page of r.pages ?? []) for (const c of page.atsCandidates ?? []) {
      raw++;
      if (c.type === 'GENERIC_JSONLD') { generic++; continue; }
      const kind = ATS_TO_KIND.get(c.type); if (!kind || !c.config || !Object.keys(c.config).length) { unsupported++; continue; }
      let host = ''; try { host = new URL(c.careersUrl).hostname; } catch { /* ignore */ }
      // A vendor's own application/marketing host, a sandbox, or a placeholder account is not a tenant.
      const cfgText = JSON.stringify(c.config).toLowerCase();
      if (/(^|\/\/)(app|www|tt|auth)\.teamtailor\.com|sandbox|"account":"j"|\/\/(www\.)?(smartrecruiters|lever|greenhouse|workable|recruitee|personio|pinpointhq)\.(com|co|io|de)\/?"/.test(cfgText)) { unsupported++; continue; }
      let tenantKey: string; try { tenantKey = tenantKeyOf(kind, JSON.stringify(c.config), host, r.name); } catch { badTenant++; continue; }
      const entry: Candidate = candidates.get(tenantKey) ?? { tenantKey, type: c.type, kind, config: c.config, careersUrl: c.careersUrl, actors: new Set(), labels: new Set(), proofs: [], confidence: c.confidence ?? 0 };
      entry.actors.add(r.id); entry.labels.add(r.name); entry.proofs.push({ url: page.url, sha256: page.sha256, at: page.at, pass: dir.split('/').pop()! });
      entry.confidence = Math.max(entry.confidence, c.confidence ?? 0);
      candidates.set(tenantKey, entry);
    }
  }
}
const list = [...candidates.values()];
const summary: any = { at: new Date().toISOString(), rawCandidates: raw, genericSkipped: generic, unsupportedOrNoConfig: unsupported, invalidTenant: badTenant, distinctTenants: list.length,
  alreadyCatalogued: list.filter(c => catalogued.has(c.tenantKey)).length, alreadyDone: list.filter(c => done.has(c.tenantKey)).length, byType: {} as Record<string, number> };
for (const c of list) summary.byType[c.type] = (summary.byType[c.type] ?? 0) + 1;
console.log(JSON.stringify(summary));

const limit = pLimit(2);
const timeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(Error(`TIMEOUT ${ms}ms`)), ms))]);
let probed = 0, failed = 0, withPostings = 0;
try {
  await Promise.all(list.map(c => limit(async () => {
    if (done.has(c.tenantKey)) return;
    const base = { tenantKey: c.tenantKey, type: c.type, kind: c.kind, config: c.config, careersUrl: c.careersUrl, actors: [...c.actors], labels: [...c.labels].slice(0, 8), proofs: c.proofs.slice(0, 5), confidence: c.confidence, at: new Date().toISOString() };
    const known = catalogued.get(c.tenantKey);
    if (known) { appendFileSync(statePath, JSON.stringify({ ...base, verdict: 'ALREADY_CATALOGUED', source: known }) + '\n'); return; }
    const t0 = Date.now();
    try {
      const result = await timeout(fetchAtsJobs(c.type as AtsType, { ...c.config, withDescriptions: false, detailConcurrency: 1 }), 180_000);
      const employers = new Map<string, number>(); const countries = new Map<string, number>();
      for (const j of result.jobs) { if (j.company) employers.set(j.company, (employers.get(j.company) ?? 0) + 1); if (j.country) countries.set(j.country, (countries.get(j.country) ?? 0) + 1); }
      const record = { ...base, verdict: result.jobs.length ? 'READABLE_WITH_POSTINGS' : 'READABLE_EMPTY', seconds: Math.round((Date.now() - t0) / 1000), postings: result.jobs.length, declaredTotal: result.declaredTotal ?? null, complete: result.complete ?? null, truncated: result.truncated ?? null,
        enumeration: result.enumeration ? { method: result.enumeration.method, pages: result.enumeration.pages, termination: result.enumeration.termination, issues: result.enumeration.issues } : null, rejectedRows: result.rejectedRows?.length ?? 0,
        employers: [...employers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10), countries: [...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10), sampleTitles: result.jobs.slice(0, 5).map(j => j.title), withDescription: result.jobs.filter(j => j.description).length, withDate: result.jobs.filter(j => j.postedAt).length };
      appendFileSync(statePath, JSON.stringify(record) + '\n'); probed++; if (result.jobs.length) withPostings++;
    } catch (e) {
      appendFileSync(statePath, JSON.stringify({ ...base, verdict: 'PROBE_FAILED', seconds: Math.round((Date.now() - t0) / 1000), error: String(e).slice(0, 300) }) + '\n'); failed++;
    }
    if ((probed + failed) % 10 === 0) console.log(JSON.stringify({ probed, failed, withPostings, remaining: list.length - done.size - summary.alreadyCatalogued - probed - failed }));
  })));
} finally { await closeBrowser(); }
const rows = readFileSync(statePath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const final = { ...summary, finishedAt: new Date().toISOString(), probedNow: probed, failedNow: failed, verdicts: rows.reduce((m: any, r) => (m[r.verdict] = (m[r.verdict] ?? 0) + 1, m), {}), postingsTotal: rows.reduce((n, r) => n + (r.postings ?? 0), 0) };
writeFileSync(`${outDir}/summary.json`, JSON.stringify(final, null, 1)); console.log(JSON.stringify(final));
