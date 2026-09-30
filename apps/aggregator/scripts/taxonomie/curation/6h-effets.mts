/**
 * PASSE DE CURATION v3, ÉTAPE 6h : EFFETS DES CORRECTIONS À LA MAIN SUR LE CORPUS (D-475 §39 ; plan
 * `docs/architecture/classification-metiers.md` §3.1). Aucun appel de modèle, aucune écriture en base.
 *
 * Compare, couple par couple (intitulé, service), le manifeste d'AVANT 6h et le manifeste courant : métier du moteur et
 * métiers lus (`titleRoles`). Chaque couple qui change est rattaché à la correction de `6h-corrections-main.json` qui
 * l'explique (la forme est dans l'intitulé et le métier part ou arrive comme la correction le dit) ; un changement
 * qu'aucune correction n'explique est un effet de bord, et l'étape échoue. Les comptes de 6h ne s'écrivent jamais à la
 * main (audit du 30/09/2026 : trois comptes différents pour la même correction).
 *
 * Le manifeste d'avant 6h est celui du commit 35276c4 (empreinte 1010f684…) :
 *   git show 35276c4:audits/2026-09-28/curation-v3/6-manifeste-v3.json > scratchpad/manifeste-avant-6h.json
 *   node --import tsx apps/aggregator/scripts/taxonomie/curation/6h-effets.mts --avant=scratchpad/manifeste-avant-6h.json [--corpus=offres-preview-<date>.json.gz]
 * Sortie : `6h-effets.json`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { compileOccupationManifest, occupationMatchKey } from '../../../../../packages/db/occupation-engine.ts';
import { occupationTitleRoles } from '../../../../../packages/db/occupation-title-roles.ts';
import { searchWords } from '../../../../../packages/db/search-intent.ts';
import { DOSSIER_SORTIE as D, lireEtape } from './commun.mts';

const EMPREINTE_AVANT = '1010f684b3949fa9eaf59be1cf4ec027e4d71f880acb487900e95bc6c1b8a605';
const argAvant = process.argv.find((a) => a.startsWith('--avant='));
if (!argAvant) throw new Error('usage : --avant=<manifeste d’avant 6h> [--corpus=offres-preview-<date>.json.gz]');
const octetsAvant = readFileSync(argAvant.slice(8));
if (createHash('sha256').update(octetsAvant).digest('hex') !== EMPREINTE_AVANT) throw new Error('le manifeste d’avant 6h n’est pas celui du commit 35276c4');
const argCorpus = process.argv.find((a) => a.startsWith('--corpus='));
if (argCorpus && !/^--corpus=offres-preview-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(argCorpus)) throw new Error('usage : --corpus=offres-preview-<AAAA-MM-JJ>.json.gz');
const CORPUS = argCorpus ? argCorpus.slice(9) : 'offres-preview-2026-09-29.json.gz';

const avant = compileOccupationManifest(JSON.parse(octetsAvant.toString('utf8')));
const octetsApres = readFileSync(`${D}6-manifeste-v3.json`);
const apres = compileOccupationManifest(JSON.parse(octetsApres.toString('utf8')));
const e6h = lireEtape('6h-corrections-main.json');
const { couples } = JSON.parse(gunzipSync(readFileSync(`${D}entrees/${CORPUS}`)).toString('utf8'));

const cle = (v: string) => ` ${occupationMatchKey(v, 2)} `;
const porte = (titre: string, formes: string[]) => formes.some((f) => cle(titre).includes(cle(f)));
const lit = (titre: string, phrase: string) => ` ${searchWords(titre).join(' ')} `.includes(` ${phrase} `);
const etat = (cat: ReturnType<typeof compileOccupationManifest>, c: any) => {
  const d = cat.classify(c.titre, c.service);
  return { code: d.occupationCode as string | null, metiers: new Set<string>([...(d.occupationCode ? [d.occupationCode] : []), ...occupationTitleRoles(cat, c.titre, d)]) };
};
type Entree = { nom: string; explique: (c: any, a: ReturnType<typeof etat>, b: ReturnType<typeof etat>) => boolean };
const entrees: Entree[] = [
  ...e6h.formesSansMetier.map((x: any) => ({ nom: `sans métier : ${x.formes.join(', ')}`,
    explique: (c: any, a: any, b: any) => porte(c.titre, x.formes) && !b.code && a.metiers.size > b.metiers.size })),
  ...e6h.exclusions.map((x: any) => ({ nom: `exclusion ${x.metier} : ${x.formes.join(', ')}`,
    explique: (c: any, a: any, b: any) => porte(c.titre, x.formes) && a.metiers.has(x.metier) && !b.metiers.has(x.metier) })),
  ...e6h.expressions.map((x: any) => ({ nom: `expression ${x.metier} : ${x.formes.join(', ')}`,
    explique: (c: any, a: any, b: any) => porte(c.titre, x.formes) && !a.metiers.has(x.metier) && b.code === x.metier })),
  ...e6h.lecturesRetirees.map((x: any) => ({ nom: `lecture retirée ${x.metier} : ${x.phrase}`,
    explique: (c: any, a: any, b: any) => lit(c.titre, x.phrase) && a.metiers.has(x.metier) && !b.metiers.has(x.metier) })),
];
const parEntree = new Map<string, { couples: number; offres: number; exemples: string[] }>(entrees.map((e) => [e.nom, { couples: 0, offres: 0, exemples: [] }]));
const inexpliques: any[] = [];
const bouge = new Map<string, { partent: number; arrivent: number }>();
let changes = 0, offresChangees = 0;
for (const c of couples) {
  const a = etat(avant, c), b = etat(apres, c);
  if (a.code === b.code && a.metiers.size === b.metiers.size && [...a.metiers].every((k) => b.metiers.has(k))) continue;
  changes++; offresChangees += c.offres;
  for (const k of a.metiers) if (!b.metiers.has(k)) { const x = bouge.get(k) ?? { partent: 0, arrivent: 0 }; x.partent += c.offres; bouge.set(k, x); }
  for (const k of b.metiers) if (!a.metiers.has(k)) { const x = bouge.get(k) ?? { partent: 0, arrivent: 0 }; x.arrivent += c.offres; bouge.set(k, x); }
  const lesquelles = entrees.filter((e) => e.explique(c, a, b));
  if (!lesquelles.length) { inexpliques.push({ titre: c.titre, service: c.service, offres: c.offres, avant: [...a.metiers], apres: [...b.metiers] }); continue; }
  for (const e of lesquelles) { const x = parEntree.get(e.nom)!; x.couples++; x.offres += c.offres; if (x.exemples.length < 5) x.exemples.push(c.titre); }
}
const sortie = { calculeLe: new Date().toISOString(), corpus: CORPUS, manifesteAvant: EMPREINTE_AVANT,
  manifesteApres: createHash('sha256').update(octetsApres).digest('hex'), couplesQuiChangent: changes, offresQuiChangent: offresChangees,
  inexpliques, metiers: Object.fromEntries([...bouge].sort((p, q) => (q[1].partent + q[1].arrivent) - (p[1].partent + p[1].arrivent))),
  corrections: Object.fromEntries(parEntree) };
writeFileSync(`${D}6h-effets${CORPUS === 'offres-preview-2026-09-29.json.gz' ? '' : `-${CORPUS.slice(15, 25)}`}.json`, JSON.stringify(sortie, null, 1));
console.log(JSON.stringify({ couplesQuiChangent: changes, offresQuiChangent: offresChangees, inexpliques: inexpliques.length,
  corrections: Object.fromEntries([...parEntree].map(([k, v]) => [k, `${v.couples} couples, ${v.offres} offres`])) }, null, 1));
for (const x of inexpliques.slice(0, 15)) console.log(` inexpliqué : « ${x.titre} » ${x.avant.join(',')} → ${x.apres.join(',')}`);
if (inexpliques.length) { console.error(`ÉCHEC : ${inexpliques.length} changement(s) qu’aucune correction de 6h n’explique`); process.exitCode = 1; }
