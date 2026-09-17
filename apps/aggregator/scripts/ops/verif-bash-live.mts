/**
 * Contrôle de dérive du portail Ba&sh, contre la SOURCE RÉELLE (réseau requis).
 *
 * Les témoins de `bashTalents.test.ts` tournent sur des fixtures figées : ils prouvent que
 * le parseur fait ce qu'on attend d'un HTML DONNÉ, jamais que talents.ba-sh.com sert encore
 * ce HTML-là. Une refonte du portail les laisserait tous au vert pendant que la collecte
 * rendrait 0 offre — le mode de panne « BROKEN sans erreur » déjà vu sur ce projet.
 *
 * Ce programme appelle le vrai point d'entrée `fetchBashTalentsJobs` et vérifie ce que le
 * CANDIDAT doit obtenir : toutes les offres annoncées, leur lieu, leur contrat, leur lien,
 * leur description, et des dates de publication RÉELLES (le listing sert la date du jour
 * sur toutes les offres à la fois — mesuré le 2026-09-15 : 50/50 à « 15/09 » quand les
 * fiches portaient 01/09 → 14/09 ; c'est la fiche qui fait foi).
 *
 * Usage : npm run verif:bash-live
 * Sortie : code 1 si la source a dérivé. Réseau indisponible → code 2 (indéterminé, pas un échec).
 */
import { fetchBashTalentsJobs } from '../../src/ats/adapters/bashTalents.js';

/** Sous ce taux, la collecte est dégradée au point d'être inutile au candidat. */
const TAUX_MINIMAL = 0.9;
/** Une seule date distincte sur l'ensemble = le symptôme exact du défaut corrigé. */
const DATES_DISTINCTES_MINIMALES = 2;

let resultat;
try {
  resultat = await fetchBashTalentsJobs({ origin: 'https://talents.ba-sh.com', locale: 'fr-FR' });
} catch (error) {
  console.error(`INDETERMINE — source injoignable : ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}

const { jobs, declaredTotal, truncated } = resultat;
const taux = (predicat: (job: (typeof jobs)[number]) => unknown) =>
  jobs.length === 0 ? 0 : jobs.filter(predicat).length / jobs.length;

const datesDistinctes = new Set(jobs.map((job) => job.postedAt?.toISOString().slice(0, 10)).filter(Boolean));
const mesures = {
  declaredTotal,
  parsees: jobs.length,
  truncated,
  tauxLieu: taux((job) => job.location),
  tauxContrat: taux((job) => job.contract),
  tauxLien: taux((job) => job.url?.startsWith('https://talents.ba-sh.com/')),
  tauxDescription: taux((job) => (job.description?.length ?? 0) > 200),
  tauxDate: taux((job) => job.postedAt),
  datesDistinctes: datesDistinctes.size,
};
console.log(JSON.stringify(mesures, null, 2));

const derives: string[] = [];
if (jobs.length === 0) derives.push('aucune offre collectee (portail refondu, ou bloque)');
if (declaredTotal !== undefined && jobs.length < declaredTotal) {
  derives.push(`lecture incomplete : ${jobs.length} lues sur ${declaredTotal} annoncees`);
}
for (const [champ, valeur] of [
  ['lieu', mesures.tauxLieu], ['contrat', mesures.tauxContrat], ['lien', mesures.tauxLien],
  ['description', mesures.tauxDescription], ['date', mesures.tauxDate],
] as const) {
  if (valeur < TAUX_MINIMAL) derives.push(`${champ} : ${(valeur * 100).toFixed(0)} % (< ${TAUX_MINIMAL * 100} %)`);
}
// Le défaut du 2026-09-15 : toutes les offres à la même date — la fiche n'est plus lue.
if (jobs.length > 1 && datesDistinctes.size < DATES_DISTINCTES_MINIMALES) {
  derives.push(`une seule date de publication sur ${jobs.length} offres : la date du listing a repris le dessus`);
}

if (derives.length > 0) {
  console.error(`\n${derives.length} derive(s) :`);
  for (const derive of derives) console.error(`  - ${derive}`);
  process.exit(1);
}
console.log('\nSource conforme.');
