/**
 * PASSE DE CURATION v3, ÉTAPE 6b : PREVIEW SUR LE CORPUS RÉEL (plan `docs/architecture/classification-metiers.md` §3.2).
 * Aucun appel de modèle, aucune écriture en base.
 *
 * Chaque couple (intitulé, service) des offres publiables est classé par le moteur réel avec la version servie et avec
 * la v3 (`6-manifeste-v3.json`), et les deux sont comparés, pondérés par le nombre d'offres :
 *  - PRÉMISSE : la version servie, rejouée, doit redonner le classement stocké en production ; sinon la preview ne
 *    prouve rien (l'étape échoue sous 97 % d'accord) ;
 *  - gains (sans métier → métier), changements de métier, ambiguïtés, par marché ;
 *  - un changement de métier est « prévu » quand la passe l'a décidé (intitulé rattaché aux étapes 3, 3b ou 4, ou
 *    déplacé par une exclusion d'encadrement) ; SEUIL D'ARRÊT du plan : plus de 10 % des intitulés classés en v1 qui
 *    changent de métier hors plan ;
 *  - l'échantillon de mesure : 200 couples dont le métier est nouveau ou change, tirés dans un ordre fixé par empreinte
 *    (reproductible), pour la mesure de justesse par un juge indépendant de la passe.
 *
 * Entrées : `entrees/offres-preview-2026-09-29.json.gz`, la version servie, les étapes 3 à 6. Sortie :
 * `curation-v3/6b-preview.json`.
 *
 *   node --import tsx apps/aggregator/scripts/taxonomie/curation/6b-preview.mts
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { compileOccupationManifest } from '../../../../../packages/db/occupation-engine.ts';
import { DOSSIER_SORTIE, EXCLUS_RAYON, lireEtape, phraseMoteur, servie } from './commun.mts';

/** Seuils d'arrêt (plan §3.2 ; ambiguïtés et pertes ajoutées après l'audit technique du 29/09/2026). */
const SEUIL_PREMISSE = 0.97, SEUIL_HORS_PLAN = 0.10, SEUIL_AMBIGUES = 0.01, SEUIL_PERTES = 0.005, ECHANTILLON = 200;
const { couples } = JSON.parse(gunzipSync(readFileSync(`${DOSSIER_SORTIE}entrees/offres-preview-2026-09-29.json.gz`)).toString('utf8'));
const v3 = lireEtape('6-manifeste-v3.json'), correspondances = lireEtape('6-correspondances.json'), scission = lireEtape('3c-scission-vente.json');
const t0 = performance.now();
const moteurV1 = compileOccupationManifest(structuredClone(servie)), moteurV3 = compileOccupationManifest(v3);
const compilation = Math.round(performance.now() - t0);

// Les intitulés dont la passe a décidé le métier (en minuscules, comme l'export des intitulés).
// Un changement est PRÉVU seulement s'il va exactement là où la passe l'a décidé : métier cible d'un intitulé (étapes 3,
// 3b, 4), ou aucun métier pour un poste d'encadrement exclu sans cible (l'ancien test « tout intitulé d'encadrement »
// passait pour prévu n'importe quel changement, audit du 29/09/2026).
const cleV3 = (cle: string) => correspondances.metiers[cle] ?? cle;
const prevu = new Map<string, string | null>();
for (const t of lireEtape('3-intitules-offres.json').intitules) if (t.concept) prevu.set(t.intitule, cleV3(t.concept));
for (const v of lireEtape('3b-garde-unicite.json').variantesAjoutees) prevu.set(v.intitule, cleV3(v.concept));
for (const t of lireEtape('4-encadrement.json').intitules) if (t.encadrement) prevu.set(t.intitule.toLowerCase().trim(), t.cible ? cleV3(t.cible) : null);

type Ligne = { titre: string; service: string | null; offres: number; pays: string[]; stocke: string | null; statutStocke: string;
  v1: string | null; v1s: string; v3: string | null; v3s: string };
