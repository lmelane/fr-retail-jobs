/**
 * PASSE DE CURATION v3, ÉTAPE 6e : BANCS DE LA v3 (plan `docs/architecture/classification-metiers.md` §4, ligne 2A :
 * « bancs (classification, recherche, mémoire, rappel par marché) »). Aucun appel de modèle, aucune écriture en base.
 *
 *  - RÉSOLUTION : chaque libellé d'un métier (25 langues) et chaque alias du vocabulaire de recherche de l'API, classé
 *    comme un intitulé par le moteur, doit rendre CE métier (sinon un candidat qui tape ou choisit ce nom tomberait sur un
 *    autre métier, ou sur rien) ; la même chose avec la version servie pour comparer ;
 *  - MÉMOIRE ET TEMPS : compilation des deux versions, tas utilisé, débit de classement ;
 *  - RAPPEL PAR MARCHÉ : repris de la preview (`6b-preview.json`), tous les marchés ;
 *  - LIBELLÉS IDENTIQUES À L'ANGLAIS dans les 16 langues latines non anglaises (compte cité par D-475 §34).
 * Sortie : `curation-v3/6e-bancs.json`. Échoue si un libellé ou un alias rend un AUTRE métier.
 *
 *   node --import tsx apps/aggregator/scripts/taxonomie/curation/6e-bancs.mts
 */
import { writeFileSync } from 'node:fs';
import { compileOccupationManifest } from '../../../../../packages/db/occupation-engine.ts';
import { DOSSIER_SORTIE, lireEtape, servie } from './commun.mts';

const v3 = lireEtape('6-manifeste-v3.json'), preview = lireEtape('6b-preview.json'), garde = lireEtape('5c-garde.json');
const tas = () => process.memoryUsage().heapUsed;
const t0 = performance.now(), h0 = tas();
const moteurV1 = compileOccupationManifest(structuredClone(servie));
const t1 = performance.now(), h1 = tas();
const moteurV3 = compileOccupationManifest(v3);
const t2 = performance.now(), h2 = tas();

// Résolution des libellés et des alias de recherche.
type Cas = { metier: string; langue: string; libelle: string; rendu: string | null; statut: string };
const cas: Cas[] = [];
for (const o of v3.occupations) for (const [langue, libelle] of Object.entries<string>(o.labels)) {
  const d = moteurV3.classify(libelle, null);
  cas.push({ metier: o.key, langue, libelle, rendu: d.occupationCode, statut: d.occupationStatus });
}
for (const [metier, alias] of Object.entries<string[]>(garde.aliasRecherche)) for (const a of alias) {
  const d = moteurV3.classify(a, null);
  cas.push({ metier, langue: 'recherche', libelle: a, rendu: d.occupationCode, statut: d.occupationStatus });
}
const autreMetier = cas.filter((c) => c.rendu && c.rendu !== c.metier);
const rienDuTout = cas.filter((c) => !c.rendu);
const servisResolus = servie.occupations.flatMap((o: any) => Object.values<string>(o.labels).map((l) => moteurV1.classify(l, null).occupationCode === o.key));

// Débit de classement sur les intitulés de la preview.
const titres = preview.echantillon.map((e: any) => e.titre);
const t3 = performance.now();
for (let n = 0; n < 50; n++) for (const t of titres) moteurV3.classify(t, null);
const debit = Math.round((50 * titres.length) / ((performance.now() - t3) / 1000));

// Libellés identiques à l'anglais (D-475 §34).
const LATINES = ['fr', 'de', 'it', 'es', 'nl', 'pt', 'pt-BR', 'da', 'pl', 'sv', 'tr', 'ms', 'nb', 'cs', 'hu', 'ro'];
let identiques = 0, total = 0;
for (const o of v3.occupations) { const en = (o.labels.en ?? '').trim().toLowerCase(); for (const l of LATINES) { const x = (o.labels[l] ?? '').trim().toLowerCase(); if (!x) continue; total++; if (x === en) identiques++; } }

const bilan = {
  resolution: { cas: cas.length, justes: cas.length - autreMetier.length - rienDuTout.length, autreMetier: autreMetier.length, aucunMetier: rienDuTout.length,
    servieLibellesResolus: `${servisResolus.filter(Boolean).length}/${servisResolus.length}` },
  memoireEtTemps: { compilationV1Ms: Math.round(t1 - t0), compilationV3Ms: Math.round(t2 - t1), tasV1Mo: Math.round((h1 - h0) / 1e6), tasV3Mo: Math.round((h2 - h1) / 1e6),
    regles: v3.rules.length, classementsParSeconde: debit },
  rappelParMarche: preview.marches,
  libellesIdentiquesALAnglais: { identiques, total, langues: LATINES.length },
};
writeFileSync(`${DOSSIER_SORTIE}6e-bancs.json`, JSON.stringify({ calculeLe: new Date().toISOString(), manifeste: v3.id, bilan,
  autreMetier, aucunMetier: rienDuTout }, null, 1));
console.log(JSON.stringify({ ...bilan, rappelParMarche: `${preview.marches.length} marchés` }, null, 1));
for (const c of autreMetier.slice(0, 15)) console.log(` autre métier : ${c.langue} « ${c.libelle} » de ${c.metier} → ${c.rendu}`);
for (const c of rienDuTout.slice(0, 10)) console.log(` aucun métier : ${c.langue} « ${c.libelle} » de ${c.metier} (${c.statut})`);
if (autreMetier.length) { console.error(`BANC ÉCHOUÉ : ${autreMetier.length} libellé(s) ou alias rendent un autre métier`); process.exitCode = 1; }
