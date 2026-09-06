/**
 * Chronomètre chaque source d'un run à partir des logs Railway.
 * Usage : npx tsx src/discovery/runTiming.mts 2026-09-06T00:00:00Z 2026-09-06T03:35:00Z
 * La CLI plafonne à ~500 lignes par appel : on découpe en tranches de 45 min.
 */
import { execFileSync } from 'node:child_process';
const [from, to] = process.argv.slice(2);
if (!from || !to) { console.error('usage: runTiming <since ISO> <until ISO>'); process.exit(1); }
const lines: string[] = [];
for (let t = Date.parse(from); t < Date.parse(to); t += 45 * 60_000) {
  const a = new Date(t).toISOString(), b = new Date(Math.min(t + 45 * 60_000, Date.parse(to))).toISOString();
  try { lines.push(execFileSync('railway', ['logs','--service','catwalks-aggregator','--since',a,'--until',b,'--filter','API feeds','--lines','5000','--json'], { encoding: 'utf8', timeout: 120_000 })); } catch {}
}
const L = lines.join('\n').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  .map((l: any) => ({ t: Date.parse(l.timestamp), k: (String(l.message).match(/feeds: (\S+)/) || [])[1] })).filter((l) => l.t && l.k).sort((a, b) => a.t - b.t);
const dur: Array<{ k: string; s: number }> = [];
for (let i = 1; i < L.length; i++) dur.push({ k: L[i - 1].k, s: (L[i].t - L[i - 1].t) / 1000 });
dur.sort((a, b) => b.s - a.s);
const tot = dur.reduce((a, b) => a + b.s, 0);
console.log(`sources: ${dur.length} | couvert: ${Math.round(tot / 60)} min`);
for (const d of dur.slice(0, 20)) console.log(`  ${(d.s / 60).toFixed(1).padStart(6)} min  ${d.k}`);
console.log(`part des 20 plus lentes : ${Math.round((100 * dur.slice(0, 20).reduce((a, b) => a + b.s, 0)) / tot)}%`);
