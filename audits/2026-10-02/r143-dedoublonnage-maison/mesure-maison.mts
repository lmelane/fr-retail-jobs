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
// L'écart avec le constat D-513 (Q28 de canonique-dedup.sql) : 303 entités / 6 268 offres servies dont le NOM porte une
// forme juridique, quelle que soit leur Maison. Même filtre ici, et ce que la règle en fait.
const LEGAL = /\b(inc|llc|ltd|limited|gmbh|s\.?a\.?s?|b\.?v|ag|srl|s\.?l\.?u?|pty|co\.|corp|corporation|kk|k\.k|sdn bhd|bvba|ab|aps|kft|sp\. z o\.o|branch|sucursal|succursale|filial|zweigniederlassung)\b/i;
const attachedIds = new Set(preview.groups.flatMap(g => g.entities.map(e => e.id)));
const uncertainIds = new Set(preview.uncertain.map(u => u.entityId));
const legal = snapshot.filter(r => r.servies > 0 && LEGAL.test(r.name));
const legalAttached = legal.filter(r => attachedIds.has(r.id)), legalUncertain = legal.filter(r => uncertainIds.has(r.id));
const legalOther = legal.filter(r => !attachedIds.has(r.id) && !uncertainIds.has(r.id));
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
  lignes_maison_a_creer: preview.groups.filter(g => !g.maisonId).map(g => g.maison), incertaines_par_motif: reasons,
  forme_juridique_servies_q28: { entites: legal.length, offres: legal.reduce((n, r) => n + r.servies, 0),
    rattachees: { entites: legalAttached.length, offres: legalAttached.reduce((n, r) => n + r.servies, 0) },
    a_part_motif: { entites: legalUncertain.length, offres: legalUncertain.reduce((n, r) => n + r.servies, 0) },
    hors_regle_NOT_AN_ENTITY: { entites: legalOther.length, offres: legalOther.reduce((n, r) => n + r.servies, 0) } },
  rattachees_sans_forme_juridique: { entites: [...attachedIds].filter(id => !LEGAL.test(byId.get(id)!.name)).length },
  // Entités sous une clé historique (pas `resolved:SOURCE_…`) : sans alias relu, leur offre suivante recréerait l'entité.
  entites_sous_cle_historique: [...attachedIds].filter(id => !String(byId.get(id)!.fashionjobsUrl).startsWith('resolved:SOURCE_')).length,
  alias_relus_poses: preview.groups.reduce((n, g) => n + new Set(g.entities.flatMap(e => e.labels.map(l => `${l.sourceKey} ${l.label}`))).size, 0),
  lignes_creees: preview.groups.filter(g => !g.maisonId).map(g => ({ maison: g.maison, cle: g.createKey, domaine: g.createDomain })),
  plus_grosse_transaction: preview.groups.map(g => ({ maison: g.maison, offres_toutes: (g.maisonId ? byId.get(g.maisonId)!.toutes ?? 0 : 0)
    + g.entities.reduce((n, e) => n + (byId.get(e.id)!.toutes ?? 0), 0) })).sort((a, b) => b.offres_toutes - a.offres_toutes)[0] }, null, 2));
console.log('\n| Maison | ligne | entités rattachées | offres servies sous le nom de la Maison, avant | après |\n|---|---|---|---|---|');
for (const r of rows.slice(0, 15)) console.log(`| ${r.maison} | ${r.ligne} | ${r.entites} | ${r.offres_avant} | ${r.offres_apres} |`);
console.log('\nEntités restées à part, signalées en revue :\n| entité | Maison du registre | motif | offres servies |\n|---|---|---|---|');
for (const u of preview.uncertain) console.log(`| ${u.name} | ${u.maison} | ${u.reason} | ${u.servies} |`);
console.log('\nEntités servies à forme juridique que la règle ne rattache pas (NOT_AN_ENTITY : le nom ne prolonge pas la Maison du registre de ses sources, ou une source sans Maison/ portail de groupe) :\n| entité | offres servies | Maisons du registre de ses sources |\n|---|---|---|');
for (const r of legalOther.sort((a, b) => b.servies - a.servies)) console.log(`| ${r.name.replace(/\|/g, '/')} | ${r.servies} | ${[...new Set(r.sources.map(s => s.maison ?? '∅'))].join(', ')} |`);
console.log('\nRelecture : toutes les entités rattachées\n| Maison | entité | offres servies | sources |\n|---|---|---|---|');
for (const g of preview.groups) for (const e of g.entities) console.log(`| ${g.maison} | ${e.name.replace(/\|/g, '/')} | ${e.servies} | ${e.sourceKeys.join(', ')} |`);
