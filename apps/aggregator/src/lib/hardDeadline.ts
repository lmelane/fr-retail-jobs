/**
 * L'ÉCHÉANCE FERME — celle qui coupe, par opposition à celle qu'on demande poliment.
 *
 * Le défaut, mesuré le 2026-09-13 pendant la vague 1 de P9 : `validate-candidate.mts` passait son échéance
 * DANS la configuration de l'adaptateur — `fetchAtsJobs(ats, { ...config, deadlineMs })`. C'est une échéance
 * **coopérative** : elle ne vaut que si l'adaptateur la lit, et `avature.ts` ne la lit pas.
 *
 * Sur `ralph-lauren-avature`, l'amorçage WAF a réussi en 7,5 s puis le processus est resté bloqué
 * **64 minutes** sans produire une ligne, alors que la ligne de commande portait `--deadline-ms=300000`.
 * La chaîne de certification entière était figée derrière lui, et rien ne l'aurait débloquée.
 *
 * *Une échéance qu'un appelé peut ignorer n'est pas une échéance : c'est une suggestion.*
 *
 * Ce module la rend ferme **du côté de l'appelant**, donc indépendante du bon vouloir de chaque adaptateur —
 * la même raison qui fait vivre la politesse réseau dans une porte partagée (D25) plutôt que dans 440
 * adaptateurs : un invariant qui dépend de la discipline de chaque appelé finit par être violé quelque part.
 *
 * Ce que ce module NE fait PAS : il n'interrompt pas le travail sous-jacent (JavaScript ne le permet pas pour
 * une promesse en vol). Il rend la main à l'appelant, qui peut alors échouer proprement. Un processus
 * ponctuel — un outil de validation, un maillon de chaîne — se termine ensuite ; c'est exactement le cas
 * d'usage visé, et il vaut mieux qu'un blocage indéfini.
 */

/** Le dépassement, distinct d'un échec de l'appelé : les deux envoient chercher des défauts différents. */
export class HardDeadlineError extends Error {
  constructor(readonly label: string, readonly ms: number) {
    super(`échéance ferme dépassée : ${label} n'a pas rendu la main en ${ms} ms`);
    this.name = 'HardDeadlineError';
  }
}

/**
 * Exécute `work`, et lève `HardDeadlineError` s'il n'a pas rendu la main dans `ms`.
 *
 * `label` nomme ce qu'on attendait (la clé de source, en pratique) : un blocage doit se diagnostiquer sur la
 * ligne d'erreur, pas se deviner en relisant l'ordre des étapes.
 */
export async function withHardDeadline<T>(ms: number, work: () => Promise<T>, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`échéance invalide pour ${label} : ${ms} ms — attendu un entier positif`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HardDeadlineError(label, ms)), ms);
        // Ne pas retenir la boucle d'événements pour une minuterie de garde : sans cela, un travail rapide
        // laisserait le processus vivant jusqu'à l'échéance — un défaut plus discret que celui qu'on corrige.
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
