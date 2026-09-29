/**
 * PASSE DE CURATION v3, ÉTAPE 3c : LA VENTE EN BOUTIQUE ET LA MISE EN RAYON (D-475 §35, arbitrage du CEO du 29/09/2026).
 *
 * « Employé de commerce » (backend) mêlait la vente en boutique (« Dependiente », « Addetto alle vendite », « 販売スタッフ »)
 * et la mise en rayon de la grande distribution (« Employée de rayon crèmerie ») ; dans plusieurs langues il portait le
 * même mot que « Conseiller de vente ». Le métier est renommé « Employé de rayon » dans chaque langue par l'étape 5b
 * (fichier `5b-fautes-audit.json`). Ici, chaque intitulé d'offre (avec ses employeurs et services), chaque alias et chaque
 * ancien nom du métier (étape 5, avant renommage) est jugé par les deux juges contre CHACUN des deux métiers :
 *  - confirmé pour la vente seulement → « Conseiller de vente » ;
 *  - confirmé pour le rayon seulement → « Employé de rayon » ;
 *  - confirmé pour les deux ou pour aucun → aucun métier (plan §3.1 : sans accord, pas de métier ; audit du 29/09/2026 :
 *    la première version rangeait au rayon tout ce qui n'était pas confirmé en vente, dont 39 offres Rituals).
 * Les formes grammaticales d'un ancien nom (« Dependienta » pour « Dependiente ») suivent le verdict de leur nom : un
 * même nom ne se partage plus entre les deux métiers selon le genre (« Lucrător » / « Lucrătoare comercială »).
 * Entrées : étapes 3, 3b et 5, export des intitulés d'offres, référentiel du backend. Sortie :
 * `curation-v3/3c-scission-vente.json`, que lit l'assemblage, avec les verdicts de chaque juge. Échoue si un verdict manque.
 *
 *   node --env-file=<fichier .env portant GEMINI_API_KEY> --import tsx \
 *     apps/aggregator/scripts/taxonomie/curation/3c-scission-vente.mts
 */
import { writeFileSync } from 'node:fs';
import { backend, contexte, DOSSIER_SORTIE, lireEtape, lireIntitulesOffres, metiersServis, phraseMoteur } from './commun.mts';
import { consensusDetaille, JUGES } from './ia.mts';

const SOURCE = 'backend:EMPLOYE_DE_COMMERCE', VENTE = 'sales-advisor';
const METIER_VENTE = 'Conseiller de vente (vente en boutique) / Sales Advisor';
const METIER_RAYON = 'Employé de rayon (mise en rayon, grande distribution) / Shelf Replenisher';
const e3 = lireEtape('3-intitules-offres.json'), e3b = lireEtape('3b-garde-unicite.json');
const e5 = lireEtape('5-libelles.json').metiers.find((m: any) => m.cle === SOURCE);
const b = backend.metiers.find((m: any) => m.slug === 'EMPLOYE_DE_COMMERCE');
const vente = metiersServis.find((m) => m.key === VENTE)!;
const offres = new Map<string, any>(lireIntitulesOffres().intitules.map((x: any) => [x.intitule, x]));

type Element = { intitule: string; origine: 'offre' | 'nom'; formes: string[]; contexte?: string };
const elements = new Map<string, Element>();
// Un seul verdict par forme normalisée : un nom qui est aussi un intitulé d'offre (« lucrător comercial ») est jugé une
// fois, avec le contexte de l'offre, et garde ses formes grammaticales et son statut de nom (vocabulaire de recherche).
const ajouter = (intitule: string, origine: Element['origine'], formes: string[] = []) => {
  const f = phraseMoteur(intitule ?? '');
  if (!f) return;
  const deja = elements.get(f);
  if (deja) { deja.formes = [...new Set([...deja.formes, ...formes])]; if (origine === 'nom') deja.origine = 'nom'; return; }
  const o = origine === 'offre' ? offres.get(intitule) : undefined;
  elements.set(f, { intitule, origine, formes, ...(o ? { contexte: contexte(o) } : {}) });
};
for (const t of e3.intitules) if (t.concept === SOURCE) ajouter(t.intitule, 'offre');
for (const v of e3b.variantesAjoutees) if (v.concept === SOURCE) ajouter(v.intitule, 'offre');
for (const [l, libelle] of Object.entries<string>(e5?.libelles ?? {})) ajouter(libelle, 'nom', e5?.formes?.[l] ?? []);
for (const a of b?.aliases ?? []) ajouter(a, 'nom');
const liste = [...elements.values()];

const paires = (metier: string, alias: string[]) => liste.map((e) => ({ intitule: e.intitule, metier, alias, ...(e.contexte ? { contexte: e.contexte } : {}) }));
const [pourVente, pourRayon] = [await consensusDetaille(paires(METIER_VENTE, vente.aliases ?? [])), await consensusDetaille(paires(METIER_RAYON, []))];

const decisions = liste.map((e, n) => {
  const v = pourVente[n], r = pourRayon[n];
  const metier = v.verdict === 'indetermine' || r.verdict === 'indetermine' ? 'indetermine'
    : v.verdict === 'confirme' && r.verdict !== 'confirme' ? 'vente' : r.verdict === 'confirme' && v.verdict !== 'confirme' ? 'rayon' : 'aucun';
  return { ...e, forme: phraseMoteur(e.intitule), metier, juges: { vente: v.juges, rayon: r.juges } };
});
const de = (m: string) => decisions.filter((d) => d.metier === m);
const bilan = { elements: liste.length, vente: de('vente').length, rayon: de('rayon').length, aucun: de('aucun').length, sansVerdict: de('indetermine').length };
writeFileSync(`${DOSSIER_SORTIE}3c-scission-vente.json`, JSON.stringify({ calculeLe: new Date().toISOString(), juges: JUGES, source: SOURCE, cible: VENTE,
  metiersJuges: { vente: METIER_VENTE, rayon: METIER_RAYON }, bilan, decisions }, null, 1));
console.log(JSON.stringify(bilan));
for (const m of ['vente', 'rayon', 'aucun']) console.log(` ${m} : ${de(m).map((d) => d.intitule).join(' · ')}`);
if (bilan.sansVerdict) { console.error(`ÉTAPE INCOMPLÈTE : ${bilan.sansVerdict} intitulé(s) sans verdict`); process.exitCode = 1; }
