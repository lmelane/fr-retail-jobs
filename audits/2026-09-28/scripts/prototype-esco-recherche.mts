/**
 * PROTOTYPE, LECTURE SEULE, SANS BASE (D-475, audit de la conception du lot 2, 28/09/2026) : que devient la
 * classification ou la recherche si l'on importe l'ESCO dans le manifeste ? Écrit par un auditeur, relancé et versionné
 * par l'assistant. Données : `esco-metiers.json` et `echantillon.json` de la preuve du pivot du backend
 * (`scripts/preuve-pivot-metiers-2026-09-28/`, étapes 1 et 2, hors git).
 *
 *   node --expose-gc --import tsx audits/2026-09-28/scripts/prototype-esco-recherche.mts
 */
// Prototype LECTURE SEULE : mesure ce que coûte au résolveur de recherche un manifeste étendu aux métiers ESCO.
// Aucune base, aucun réseau. Lance : node --expose-gc node_modules/.bin/tsx <ce fichier> [split]
import { readFileSync } from 'node:fs';
import { searchConcepts } from '/Users/lmelane/Downloads/catwalks-job-aggregator/apps/api/lib/search-vocabulary.ts';
import { createIntentResolver, searchWords } from '/Users/lmelane/Downloads/catwalks-job-aggregator/apps/api/lib/search-intent.ts';

const manifest = JSON.parse(readFileSync('/Users/lmelane/Downloads/catwalks-job-aggregator/packages/db/data/occupations-v1.json', 'utf8'));
const esco = JSON.parse(readFileSync('/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-backend/scripts/preuve-pivot-metiers-2026-09-28/sortie/esco-metiers.json', 'utf8'));
const SPLIT = process.argv.includes('split');
// Langues du site couvertes par l'ESCO (no -> nb, pt -> pt et pt-BR), comme le plan l'annonce (« 17 langues »).
const MAP: Record<string, string[]> = { fr: ['fr'], en: ['en'], de: ['de'], it: ['it'], nl: ['nl'], es: ['es'], ar: ['ar'], cs: ['cs'], da: ['da'], el: ['el'], hu: ['hu'], pl: ['pl'], pt: ['pt', 'pt-BR'], ro: ['ro'], sv: ['sv'], no: ['nb'] };
const split = (s: string) => SPLIT ? s.split('/').map(x => x.trim()).filter(Boolean) : [s];
const escoOccupations = esco.metiers.map((m: any) => {
  const labels: Record<string, string> = {};
  for (const [l, v] of Object.entries(m.libelles as Record<string, string>)) for (const site of MAP[l] ?? []) labels[site] = v;
  const aliases = [...Object.values(labels).flatMap(split), ...(m.synonymes.en ?? []), ...(m.synonymes.fr ?? [])];
  return { key: 'esco-' + m.code.replace(/\./g, '-'), labels, family: 'x', aliases };
});
const extended = { ...manifest, occupations: [...manifest.occupations, ...escoOccupations] };

const heap = () => { (globalThis as any).gc?.(); return process.memoryUsage().heapUsed; };
function measure(m: any, label: string) {
  const h0 = heap(); const t0 = performance.now();
  const concepts = searchConcepts(m, []);
  const r1 = createIntentResolver(concepts, []);
  const r2 = createIntentResolver(concepts, []); // snapshotModel en construit deux (resolver + nativeResolver)
  const t1 = performance.now(); const h1 = heap();
  const aliases = concepts.reduce((n, c) => n + c.aliases.length, 0);
  console.log(`${label}: concepts=${concepts.length} aliases=${aliases} construction=${Math.round(t1 - t0)} ms tas retenu=${Math.round((h1 - h0) / 1e6)} Mo`);
  return { concepts, r1, r2 };
}
const base = measure(manifest, 'actuel (62 métiers)');
const ext = measure(extended, `étendu ESCO${SPLIT ? ' (libellés masc/fém séparés)' : ''}`);

// Régression de l'interprétation : les alias ACTUELS (métiers et familles) qui ne se résolvent plus en concept.
const cur = searchConcepts(manifest, []);
let before = 0, lost = 0; const exemples: string[] = [];
for (const c of cur) for (const a of c.aliases) {
  const q = searchWords(a).join(' '); if (!q) continue;
  const b = base.r1.resolve(q).clauses; const e = ext.r1.resolve(q).clauses;
  const okB = b.length === 1 && b[0].kind !== 'text' && b[0].keys[0] === c.key;
  const okE = e.length === 1 && e[0].kind !== 'text' && e[0].keys[0] === c.key;
  if (okB) before++;
  if (okB && !okE) { lost++; if (exemples.length < 12) exemples.push(`${a} [${c.key}] -> ${e.map(x => x.kind + ':' + (x.keys[0] ?? x.observed)).join(' + ')}`); }
}
console.log(`alias actuels résolus vers leur concept : ${before} ; perdus après extension : ${lost}`);
console.log(exemples.join('\n'));

// Suggestions : coût du balayage par frappe (suggestions.ts:167) sur « ve ».
for (const [label, m] of [['actuel', base], ['étendu', ext]] as const) {
  const t0 = performance.now(); let n = 0;
  for (let i = 0; i < 20; i++) n = m.concepts.flatMap(c => c.aliases.filter(a => searchWords(a).join(' ').startsWith('ve'))).length;
  console.log(`suggestions ${label} : ${((performance.now() - t0) / 20).toFixed(1)} ms par frappe, ${n} alias candidats`);
}
