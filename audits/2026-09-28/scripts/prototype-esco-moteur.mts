/**
 * PROTOTYPE, LECTURE SEULE, SANS BASE (D-475, audit de la conception du lot 2, 28/09/2026) : que devient la
 * classification ou la recherche si l'on importe l'ESCO dans le manifeste ? Écrit par un auditeur, relancé et versionné
 * par l'assistant. Données : `esco-metiers.json` et `echantillon.json` de la preuve du pivot du backend
 * (`scripts/preuve-pivot-metiers-2026-09-28/`, étapes 1 et 2, hors git).
 *
 *   node --expose-gc --import tsx audits/2026-09-28/scripts/prototype-esco-moteur.mts
 */
// Prototype LECTURE SEULE du moteur de classification étendu aux métiers ESCO en règles littérales. Aucune base.
import { readFileSync } from 'node:fs';
import { compileOccupationManifest } from '/Users/lmelane/Downloads/catwalks-job-aggregator/packages/db/occupation-engine.ts';
const manifest = JSON.parse(readFileSync('/Users/lmelane/Downloads/catwalks-job-aggregator/packages/db/data/occupations-v1.json', 'utf8'));
const esco = JSON.parse(readFileSync('/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-backend/scripts/preuve-pivot-metiers-2026-09-28/sortie/esco-metiers.json', 'utf8'));
const echantillon = JSON.parse(readFileSync('/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-backend/scripts/preuve-pivot-metiers-2026-09-28/sortie/echantillon.json', 'utf8')).offres as { titre: string }[];
const SITE = new Set(['fr','en','de','it','nl','es','ar','cs','da','el','hu','pl','pt','ro','sv','no']);
const heap = () => { (globalThis as any).gc?.(); return process.memoryUsage().heapUsed; };
const occupations = [...manifest.occupations], rules = [...manifest.rules];
for (const m of esco.metiers) {
  const key = 'esco-' + m.code.replace(/\./g, '-');
  const labels = Object.entries(m.libelles as Record<string, string>).filter(([l]) => SITE.has(l));
  const any = [...new Set([...labels.flatMap(([, v]) => v.split('/').map(s => s.trim())), ...m.synonymes.en, ...m.synonymes.fr].filter(s => /\p{L}/u.test(s)))];
  occupations.push({ key, labels: { fr: m.libelles.fr ?? m.libelles.en, en: m.libelles.en }, family: 'admin-facilities' });
  rules.push({ id: key + '-title', occupation: key, all: [{ field: 'title', any, mode: 'phrase' }], evidence: 'ESCO' });
}
const extended = { ...manifest, id: 'proto-esco', occupations, rules };
const h0 = heap(); let t0 = performance.now();
const cur = compileOccupationManifest(manifest);
const ext = compileOccupationManifest(extended);
console.log(`compilation étendue ${Math.round(performance.now() - t0)} ms ; tas ${Math.round((heap() - h0) / 1e6)} Mo ; règles ${rules.length} ; JSON ${Math.round(JSON.stringify(extended).length / 1e6)} Mo`);
const tr: Record<string, number> = {}; t0 = performance.now();
for (const { titre } of echantillon) {
  const a = cur.classify(titre).occupationStatus, b = ext.classify(titre).occupationStatus;
  tr[`${a} -> ${b}`] = (tr[`${a} -> ${b}`] ?? 0) + 1;
}
console.log(`classification de ${echantillon.length} intitulés d'offres en ${Math.round(performance.now() - t0)} ms`);
console.log(Object.entries(tr).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}: ${v}`).join('\n'));
// Ambiguïtés qui SURVIVENT à la fusion de l'équivalent ESCO : au moins deux candidats ESCO en plus du code actuel.
let survivent = 0, total = 0; const ex: string[] = [];
for (const { titre } of echantillon) {
  const a = cur.classify(titre), b = ext.classify(titre);
  if (a.occupationStatus !== 'CLASSIFIED' || b.occupationStatus !== 'AMBIGUOUS') continue;
  total++;
  const autres = b.occupationEvidence.candidates.filter(c => c !== a.occupationCode);
  if (autres.length >= 2) { survivent++; if (ex.length < 8) ex.push(`${titre} | actuel ${a.occupationCode} | ${autres.length} autres : ${autres.slice(0, 4).map(k => ext.occupations.get(k)!.labels.en).join(' ; ')}`); }
}
console.log(`CLASSIFIED -> AMBIGUOUS : ${total} ; encore ambigus après fusion d'un équivalent : ${survivent}`);
console.log(ex.join('\n'));
for (const [nom, c] of [['actuel', cur], ['étendu', ext]] as const) {
  const t = performance.now(); for (let i = 0; i < 10; i++) for (const { titre } of echantillon) c.classify(titre);
  console.log(`classify ${nom} : ${((performance.now() - t) / (10 * echantillon.length)).toFixed(3)} ms par intitulé`);
}
