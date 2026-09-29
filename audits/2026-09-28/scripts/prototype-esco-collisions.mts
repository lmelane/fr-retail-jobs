/**
 * PROTOTYPE, LECTURE SEULE, SANS BASE (D-475, audit de la conception du lot 2, 28/09/2026) : que devient la
 * classification ou la recherche si l'on importe l'ESCO dans le manifeste ? Écrit par un auditeur, relancé et versionné
 * par l'assistant. Données : `esco-metiers.json` et `echantillon.json` de la preuve du pivot du backend
 * (`scripts/preuve-pivot-metiers-2026-09-28/`, étapes 1 et 2, hors git).
 *
 *   node --expose-gc --import tsx audits/2026-09-28/scripts/prototype-esco-collisions.mts
 */
import { readFileSync } from 'node:fs';
import { searchConcepts } from '/Users/lmelane/Downloads/catwalks-job-aggregator/packages/db/search-vocabulary.ts';
import { searchWords } from '/Users/lmelane/Downloads/catwalks-job-aggregator/packages/db/search-intent.ts';
const manifest = JSON.parse(readFileSync('/Users/lmelane/Downloads/catwalks-job-aggregator/packages/db/data/occupations-v1.json', 'utf8'));
const esco = JSON.parse(readFileSync('/Users/lmelane/Documents/beauchoix-projects/catwalks-build/catwalks-backend/scripts/preuve-pivot-metiers-2026-09-28/sortie/esco-metiers.json', 'utf8'));
const SITE = new Set(['fr','en','de','it','nl','es','ar','cs','da','el','hu','pl','pt','ro','sv','no']);
const p = (s: string) => searchWords(s).join(' ');
// phrase -> ensemble des métiers ESCO qui la portent (libellés des langues du site + synonymes en/fr)
const owners = new Map<string, Set<string>>();
let slash = 0, labelsTot = 0;
for (const m of esco.metiers) {
  const all = [...Object.entries(m.libelles).filter(([l]) => SITE.has(l)).map(([, v]) => v as string), ...m.synonymes.en, ...m.synonymes.fr];
  for (const [l, v] of Object.entries(m.libelles)) if (SITE.has(l)) { labelsTot++; if ((v as string).includes('/')) slash++; }
  for (const a of all) { const k = p(a); if (!k) continue; (owners.get(k) ?? owners.set(k, new Set()).get(k)!).add(m.uri); }
}
const shared = [...owners.values()].filter(s => s.size > 1).length;
console.log(`phrases ESCO distinctes ${owners.size} ; portées par >=2 métiers ESCO ${shared} (${(100*shared/owners.size).toFixed(1)} %)`);
console.log(`libellés préférés (langues du site) contenant « / » (forme masc/fém) : ${slash} sur ${labelsTot}`);
// Alias actuels (62 métiers + 27 familles) qu'au moins DEUX métiers ESCO portent : ambigus même si l'équivalent ESCO est fusionné.
const cur = searchConcepts(manifest, []);
let n = 0, ambig2 = 0, ambig1 = 0; const ex: string[] = [];
for (const c of cur) for (const a of new Set(c.aliases.map(p))) { n++; const o = owners.get(a)?.size ?? 0; if (o >= 2) { ambig2++; if (ex.length < 15) ex.push(`${a} [${c.key}] ${o} métiers ESCO`); } else if (o === 1) ambig1++; }
console.log(`alias actuels ${n} ; portés aussi par 1 métier ESCO ${ambig1} ; par >=2 métiers ESCO ${ambig2}`);
console.log(ex.join('\n'));
// Mots seuls génériques portés par l'ESCO
const single = [...owners.entries()].filter(([k, s]) => !k.includes(' ') && s.size >= 2).sort((a, b) => b[1].size - a[1].size).slice(0, 12).map(([k, s]) => `${k}:${s.size}`);
console.log('mots seuls les plus partagés :', single.join(', '));
