/**
 * R-143 §5 — mesure À BLANC du rattachement des entités juridiques à leur Maison (02/10/2026). Aucune écriture.
 * Rejouer : npx tsx audits/2026-10-02/r143-dedoublonnage-maison/mesure-maison.mts <employeurs.jsonl>   (extraction-employeurs.sql)
 * La mesure appelle `maisonPreview` du code (`identity/maisonPlan.ts`), la même que la commande `attach-maisons`.
 */
import { readFileSync } from 'node:fs';
import { maisonPreview, type Snapshot } from '../../../apps/aggregator/src/identity/maisonPlan.js';

const snapshot = readFileSync(process.argv[2], 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) as Snapshot;
const byId = new Map(snapshot.map(row => [row.id, row]));
const preview = maisonPreview(snapshot);
const rows = preview.groups.map(g => {
  const own = g.maisonId ? byId.get(g.maisonId)!.servies : 0;
  const added = g.entities.reduce((n, e) => n + e.servies, 0);
  return { maison: g.maison, ligne: g.maisonId ? 'existante' : 'à créer', entites: g.entities.length, offres_avant: own, offres_apres: own + added };
}).sort((a, b) => b.offres_apres - a.offres_apres);
const reasons: Record<string, number> = {};
for (const u of preview.uncertain) reasons[u.reason] = (reasons[u.reason] ?? 0) + 1;
console.log(JSON.stringify({ employeurs_non_fusionnes: snapshot.length, maisons_regroupees: preview.groups.length,
  entites_rattachees: rows.reduce((n, r) => n + r.entites, 0),
  offres_servies_rattachees: preview.groups.reduce((n, g) => n + g.entities.reduce((m, e) => m + e.servies, 0), 0),
  lignes_maison_a_creer: preview.groups.filter(g => !g.maisonId).map(g => g.maison), incertaines_par_motif: reasons }, null, 2));
console.log('\n| Maison | ligne | entités rattachées | offres servies sous le nom de la Maison, avant | après |\n|---|---|---|---|---|');
for (const r of rows.slice(0, 15)) console.log(`| ${r.maison} | ${r.ligne} | ${r.entites} | ${r.offres_avant} | ${r.offres_apres} |`);
console.log('\nEntités restées à part, signalées en revue :\n| entité | Maison du registre | motif | offres servies |\n|---|---|---|---|');
for (const u of preview.uncertain) console.log(`| ${u.name} | ${u.maison} | ${u.reason} | ${u.servies} |`);
console.log('\nRelecture : toutes les entités rattachées\n| Maison | entité | offres servies | sources |\n|---|---|---|---|');
for (const g of preview.groups) for (const e of g.entities) console.log(`| ${g.maison} | ${e.name.replace(/\|/g, '/')} | ${e.servies} | ${e.sourceKeys.join(', ')} |`);
