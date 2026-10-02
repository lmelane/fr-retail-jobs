/**
 * Canonisation du secteur (D-519, D-515 §1) — mesure À BLANC sur les extractions de la production en lecture seule.
 * Appelle le code (`recognizeSectors`, `maisonPreview`) : aucune règle n'est réimplémentée ici.
 *
 *   npx tsx audits/2026-10-02/canon-secteur/mesure-secteur.mts <employeurs.jsonl> <natives.jsonl> <sortie-apercu.json>
 *
 * Rend : couverture avant / après par marché, concentration des offres sans secteur, effet sur trois secteurs
 * (offres confirmées et inconnues), les propositions à relire et les abstentions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { recognizeSectors, SECTOR_RECOGNITION_KIND, type NativeCategory, type SectorEmployer } from '../../../apps/aggregator/src/sectors/recognize.js';
import { maisonPreview } from '../../../apps/aggregator/src/identity/maisonPlan.js';

type Row = SectorEmployer & { marches: Record<string, number> };
const [employeursFile, nativesFile, sortie] = process.argv.slice(2);
if (!employeursFile || !nativesFile || !sortie) throw new Error('usage: mesure-secteur.mts employeurs.jsonl natives.jsonl apercu.json');
const read = <T>(f: string) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);
const snapshot = read<Row>(employeursFile);
const natives = read<NativeCategory>(nativesFile);
const checkedAt = new Date().toISOString();

const result = recognizeSectors(snapshot, natives, checkedAt);
writeFileSync(sortie, JSON.stringify({ kind: SECTOR_RECOGNITION_KIND, ...result }, null, 2) + '\n');

// Les secteurs de chaque société : avant, après la reconnaissance, puis après le rattachement R-143 §5 recalculé.
const before = new Map(snapshot.map(r => [r.id, r.sectorCodes ?? []]));
const after = new Map(before);
for (const p of result.proposals) after.set(p.id, p.codes);
const updated = snapshot.map(r => ({ ...r, sectorCodes: after.get(r.id)! }));
const attachedTo = new Map<string, string | null>();
for (const g of maisonPreview(updated).groups) for (const e of g.entities) attachedTo.set(e.id, g.maisonId);
const attachedBefore = new Map<string, string | null>();
for (const g of maisonPreview(snapshot).groups) for (const e of g.entities) attachedBefore.set(e.id, g.maisonId);
const merged = (codes: Map<string, string[]>, attach: Map<string, string | null>) => (id: string) =>
  attach.has(id) ? (attach.get(id) ? codes.get(attach.get(id)!)! : []) : codes.get(id)!;

const etats = {
  avant: (id: string) => before.get(id)!,
  'avant + rattachement': merged(before, attachedBefore),
  'après reconnaissance': (id: string) => after.get(id)!,
  'après reconnaissance + rattachement': merged(after, attachedTo),
};
const marches = new Map<string, number>();
for (const r of snapshot) for (const [m, n] of Object.entries(r.marches ?? {})) marches.set(m, (marches.get(m) ?? 0) + n);
const out: string[] = [];
const line = (...cells: unknown[]) => out.push(cells.join('\t'));

const couverture = (etat: (id: string) => string[], marche?: string) => {
  let total = 0, connu = 0;
  for (const r of snapshot) {
    const n = marche ? r.marches?.[marche] ?? 0 : r.servies;
    total += n; if (etat(r.id).length) connu += n;
  }
  return { total, connu, inconnu: total - connu, pct: total ? (100 * connu / total).toFixed(1) : '-' };
};
line('== couverture du secteur, offres servies');
line('état', 'servies', 'connu', 'inconnu', 'couverture %');
for (const [nom, etat] of Object.entries(etats)) { const c = couverture(etat); line(nom, c.total, c.connu, c.inconnu, c.pct); }
line('');
line('== par marché (au moins 100 offres servies)');
line('marché', 'servies', ...Object.keys(etats).map(e => `${e} %`), 'inconnu après');
for (const [m, n] of [...marches].sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= 100)) {
  line(m, n, ...Object.values(etats).map(e => couverture(e, m).pct), couverture(etats['après reconnaissance + rattachement'], m).inconnu);
}
line('');
const inconnues = snapshot.filter(r => r.servies > 0 && !before.get(r.id)!.length).sort((a, b) => b.servies - a.servies);
const totalInconnu = inconnues.reduce((s, r) => s + r.servies, 0);
line('== concentration des offres sans secteur (avant)');
line('sociétés', inconnues.length, 'offres', totalInconnu);
for (const k of [10, 20, 50, 100, 200]) { const s = inconnues.slice(0, k).reduce((t, r) => t + r.servies, 0); line(`les ${k} premières`, s, `${(100 * s / totalInconnu).toFixed(1)} %`); }
line('');
line('== effet sur trois secteurs (confirmées = portent le secteur ; inconnues = sans secteur, « non précisé »)');
line('secteur', 'marché', ...Object.keys(etats).flatMap(e => [`${e} confirmées`, `${e} inconnues`]));
for (const [code, marche] of [['EYEWEAR', 'US'], ['FASHION', 'US'], ['WINES_SPIRITS', 'FR'], ['BEAUTY', 'FR']] as const) {
  const cells = Object.values(etats).flatMap(etat => {
    let ok = 0, unknown = 0;
    for (const r of snapshot) { const n = r.marches?.[marche] ?? 0; const codes = etat(r.id); if (codes.includes(code)) ok += n; else if (!codes.length) unknown += n; }
    return [ok, unknown];
  });
  line(code, marche, ...cells);
}
line('');
line('== propositions', result.proposals.length, 'sociétés', result.proposals.reduce((s, p) => s + p.servies, 0), 'offres servies');
const parFamille = new Map<string, number>();
for (const p of result.proposals) for (const f of new Set(p.origins.map(o => o.origin.split(':')[0]))) parFamille.set(f, (parFamille.get(f) ?? 0) + p.servies);
for (const [f, n] of parFamille) line('  preuve', f, n, 'offres');
line('== abstentions (sociétés avec offres servies)');
const parMotif = new Map<string, [number, number]>();
for (const a of result.abstentions) { const [s, n] = parMotif.get(a.reason) ?? [0, 0]; parMotif.set(a.reason, [s + 1, n + a.servies]); }
for (const [motif, [s, n]] of [...parMotif].sort((a, b) => b[1][1] - a[1][1])) line('  ', motif, s, 'sociétés', n, 'offres');
const sansPreuve = inconnues.filter(r => !result.proposals.some(p => p.id === r.id) && !result.abstentions.some(a => a.id === r.id));
line('  sans décision (entité dont la Maison décide)', sansPreuve.length, sansPreuve.reduce((s, r) => s + r.servies, 0));
line('');
line('== les 60 plus grosses propositions (à relire)');
for (const p of result.proposals.slice(0, 60)) line(p.servies, p.name, p.codes.join('+'), p.origins.map(o => `${o.code}<${o.origin}`).join(' ; '), p.notes.join(' '));
line('');
line('== les 40 plus grosses abstentions');
for (const a of result.abstentions.slice(0, 40)) line(a.servies, a.name, a.reason);
console.log(out.join('\n'));
