/**
 * PASSE DE CURATION v3, ÉTAPE 3c : LA VENTE EN BOUTIQUE ET LA MISE EN RAYON (D-475 §35, arbitrage du CEO du 29/09/2026).
 *
 * « Employé de commerce » (backend) mêlait la vente en boutique (« Dependiente », « Addetto alle vendite », « 販売スタッフ »)
 * et la mise en rayon de la grande distribution (« Employée de rayon crèmerie ») ; dans plusieurs langues il portait le
 * même mot que « Conseiller de vente ». Ici, chaque intitulé et chaque alias rattaché à « Employé de commerce » est jugé
 * par les deux juges contre « Conseiller de vente » (avec ses alias) : confirmé, il rejoint « Conseiller de vente » ;
 * sinon il reste au métier, renommé « Employé de rayon » dans chaque langue par l'étape 5b (fichier `5b-fautes-audit.json`).
 * Les anciens noms du métier (étape 5, avant renommage : « Dependiente », « Verkäufer », « 販売スタッフ ») sont jugés aussi :
 * le renommage les retire des libellés, et sans ce jugement ils ne classeraient plus aucune offre.
 * Entrées : étapes 3, 3b et 5, référentiel du backend. Sortie : `curation-v3/3c-scission-vente.json`, que lit l'assemblage.
 * L'étape échoue si un verdict manque.
 *
 *   node --env-file=<fichier .env portant GEMINI_API_KEY> --import tsx \
 *     apps/aggregator/scripts/taxonomie/curation/3c-scission-vente.mts
 */
import { writeFileSync } from 'node:fs';
import { backend, DOSSIER_SORTIE, lireEtape, metiersServis, phraseMoteur } from './commun.mts';
import { consensus, JUGES } from './ia.mts';

const SOURCE = 'backend:EMPLOYE_DE_COMMERCE', CIBLE = 'sales-advisor';
const e3 = lireEtape('3-intitules-offres.json'), e3b = lireEtape('3b-garde-unicite.json');
const e5 = lireEtape('5-libelles.json').metiers.find((m: any) => m.cle === SOURCE);
const b = backend.metiers.find((m: any) => m.slug === 'EMPLOYE_DE_COMMERCE');
const cible = metiersServis.find((m) => m.key === CIBLE)!;
const intitules = [...new Set([
  ...e3.intitules.filter((t: any) => t.concept === SOURCE).map((t: any) => t.intitule),
  ...e3b.variantesAjoutees.filter((v: any) => v.concept === SOURCE).map((v: any) => v.intitule),
  ...(b?.aliases ?? []),
  ...Object.values<string>(e5?.libelles ?? {}), ...Object.values<string[]>(e5?.formes ?? {}).flat(),
].filter(Boolean))];
const verdicts = await consensus(intitules.map((t) => ({ intitule: t, metier: `${cible.labels.fr} / ${cible.labels.en}`, alias: cible.aliases })));
const deplaces = intitules.filter((_, n) => verdicts[n] === 'confirme');
const restent = intitules.filter((_, n) => verdicts[n] === 'rejete');
const sansVerdict = intitules.filter((_, n) => verdicts[n] === 'indetermine');
writeFileSync(`${DOSSIER_SORTIE}3c-scission-vente.json`, JSON.stringify({ calculeLe: new Date().toISOString(), juges: JUGES, source: SOURCE, cible: CIBLE,
  bilan: { intitules: intitules.length, versConseillerDeVente: deplaces.length, restentEmployeDeRayon: restent.length, sansVerdict: sansVerdict.length },
  deplaces: deplaces.map((t) => ({ intitule: t, forme: phraseMoteur(t) })), restent, sansVerdict }, null, 1));
console.log(JSON.stringify({ intitules: intitules.length, versConseillerDeVente: deplaces.length, restent: restent.length, sansVerdict: sansVerdict.length }));
console.log(' vers conseiller de vente :', deplaces.join(' · '));
console.log(' restent (employé de rayon) :', restent.join(' · '));
if (sansVerdict.length) { console.error(`ÉTAPE INCOMPLÈTE : ${sansVerdict.length} intitulé(s) sans verdict`); process.exitCode = 1; }
