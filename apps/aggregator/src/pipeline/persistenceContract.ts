/**
 * LE CONTRAT DE PERSISTANCE — ce que le CYCLE a réellement écrit, comparé à ce qu'il a observé.
 *
 * Le contrat d'adaptateur (`ats/canonicalIdContract.ts`) démontre « sortie de l'adaptateur ↔ preuve
 * d'énumération ». Il ne dit RIEN de ce qui existe en base : l'écriture peut encore refuser une ligne
 * (identité), la retenir, ou échouer. Ce module ferme cet écart, au niveau du cycle et par IDENTIFIANT.
 *
 * L'INVARIANT :
 *
 *   canonicalObservedIds =
 *     persistedJobSourceExternalIds ∪ heldIds ∪ writeFailedIds ∪ rejectedIds ∪ collectionErrorIds
 *
 * Les deux inclusions comptent, et pour des raisons différentes :
 *  · un identifiant OBSERVÉ qui n'est ni persisté ni disposé est un trou : on ignore ce qu'il est devenu, donc
 *    on ne peut rien conclure d'une absence sur cette source ;
 *  · un identifiant PERSISTÉ que la preuve n'a pas observé signifie que les deux chemins ne produisent pas le
 *    même identifiant — il paraîtrait absent au refresh suivant, et serait fermé à tort.
 *
 * TOUT EST CORRÉLÉ AU MÊME `runId`. Une retenue historique n'est pas une retenue de ce cycle : la réutiliser
 * ferait passer pour « vue et retenue » une offre que ce cycle n'a jamais rencontrée.
 */

export type CycleSets = {
  sourceKey: string;
  runId: string;
  /** Les identifiants canoniques archivés par la preuve d'énumération de CE cycle. */
  canonicalObservedIds: readonly string[];
  /** Les `JobSource.externalId` réellement actifs après ce cycle. */
  persistedJobSourceExternalIds: readonly string[];
  /** Retenues de CE cycle — jamais une retenue historique déjà levée. */
  heldIds: readonly string[];
  /** Échecs d'écriture de CE cycle, lus dans la colonne `PipelineEvent.jobId`. */
  writeFailedIds: readonly string[];
  /** Lignes refusées par l'adaptateur, avec un identifiant exploitable. */
  rejectedIds: readonly string[];
  /** Lignes dont la collecte a échoué (détail illisible, page en erreur). */
  collectionErrorIds: readonly string[];
  /**
   * Des événements `job.write_failed` de ce cycle n'ont PAS pu être rattachés à un identifiant.
   *
   * On ne présume alors jamais « zéro échec » : la source devient invérifiable pour ce cycle, car un
   * identifiant historique disparu pourrait être l'un de ces échecs anonymes.
   */
  unattributableWriteFailures: number;
};

export type PersistenceVerdict = {
  satisfied: boolean;
  /** La source peut-elle prouver une absence à l'issue de ce cycle ? */
  absenceProvable: boolean;
  violations: string[];
  observedNotAccountedFor: string[];
  persistedNotObserved: string[];
};

/** Combien d'identifiants sont nommés au plus : au-delà, le rapport devient illisible. */
const MAX_NAMED = 100;

export function persistenceContract(sets: CycleSets): PersistenceVerdict {
  const violations: string[] = [];
  const observed = new Set(sets.canonicalObservedIds);
  const accounted = new Set([
    ...sets.persistedJobSourceExternalIds, ...sets.heldIds, ...sets.writeFailedIds,
    ...sets.rejectedIds, ...sets.collectionErrorIds,
  ]);

  // Sens 1 — tout ce qui a été VU doit avoir une suite connue.
  const observedNotAccountedFor = [...observed].filter((id) => !accounted.has(id));
  if (observedNotAccountedFor.length) {
    violations.push(`${observedNotAccountedFor.length} identifiant(s) observé(s) sans devenir connu : `
      + observedNotAccountedFor.slice(0, 5).join(', '));
  }

  // Sens 2 — tout ce qui EXISTE en base doit avoir été vu par la preuve de ce cycle.
  const persistedNotObserved = sets.persistedJobSourceExternalIds.filter((id) => !observed.has(id));
  if (persistedNotObserved.length) {
    violations.push(`${persistedNotObserved.length} JobSource active(s) absente(s) de la preuve : `
      + persistedNotObserved.slice(0, 5).join(', '));
  }

  /**
   * Un échec non rattachable ne se compte pas comme zéro. Il ne rompt pas l'égalité des ensembles — il n'a
   * pas d'identifiant à y placer — mais il retire le droit de prouver une absence : la ligne disparue
   * pourrait être précisément celle dont l'écriture a échoué anonymement.
   */
  const anonymousFailures = sets.unattributableWriteFailures > 0;
  if (anonymousFailures) {
    violations.push(`${sets.unattributableWriteFailures} échec(s) d'écriture non rattachable(s) à un identifiant`);
  }

  return {
    satisfied: violations.length === 0,
    absenceProvable: violations.length === 0,
    violations,
    observedNotAccountedFor: observedNotAccountedFor.slice(0, MAX_NAMED),
    persistedNotObserved: persistedNotObserved.slice(0, MAX_NAMED),
  };
}