const t1 = performance.now();
const lignes: Ligne[] = couples.map((c: any) => {
  const a = moteurV1.classify(c.titre, c.service), b = moteurV3.classify(c.titre, c.service);
  return { titre: c.titre, service: c.service, offres: c.offres, pays: c.pays ?? [], stocke: c.code, statutStocke: c.statut,
    v1: a.occupationCode, v1s: a.occupationStatus, v3: b.occupationCode, v3s: b.occupationStatus };
});
const classement = Math.round(performance.now() - t1);
const somme = (l: Ligne[]) => l.reduce((n, x) => n + x.offres, 0);
const total = somme(lignes);

// Prémisse sur le code ET le statut : la version servie rejouée doit redonner l'un et l'autre.
const accordPremisse = somme(lignes.filter((l) => l.v1 === l.stocke && l.v1s === l.statutStocke)) / total;
const cle = (l: Ligne) => l.titre.toLowerCase().trim();
// Les décisions de 3c (D-475 §35) tenues sur les VRAIES offres, variantes comprises : une offre dont l'intitulé contient
// une forme décidée sans métier n'est ni vente ni rayon ; décidée rayon, pas vente ; décidée vente, pas rayon (troisième
// audit du 29/09/2026 : le contrôle d'assemblage ne voyait que les textes littéraux).
const [cleVente, cleRayon] = [cleV3(scission.cible), cleV3(scission.source)];
const interdit = (m: string) => (m === 'aucun' ? [cleVente, cleRayon] : m === 'rayon' ? [cleVente] : [cleRayon]);
const decisions3c = [...scission.decisions.flatMap((d: any) => [d.intitule, ...(d.formes ?? [])].map((t: string) => ({ f: ` ${phraseMoteur(t)} `, m: d.metier }))),
  ...EXCLUS_RAYON.map((t) => ({ f: ` ${phraseMoteur(t)} `, m: 'aucun' }))];
const ecarts3c = lignes.filter((l) => { const t = ` ${phraseMoteur(l.titre)} `; return decisions3c.some((d: any) => t.includes(d.f) && interdit(d.m).includes(l.v3!)); });
const estPrevu = (l: Ligne) => prevu.has(cle(l)) && prevu.get(cle(l)) === l.v3;
const gains = lignes.filter((l) => !l.v1 && l.v3), pertes = lignes.filter((l) => l.v1 && !l.v3);
const changes = lignes.filter((l) => l.v1 && l.v3 && l.v1 !== l.v3);
const horsPlan = [...changes, ...pertes].filter((l) => !estPrevu(l));
const classesV1 = lignes.filter((l) => l.v1);
const tauxHorsPlan = new Set(horsPlan.map((l) => l.titre)).size / new Set(classesV1.map((l) => l.titre)).size;

const parPays = new Map<string, { offres: number; v1: number; v3: number }>();
for (const l of lignes) for (const p of l.pays.length ? l.pays : ['?']) {
  const x = parPays.get(p) ?? { offres: 0, v1: 0, v3: 0 };
  x.offres += l.offres; if (l.v1) x.v1 += l.offres; if (l.v3) x.v3 += l.offres;
  parPays.set(p, x);
}
const pct = (a: number, b: number) => Math.round((1000 * a) / b) / 10;
const marches = [...parPays].sort((a, b) => b[1].offres - a[1].offres)
  .map(([p, x]) => ({ pays: p, offres: x.offres, classesV1: pct(x.v1, x.offres), classesV3: pct(x.v3, x.offres) }));
const top = (l: Ligne[], n: number) => l.sort((a, b) => b.offres - a.offres).slice(0, n)
  .map((x) => ({ titre: x.titre, service: x.service, offres: x.offres, v1: x.v1, v3: x.v3 }));
