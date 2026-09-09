/**
 * L'aperçu d'une offre dans la liste : ce qui DISTINGUE ce poste des autres.
 *
 * Mesuré en prod le 2026-09-07 : **76,5 % des offres actives (53 465 / 69 930)
 * partageaient leur aperçu** avec une autre offre de la même Maison, parce que
 * l'aperçu prenait les 220 premiers caractères de la description — presque
 * toujours une présentation d'entreprise recopiée dans chaque annonce. Ulta
 * Beauty : 4 105 offres au même début ; Tapestry 1 143 ; Ralph Lauren 1 056.
 * Trois offres de suite affichaient « Coach est une maison de mode
 * internationale fondée à New York en 1941 » : le split-view perdait son objet,
 * la liste ne distinguant plus les postes.
 *
 * **Sauter le préambule ne suffit pas** : essayé et mesuré, la détection des
 * marqueurs de section (« MISSIONS », « RESPONSIBILITIES »… présents dans 64 %
 * des descriptions) ne faisait passer la duplication que de 76,5 % à 75,9 %,
 * en coupant au milieu de phrases (« is responsible for… », « & SCOPE »).
 * Piste abandonnée sur preuve.
 *
 * Ce qui distingue réellement deux offres est **structuré**, pas rédigé — et
 * bien mieux rempli que la description : séniorité 100 %, ville 98 %, date
 * 94 %, métier 93 %, contrat 33 %. C'est cela qu'on affiche.
 */

import { UNCLASSIFIED_LABEL } from '@/lib/intelligence/taxonomy';

export type PreviewFields = {
  jobFunction?: string | null;
  occupationLabel?: string | null;
  occupationFamilyLabel?: string | null;
  seniority?: string | null;
  seniorityLabel?: string | null;
  department?: string | null;
};

/**
 * La ligne distinctive : métier · séniorité · département.
 *
 * `null` plutôt qu'une ligne vide — une carte sans cette information reste
 * lisible (Maison, titre, ville, contrat, date sont au-dessus).
 */
export function jobFacets(job: PreviewFields): string | null {
  const fnLabel = job.occupationLabel ?? job.occupationFamilyLabel ?? null;
  const fn = fnLabel && fnLabel !== UNCLASSIFIED_LABEL ? fnLabel : null;
  const senLabel = job.seniorityLabel ?? null;
  const sen = senLabel && senLabel !== UNCLASSIFIED_LABEL ? senLabel : null;
  // Le département n'est utile que s'il n'est pas la redite du métier.
  const dept = job.department?.trim();
  const deptUseful = dept && dept.length > 1 && dept.length < 40 && dept.toLowerCase() !== fn?.toLowerCase() ? dept : null;

  const parts = [fn, sen, deptUseful].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(' · ') : null;
}
