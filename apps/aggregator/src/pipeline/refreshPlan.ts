/**
 * LE PLANIFICATEUR DE REFRESH — une seule implémentation, lue par la prévisualisation ET par l'exécution.
 *
 * Deux implémentations indépendantes finiraient par diverger, et la divergence serait invisible : la
 * prévisualisation annoncerait un plan que le refresh n'exécute pas. C'est exactement ce qui a failli arriver —
 * ma première prévisualisation déduisait l'absence de `lastSeenAt < cutoff`, ce qui n'est PAS une preuve
 * d'absence mais une preuve de non-ré-attestation. Les deux se ressemblent, et une seule autorise à fermer.
 *
 * CE QUE « ABSENT » EXIGE ICI : l'identifiant ne figure PAS dans l'ensemble réellement observé par la dernière
 * énumération PROUVÉE de sa source. Cet ensemble est lu dans la preuve archivée
 * (`PipelineEvent.source.enumeration_observed`, champ `pageEvidence[].ids`), et il doit appartenir AU MÊME
 * CYCLE que le `SourceRun` retenu — la corrélation se fait par `runId`, jamais par proximité de date.
 *
 * Cinq états, et un seul autorise une fermeture par absence :
 *   · PRESENT_AND_REATTESTED        vu et ré-attesté : rien à faire
 *   · PRESENT_BUT_HELD              vu, mais retenu à la publication : surtout pas « absent »
 *   · PRESENT_BUT_WRITE_FAILED      vu, mais refusé à l'écriture (identité) : surtout pas « absent »
 *   · ABSENT_FROM_PROVEN_ENUMERATION  le seul qui prouve la disparition
 *   · UNVERIFIABLE                  la source n'archive pas ses identifiants, ou son énumération n'est pas
 *                                   prouvée : on ne peut rien conclure, donc on ne touche à rien
 */

/** Ce que la porte de recevabilité exige du dernier run d'une source. */
export type SourceRunFacts = {
  sourceKey: string;
  runId: string | null;
  status: string;
  errors: number | null;
  truncated: boolean | null;
  complete: boolean | null;
  canAttestAbsence: boolean | null;
  ranAt: Date;
};

/** La preuve d'énumération du MÊME cycle, avec les identifiants réellement observés. */
export type EnumerationEvidence = {
  sourceKey: string;
  runId: string | null;
  termination: string | null;
  observedIds: string[];
  /** La propriété `canonicalIds` est-elle déclarée par l'adaptateur ? Distinct de « le tableau est vide ». */
  declaresCanonical?: boolean;
  /** Vrai quand la preuve n'énumère aucun identifiant : on ne peut alors rien conclure d'une absence. */
  idsUnavailable: boolean;
};

export type Representation = {
  sourceKey: string;
  externalId: string;
  jobId: string;
  jobSourceId: string;
  lastSeenAt: Date;
  /** L'offre a-t-elle été retenue à la publication pendant ce cycle ? */
  held: boolean;
  /** L'écriture de cette offre a-t-elle échoué (refus d'identité) pendant ce cycle ? */
  writeFailed: boolean;
};

export type RepresentationState =
  | 'PRESENT_AND_REATTESTED'
  | 'PRESENT_BUT_HELD'
  | 'PRESENT_BUT_WRITE_FAILED'
  | 'ABSENT_FROM_PROVEN_ENUMERATION'
  | 'UNVERIFIABLE';

/** Les terminaisons qui DÉMONTRENT la fin du parcours (P4) — jamais un ratio. */
export const PROVING_TERMINATIONS: ReadonlySet<string> = new Set([
  'PUBLISHER_TOTAL_REACHED', 'SECOND_SWEEP_RECONCILED', 'FULL_RESPONSE', 'PARTITIONS_RECONCILED',
  'ALL_LOCALE_TOTALS_REACHED', 'ALL_LOCALES_COMPLETE', 'ALL_LISTED_PAGES_READ', 'FULL_XML_DOCUMENT',
  'ANNOUNCED_TOTAL_REACHED', 'ANNOUNCED_PAGE_COUNT_REACHED', 'DECLARED_TOTAL_REACHED', 'PUBLISHER_COUNT_REACHED',
  'PUBLISHER_TOTAL_ROWS_READ', 'SHORT_PAGE',
]);

/**
 * Une source est-elle autorisée à faire disparaître une offre qu'elle n'a pas revue ?
 *
 * Dérivé des FAITS du dernier run, jamais du statut `ACTIVE` du catalogue : le registre P6 a séparé « au
 * catalogue » de « a démontré son exhaustivité ».
 */
export function sourceEligibility(run: SourceRunFacts | undefined, evidence: EnumerationEvidence | undefined) {
  const reasons: string[] = [];
  if (!run) return { eligible: false, reasons: ['aucun run enregistré'] };
  if ((run.errors ?? 0) > 0) reasons.push(`errors = ${run.errors}`);
  if (run.truncated) reasons.push('truncated = true');
  if (run.complete !== true) reasons.push(`complete = ${run.complete}`);
  if (run.canAttestAbsence !== true) reasons.push(`canAttestAbsence = ${run.canAttestAbsence}`);
  if (!evidence) reasons.push('aucune preuve d\'énumération archivée');
  else {
    /**
     * LA CORRÉLATION PAR CYCLE, et elle n'est pas décorative : juxtaposer le dernier `SourceRun` avec une
     * ANCIENNE preuve d'énumération ferait fermer des offres sur la foi d'un balayage qui n'est pas celui-là.
     */
    if (evidence.runId !== run.runId) reasons.push(`preuve d'énumération d'un autre cycle (${evidence.runId} ≠ ${run.runId})`);
    if (!evidence.termination) reasons.push('terminaison absente');
    else if (!PROVING_TERMINATIONS.has(evidence.termination)) reasons.push(`terminaison non probante : ${evidence.termination}`);
    if (evidence.idsUnavailable) reasons.push(evidence.declaresCanonical === false
      ? 'l\'adaptateur n\'archive pas encore d\'identifiants canoniques : aucune absence n\'y est démontrable'
      : 'la preuve déclare des identifiants canoniques mais n\'en archive aucun : contrat rompu');
  }
  return { eligible: reasons.length === 0, reasons };
}

