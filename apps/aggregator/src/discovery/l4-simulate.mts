import { readFileSync } from 'node:fs';
import { displayCity } from '../normalize/location.js';
import { normalizeCountry } from '../normalize/country.js';

/**
 * l4 — simulation AVANT → APRÈS de la ville canonique sur l'export prod
 * (`l4-export.mts`), hors base, avec les vraies fonctions de
 * `normalize/location.ts`.
 *
 * « Avant » = `Job.city` tel qu'en base. « Après » = ce que l'écriture
 * produirait : `displayCity(city ?? location)` — le chemin de `cityOf`
 * (upsert.ts:358). Trois lectures : (A) location.ts seul ; (B) avec la garde
 * `!normalizeCountry(city)` de upsert.ts:359, qui efface les cités-États ;
 * (C) si `cityOf` retombait sur `location` quand la ville de l'adaptateur est
 * rejetée — `displayCity(city) ?? displayCity(location)` — le gain à attendre
 * d'une ligne dans upsert.ts.
 *
 * Usage : npx tsx src/discovery/l4-simulate.mts <villes.json>
 */
type Row = { city: string | null; location: string | null; source: string | null; n: number };
const file = process.argv[2];
if (!file) throw new Error('usage: l4-simulate.mts <villes.json>');
const { rows, total, exportedAt } = JSON.parse(readFileSync(file, 'utf8')) as { rows: Row[]; total: number; exportedAt: string };

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

type Tally = Map<string, number>;
const add = (m: Tally, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

const before: Tally = new Map();
const beforeFolded: Tally = new Map();
const afterA: Tally = new Map();
const afterB: Tally = new Map();
const afterC: Tally = new Map();
const gainC: Tally = new Map();
let withAfterC = 0;
const changes: Tally = new Map();
const dropped: Tally = new Map();
const recovered: Tally = new Map();
const droppedBySource: Tally = new Map();
let withBefore = 0;
let withAfterA = 0;
let withAfterB = 0;
let unchanged = 0;
let changed = 0;
let droppedN = 0;
let recoveredN = 0;
let cityStatesLost = 0;

for (const r of rows) {
  const old = r.city?.trim() || undefined;
  const next = displayCity(r.city ?? r.location);
  const guarded = next && !normalizeCountry(next) ? next : undefined;
  const fallback = displayCity(r.city) ?? displayCity(r.location);
  if (fallback) { withAfterC += r.n; add(afterC, fallback, r.n); }
  if (!next && fallback) add(gainC, `${r.city ?? '∅'} | ${r.location ?? '∅'} → ${fallback}`, r.n);
  if (old) { withBefore += r.n; add(before, old, r.n); add(beforeFolded, fold(old), r.n); }
  if (next) { withAfterA += r.n; add(afterA, next, r.n); }
  if (guarded) { withAfterB += r.n; add(afterB, guarded, r.n); }
  if (next && !guarded) cityStatesLost += r.n;
  if (old && next) {
    if (old === next) unchanged += r.n;
    else { changed += r.n; add(changes, `${old} → ${next}`, r.n); }
  } else if (old && !next) {
    droppedN += r.n; add(dropped, `${old}  [${r.source ?? '?'}]`, r.n); add(droppedBySource, r.source ?? '?', r.n);
  } else if (!old && next) {
    recoveredN += r.n; add(recovered, `${r.location ?? ''} → ${next}`, r.n);
  }
}

const top = (m: Tally, k = 30) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
const show = (title: string, m: Tally, k = 30) => {
  console.log(`\n## ${title}`);
  for (const [key, n] of top(m, k)) console.log(`${String(n).padStart(6)}  ${key}`);
};

console.log(`export ${exportedAt} — ${total} offres actives, ${rows.length} couples (ville, lieu, source)`);
console.log(`\n## Totaux`);
console.log(`avec ville      : avant ${withBefore} | après (A) ${withAfterA} | après (B, garde upsert) ${withAfterB} | après (C, repli location) ${withAfterC}`);
console.log(`villes distinctes: avant ${before.size} (${beforeFolded.size} en pliant casse/accents) | après (A) ${afterA.size} | après (B) ${afterB.size} | après (C) ${afterC.size}`);
console.log(`inchangées ${unchanged} | renommées ${changed} | perdues ${droppedN} | récupérées depuis location ${recoveredN}`);
console.log(`cités-États effacées par la garde upsert.ts:359 : ${cityStatesLost}`);

show('Top 30 avant', before);
show('Top 30 après (A)', afterA);
show('Top 60 renommages (avant → après)', changes, 60);
show('Top 60 villes perdues (→ undefined), par source', dropped, 60);
show('Villes perdues par source', droppedBySource, 25);
show('Top 30 récupérées depuis location', recovered);
show('Top 40 gains (C) : ville rejetée, location exploitable', gainC, 40);

// Valeurs « après » suspectes : chiffres, mots de magasin, codes, trop courtes, ou un pays.
const SUSPECT = /\d|\b(store|mall|outlet|retail|office|hq|center|centre|area|region|province|corporate|remote|shop)\b|^.{0,2}$|^[A-Z]{3}$/i;
const suspects: Tally = new Map();
for (const [city, n] of afterA) if (SUSPECT.test(city) || normalizeCountry(city)) add(suspects, city, n);
show('Après (A) : valeurs suspectes', suspects, 60);

// Détail par source : avant → après, pour vérifier une famille (ex. saks, levis, deckers).
const only = process.argv[3];
if (only) {
  const detail: Tally = new Map();
  for (const r of rows) if (r.source === only) add(detail, `${r.city ?? '∅'} → ${displayCity(r.city ?? r.location) ?? '∅'}`, r.n);
  show(`Source ${only} : avant → après`, detail, 80);
}