// Échantillon pondéré par le nombre d'offres (tirage sans remise d'Efraimidis et Spirakis, aléa tiré de l'empreinte :
// reproductible), sur TOUS les couples dont le résultat change : gains, changements, pertes et ambiguïtés.
const alea = (l: Ligne) => (parseInt(createHash('sha256').update(`mesure-v3|${l.titre}|${l.service}`).digest('hex').slice(0, 12), 16) + 1) / 2 ** 48;
const echantillon = [...gains, ...changes, ...pertes].map((l) => ({ l, k: Math.log(alea(l)) / l.offres })).sort((a, b) => b.k - a.k).slice(0, ECHANTILLON).map((x) => x.l)
  .map((l) => ({ titre: l.titre, service: l.service, offres: l.offres, avant: l.v1, metier: l.v3, statut: l.v3s,
    libelle: v3.occupations.find((o: any) => o.key === l.v3)?.labels.fr }));

const bilan = { manifeste: v3.id, couples: lignes.length, offres: total, compilationMs: compilation, classementMs: classement,
  premisse: { accordAvecLaProduction: pct(accordPremisse * total, total), seuil: SEUIL_PREMISSE * 100 },
  offresClassees: { v1: somme(classesV1), v3: somme(lignes.filter((l) => l.v3)), v1Pct: pct(somme(classesV1), total), v3Pct: pct(somme(lignes.filter((l) => l.v3)), total) },
  ambigues: { v1: somme(lignes.filter((l) => l.v1s === 'AMBIGUOUS')), v3: somme(lignes.filter((l) => l.v3s === 'AMBIGUOUS')) },
  gains: somme(gains), changementsDeMetier: somme(changes), pertes: somme(pertes),
  horsPlan: { offres: somme(horsPlan), intitules: new Set(horsPlan.map((l) => l.titre)).size, taux: pct(tauxHorsPlan, 1), seuil: SEUIL_HORS_PLAN * 100 },
  decisions3cNonTenues: { couples: ecarts3c.length, offres: somme(ecarts3c) },
  seuils: { ambiguesPct: pct(somme(lignes.filter((l) => l.v3s === 'AMBIGUOUS')), total), ambiguesSeuil: SEUIL_AMBIGUES * 100,
    pertesHorsPlanPct: pct(somme(pertes.filter((l) => !estPrevu(l))), total), pertesSeuil: SEUIL_PERTES * 100 } };
writeFileSync(`${DOSSIER_SORTIE}6b-preview.json`, JSON.stringify({ calculeLe: new Date().toISOString(), bilan, marches,
  principauxGains: top([...gains], 30), principauxHorsPlan: top([...horsPlan], 40), principalesPertes: top([...pertes], 20), echantillon }, null, 1));
console.log(JSON.stringify({ ...bilan, marches: marches.slice(0, 8) }, null, 1));
const echecs = [accordPremisse < SEUIL_PREMISSE && `prémisse non remplie : la version servie rejouée ne redonne que ${pct(accordPremisse * total, total)} % du classement stocké`,
  tauxHorsPlan > SEUIL_HORS_PLAN && `seuil d'arrêt : ${pct(tauxHorsPlan, 1)} % des intitulés classés changent de métier hors plan`,
  somme(lignes.filter((l) => l.v3s === 'AMBIGUOUS')) / total > SEUIL_AMBIGUES && `seuil d'arrêt : trop d'offres ambiguës`,
  somme(pertes.filter((l) => !estPrevu(l))) / total > SEUIL_PERTES && `seuil d'arrêt : trop d'offres perdent leur métier hors plan`,
  ecarts3c.length > 0 && `${ecarts3c.length} offre(s) contredisent une décision de 3c : ${ecarts3c.slice(0, 5).map((l) => `« ${l.titre} » → ${l.v3}`).join(' ; ')}`].filter(Boolean);
if (echecs.length) { console.error(`ARRÊT : ${echecs.join(' ; ')}`); process.exitCode = 1; }