/**
 * L'état d'une représentation au regard de la dernière énumération prouvée de sa source.
 *
 * `observed` est l'ensemble RÉELLEMENT lu, pas une déduction de fraîcheur : c'est toute la différence entre
 * « la source ne l'a plus listée » et « notre run ne l'a pas ré-écrite ».
 */
/**
 * LES IDENTIFIANTS OBSERVÉS SONT-ILS COMPARABLES À CEUX STOCKÉS ?
 *
 * Le contrôle ne repose PAS sur un taux de recouvrement. Un ratio ne distingue pas « 20 % d'offres disparues »
 * de « 20 % d'identifiants cassés », et « un seul recouvrement suffit » laisserait passer 1 ancien format
 * contre 99 nouveaux — soit 99 fausses absences.
 *
 * La règle est structurelle et vient du contrat imposé à la source (`ats/canonicalIdContract.ts`) : chaque
 * offre STOCKÉE de cette source doit figurer dans l'ensemble observé, OU avoir une disposition nommée. Une
 * offre stockée que la preuve ne mentionne ni comme vue ni comme disposée signale que les deux chemins ne
 * produisent pas le même identifiant : on ne peut alors rien conclure.
 *
 * Le cas mesuré : `american-vintage-dr` archivait des diffusions (`4594925-72559621`) là où la base stocke des
 * annonces (`4459569`). AUCUNE des 37 offres stockées n'apparaissait — ce n'est pas 37 disparitions, c'est un
 * vocabulaire différent.
 */
export function identifiersComparable(
  observed: ReadonlySet<string>,
  stored: readonly string[],
  disposed: ReadonlySet<string> = new Set(),
): boolean {
  if (stored.length === 0) return false;
  if (observed.size === 0) return false;
  /**
   * Si AUCUNE offre stockée n'est ni observée ni disposée, l'ensemble observé ne décrit pas ce board : les
   * identifiants sont incomparables. Dès qu'une seule l'est, le vocabulaire est partagé et l'écart restant
   * s'interprète offre par offre — c'est là que le contrat de la source, lui, exige l'exhaustivité.
   */
  return stored.some((id) => observed.has(id) || disposed.has(id));
}

export function representationState(
  rep: Representation,
  observed: ReadonlySet<string> | null,
  sourceEligible: boolean,
): RepresentationState {
  if (!sourceEligible || observed === null) return 'UNVERIFIABLE';
  if (observed.has(rep.externalId)) {
    // Vue par le balayage. Si elle n'a pas été publiée, la cause est nommée — jamais « absente ».
    if (rep.writeFailed) return 'PRESENT_BUT_WRITE_FAILED';
    if (rep.held) return 'PRESENT_BUT_HELD';
    return 'PRESENT_AND_REATTESTED';
  }
  return 'ABSENT_FROM_PROVEN_ENUMERATION';
}

export type PlannedDeactivation = {
  jobSourceId: string; sourceKey: string; externalId: string; jobId: string;
  lastSeenAt: Date; state: RepresentationState; reason: string;
};

export type JobOutcome = 'JOB_KEPT_BY_ANOTHER_SOURCE' | 'JOB_CANDIDATE_FOR_CLOSURE';

/**
 * Le plan : quelles représentations sont désactivées, et quelles offres ferment RÉELLEMENT.
 *
 * La conséquence sur l'offre se calcule **après les seules désactivations prévues** — pas sur la fraîcheur des
 * autres sources. Une source active HORS du périmètre autorisé n'est jamais désactivée, donc elle maintient
 * l'offre ouverte, même si son `lastSeenAt` est ancien. C'était le second défaut de ma prévisualisation.
 */
export function planRefresh(
  representations: readonly Representation[],
  statesByJobSource: ReadonlyMap<string, RepresentationState>,
  activeByJob: ReadonlyMap<string, string[]>,
): { deactivations: PlannedDeactivation[]; jobs: Map<string, JobOutcome> } {
  const deactivations: PlannedDeactivation[] = [];
  for (const rep of representations) {
    const state = statesByJobSource.get(rep.jobSourceId);
    if (state !== 'ABSENT_FROM_PROVEN_ENUMERATION') continue;
    deactivations.push({
      jobSourceId: rep.jobSourceId, sourceKey: rep.sourceKey, externalId: rep.externalId, jobId: rep.jobId,
      lastSeenAt: rep.lastSeenAt, state,
      reason: `absent de l'ensemble réellement observé par la dernière énumération PROUVÉE de ${rep.sourceKey}`,
    });
  }
  const removed = new Set(deactivations.map((d) => d.jobSourceId));
  const jobs = new Map<string, JobOutcome>();
  for (const d of deactivations) {
    const survivors = (activeByJob.get(d.jobId) ?? []).filter((id) => !removed.has(id));
    jobs.set(d.jobId, survivors.length > 0 ? 'JOB_KEPT_BY_ANOTHER_SOURCE' : 'JOB_CANDIDATE_FOR_CLOSURE');
  }
  return { deactivations, jobs };
}
