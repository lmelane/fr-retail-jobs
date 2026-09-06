/**
 * a3 — chronométrage par source d'un run ingest-all, à partir d'un fichier de
 * logs Railway au format --json (une ligne JSON par log).
 *
 * L'orchestrateur tourne 4 sources en parallèle : la durée d'une source est
 * l'écart entre SA ligne de départ (`[ingest] 1 API feeds: <clé>` ou
 * `[ingest] 1 sitemap sources: <clé>`) et SA ligne de fin
 * (`[ingest] <clé>: N FR / … fetched -> …`), pas l'écart avec la ligne suivante.
 *
 * Usage : npx tsx src/discovery/a3-runTiming.mts <logs.json> [top]
 * Lecture seule — aucun accès réseau ni base.
 */
import { readFileSync } from 'node:fs';

const [file, topArg] = process.argv.slice(2);
if (!file) {
  console.error('usage: a3-runTiming <railway-logs.json> [top]');
  process.exit(1);
}
const top = Number(topArg ?? 30);

type Row = { t: number; m: string };
const rows: Row[] = readFileSync(file, 'utf8')
  .split('\n')
  .map((line) => {
    try {
      const j = JSON.parse(line) as { timestamp: string; message: string };
      return { t: Date.parse(j.timestamp), m: String(j.message ?? '') };
    } catch {
      return null;
    }
  })
  .filter((r): r is Row => r !== null && Number.isFinite(r.t))
  .sort((a, b) => a.t - b.t);

const start = new Map<string, number>();
const end = new Map<string, number>();
const summary = new Map<string, string>();
const deferred = new Map<string, number>();
const sitemap = new Set<string>();
let orchestratorStart = 0;
let orchestratorDone = 0;
let finalJson = 0;
let lastLine = rows.at(-1)?.t ?? 0;

for (const { t, m } of rows) {
  let x = m.match(/^\[ingest\] \d+ API feeds: (\S+)$/);
  if (x) { start.set(x[1], t); continue; }
  x = m.match(/^\[ingest\] \d+ sitemap sources: (\S+)$/);
  if (x) { start.set(x[1], t); sitemap.add(x[1]); continue; }
  x = m.match(/^\[ingest\] ([\w.-]+): (\d+) FR \/ (\d+) in-sector \/ (\d+) fetched -> (\d+) created, (\d+) merged, (\d+) errors(.*)$/);
  if (x) {
    end.set(x[1], t);
    summary.set(x[1], `${x[4]} fetched, ${x[5]} created, ${x[6]} merged, ${x[7]} errors`);
    const d = x[8].match(/(\d+) deferred/);
    if (d) deferred.set(x[1], Number(d[1]));
    continue;
  }
  if (m.startsWith('[orchestrator] ') && m.includes('sources, each time-bounded')) orchestratorStart = t;
  if (m.startsWith('[orchestrator] done')) orchestratorDone = t;
  if (m.startsWith('  "command": "ingest-all"')) finalJson = t;
}

const durations = [...start.entries()]
  .map(([k, s]) => ({ k, s, e: end.get(k), sec: end.has(k) ? (end.get(k)! - s) / 1000 : NaN }))
  .sort((a, b) => (b.sec || 0) - (a.sec || 0));

const finished = durations.filter((d) => Number.isFinite(d.sec));
const unfinished = durations.filter((d) => !Number.isFinite(d.sec));
const totalSec = finished.reduce((a, d) => a + d.sec, 0);
const fmt = (ms: number) => (ms ? new Date(ms).toISOString().slice(11, 19) : '—');

console.log(`lignes: ${rows.length} | première ${fmt(rows[0]?.t)} dernière ${fmt(lastLine)}`);
console.log(`orchestrateur: départ ${fmt(orchestratorStart)} → done ${fmt(orchestratorDone)} (${orchestratorDone ? ((orchestratorDone - orchestratorStart) / 60000).toFixed(1) : '—'} min)`);
console.log(`après-orchestrateur (geocode+digest+indexing+heartbeat): ${orchestratorDone && finalJson ? ((finalJson - orchestratorDone) / 1000).toFixed(0) + ' s' : '—'}`);
console.log(`sources démarrées ${start.size}, terminées ${finished.length}, non terminées ${unfinished.length}`);
console.log(`somme des durées source (CPU-temps de 4 voies) : ${(totalSec / 60).toFixed(1)} min ; mur ≈ ${orchestratorDone ? ((orchestratorDone - orchestratorStart) / 60000).toFixed(1) : '?'} min`);

const buckets = [[0, 10], [10, 60], [60, 300], [300, 900], [900, Infinity]] as const;
for (const [lo, hi] of buckets) {
  const n = finished.filter((d) => d.sec >= lo && d.sec < hi);
  console.log(`  ${String(lo).padStart(4)}–${hi === Infinity ? '∞' : hi}s : ${String(n.length).padStart(3)} sources, ${(n.reduce((a, d) => a + d.sec, 0) / 60).toFixed(1)} min cumulées`);
}

console.log(`\nTop ${top} (durée source, départ → fin) :`);
for (const d of finished.slice(0, top)) {
  console.log(`  ${(d.sec / 60).toFixed(1).padStart(6)} min  ${fmt(d.s)}→${fmt(d.e!)}  ${d.k.padEnd(32)} ${summary.get(d.k) ?? ''}${sitemap.has(d.k) ? '  [sitemap]' : ''}${deferred.has(d.k) ? `  DEFERRED ${deferred.get(d.k)}` : ''}`);
}
const topSum = finished.slice(0, top).reduce((a, d) => a + d.sec, 0);
console.log(`part des ${top} plus lentes dans la somme : ${Math.round((100 * topSum) / totalSec)} %`);

if (unfinished.length) {
  console.log(`\nDémarrées sans ligne de fin (${unfinished.length}) :`);
  for (const d of unfinished) console.log(`  ${fmt(d.s)}  ${d.k}`);
}
if (deferred.size) {
  console.log(`\nSources arrêtées au budget temps (deferred) :`);
  for (const [k, n] of deferred) console.log(`  ${k}: ${n} pages reportées`);
}

// Critical path: at the end of the run, which sources were still running?
const lastEnd = Math.max(...finished.map((d) => d.e!));
const tail = finished.filter((d) => d.e! > lastEnd - 10 * 60_000).sort((a, b) => b.e! - a.e!);
console.log(`\nSources terminées dans les 10 dernières minutes de l'orchestrateur (chemin critique) :`);
for (const d of tail) console.log(`  fin ${fmt(d.e!)}  ${(d.sec / 60).toFixed(1).padStart(6)} min  ${d.k}`);
