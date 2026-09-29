/**
 * PASSE DE CURATION v3, ÉTAPE 3b : GARDE D'UNICITÉ DES MÉTIERS NOUVEAUX VENUS DES OFFRES (plan
 * `docs/architecture/classification-metiers.md` §3.1 : aucune variante ne désigne deux concepts).
 *
 * L'étape 3 regroupe en métiers nouveaux des intitulés qu'aucun modèle n'a rattachés à un métier existant ; le
 * regroupement peut pourtant nommer un métier qui existe déjà (passe du 29/09/2026 : « Conseiller de vente » pour
 * « athlete iii », « Retoucheur » alors que « Retoucheur·se » est une variante de Couturier). Ici, chaque métier nouveau
 * est jugé par les deux juges contre ses 3 métiers existants les plus proches (`rapprocherDesExistants`) : confirmé
 * identique, ses intitulés deviennent des variantes de l'existant et il n'est pas créé. Étape séparée pour ne pas
 * rejouer les appels de l'étape 3 (la garde ne concerne que ses métiers nouveaux).
 *
 * Entrées : `3-intitules-offres.json` et les métiers de la v3 avant l'étape 3. Sortie : `3b-garde-unicite.json`, que
 * lisent les étapes suivantes à la place des métiers nouveaux de l'étape 3. L'étape échoue si un verdict manque.
 *
 *   node --env-file=<fichier .env portant GEMINI_API_KEY> --import tsx \
 *     apps/aggregator/scripts/taxonomie/curation/3b-garde-unicite.mts
 */
import { writeFileSync } from 'node:fs';
import { CACHE_VECTEURS, conceptsV3, DOSSIER_SORTIE, lireEtape } from './commun.mts';
import { JUGES, rapprocherDesExistants } from './ia.mts';

const etape3 = lireEtape('3-intitules-offres.json');
const existants = conceptsV3({ avecOffres: false });
const parCle = new Map(existants.map((c) => [c.cle, c]));
const rapprochements = await rapprocherDesExistants(etape3.nouveauxMetiers, existants, CACHE_VECTEURS);

const doublonsEvites = etape3.nouveauxMetiers.filter((m: any) => rapprochements.get(m.cle)!.existant)
  .map((m: any) => ({ groupe: `${m.fr} / ${m.en}`, cle: m.cle, existant: rapprochements.get(m.cle)!.existant, offres: m.offres, titres: m.titres }));
const indetermines = etape3.nouveauxMetiers.filter((m: any) => rapprochements.get(m.cle)!.indetermine).map((m: any) => m.cle);
const nouveauxMetiers = etape3.nouveauxMetiers.filter((m: any) => !rapprochements.get(m.cle)!.existant && !rapprochements.get(m.cle)!.indetermine);
const variantesAjoutees = doublonsEvites.flatMap((d: any) => d.titres.map((t: string) => ({ intitule: t, concept: d.existant, famille: parCle.get(d.existant)!.famille })));
const bilan = { metiersNouveauxAvant: etape3.nouveauxMetiers.length, doublonsEvites: doublonsEvites.length, indetermines: indetermines.length,
  metiersNouveauxApres: nouveauxMetiers.length, variantesAjoutees: variantesAjoutees.length };
writeFileSync(`${DOSSIER_SORTIE}3b-garde-unicite.json`, JSON.stringify({ calculeLe: new Date().toISOString(), juges: JUGES, bilan, doublonsEvites,
  indetermines, nouveauxMetiers, variantesAjoutees }, null, 1));
console.log(JSON.stringify(bilan, null, 1));
for (const d of doublonsEvites) console.log(` ${d.groupe} → ${d.existant} (${d.offres} offres)`);
if (indetermines.length) { console.error(`ÉTAPE INCOMPLÈTE : ${indetermines.length} métier(s) sans verdict d'unicité`); process.exitCode = 1; }
