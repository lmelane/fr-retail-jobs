/**
 * LE PLANIFICATEUR DE REFRESH — une seule implémentation, lue par la prévisualisation ET par l'exécution.
 *
 * Deux implémentations indépendantes finiraient par diverger, et la divergence serait invisible : la
 * prévisualisation annoncerait un plan que le refresh n'exécute pas. C'est exactement ce qui a failli arriver —
 * ma première prévisualisation déduisait l'absence de `lastSeenAt < cutoff`, ce qui n'est PAS une preuve
 * d'absence mais une preuve de non-ré-attestation. Les deux se ressemblent, et une seule autorise à fermer.
 *
 * CE QUE « ABSENT » EXIGE ICI : l'identifiant ne figure PAS dans l'ensemble réellement observé par la dernière
 * énumération PROUVÉE de sa source. Cet ensemble est lu dans le manifeste SCELLÉ de la capture attestante
 * (`pipeline/attestingCapture.ts`, champ `enumeration.pageEvidence[].canonicalIds`), et il appartient par
 * construction à la même collecte que les faits — jamais à un run voisin, jamais à un journal.
 *
 * Sept états, et un seul autorise une fermeture par absence :
 *   · PRESENT_AND_REATTESTED        vue et ré-attestée : rien à faire
 *   · PRESENT_BUT_HELD              vue, mais retenue à la publication : surtout pas « absent »
 *   · PRESENT_BUT_WRITE_FAILED      vue, mais refusée à l'écriture (identité) : surtout pas « absent »
 *   · PRESENT_BUT_REJECTED          vue, mais refusée par l'adaptateur : surtout pas « absent »
 *   · PRESENT_BUT_SKIPPED           vue, mais écartée par le filtre sectoriel : l'employeur la publie toujours
 *   · ABSENT_FROM_PROVEN_ENUMERATION  le seul qui prouve la disparition
 *   · UNVERIFIABLE                  la source n'archive pas ses identifiants, ou son énumération n'est pas
 *                                   prouvée, ou sa collecte ne peut plus publier : on ne touche à rien
 */

/** Les faits d'attestation, dérivés du manifeste scellé et du rapport de fin d'ingestion d'UNE capture. */
export type AttestationFacts = {
  sourceKey: string;
  captureBatchId: string;
  startedAt: Date;
  /** Projection de santé pertinente pour le droit d'attester ; voir `attestingCapture.ts`. */
  status: 'OK' | 'DEGRADED' | 'BROKEN' | 'NEW';
  /** Échecs d'écriture et lignes illisibles de cette collecte. */
  errors: number;
  truncated: boolean;
  complete: boolean | null;
  declaredTotal: number | null;
  fetched: number;
  published: number;
  /** Ce que la dernière collecte PRODUCTIVE précédente de cette source avait publié ; null sans passé. */
  previous: number | null;
  canAttestAbsence: boolean;
};

/**
 * La preuve d'énumération de la MÊME collecte, avec les identifiants réellement observés.
 *
 * TROIS NOTIONS SÉPARÉES, et la cardinalité n'en décide AUCUNE. Les confondre créait une contradiction :
 * un board réellement vide, dont la terminaison est démontrée, était traité comme un contrat rompu — alors
 * que « la source ne publie plus rien » est une preuve parfaitement valide, et même la seule qui justifie de
 * fermer tout un board.
 */
export type EnumerationEvidence = {
  sourceKey: string;
  captureBatchId: string;
  termination: string | null;
  /** L'ensemble observé. Vide est une VALEUR légitime, pas une indisponibilité. */
  canonicalSet: string[];
  /**
   * L'adaptateur DÉCLARE-t-il le contrat canonique sur TOUTES les pages du parcours ?
   *
   * Une déclaration partielle (certaines pages seulement) n'est pas un contrat : les pages muettes peuvent
   * porter des offres qu'on prendrait alors pour disparues. Elle vaut donc contrat ROMPU, jamais contrat
   * complet.
   */
  canonicalContractDeclared: boolean;
  /** Le contrat est déclaré mais violé — l'adaptateur l'a dit lui-même (`CANONICAL_ID_CONTRACT_BROKEN`). */
  canonicalContractBroken: boolean;
  /**
   * L'adaptateur a-t-il observé des lignes SANS identifiant canonique exploitable ?
   *
   * `false` signifie : « le parcours est peut-être complet, mais un identifiant historique disparu pourrait
   * être l'une de ces lignes anonymes ». Le parcours et l'exploitabilité de la preuve sont deux propriétés
   * distinctes — la première peut être vraie quand la seconde est fausse (ligne Workday sans `externalPath`).
   * `undefined` = l'adaptateur ne se prononce pas, on ne présume rien de défavorable.
   */
  canonicalAbsenceProofUsable?: boolean;
};

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Decode only the observed posting IDs from sealed adapter metadata. Listing/page IDs are not posting IDs. */
export function enumerationEvidence(sourceKey: string, captureBatchId: string, metadata: unknown): EnumerationEvidence {
  const enumeration = object(object(metadata)?.enumeration);
  const pages = Array.isArray(enumeration?.pageEvidence) ? enumeration.pageEvidence : [];
  const ids: string[] = [];
  let declared = pages.length > 0;
  for (const page of pages) {
    const values = object(page)?.canonicalIds;
    if (!Array.isArray(values) || values.some(id => typeof id !== 'string' || !id.trim())) declared = false;
    else ids.push(...values);
  }
  const issues = enumeration?.issues;
  return { sourceKey, captureBatchId,
    termination: typeof enumeration?.termination === 'string' ? enumeration.termination : null,
    canonicalSet: [...new Set(ids)], canonicalContractDeclared: declared,
    canonicalContractBroken: Array.isArray(issues) && issues.includes('CANONICAL_ID_CONTRACT_BROKEN'),
    canonicalAbsenceProofUsable: enumeration?.canonicalAbsenceProofUsable !== false,
  };
}

export type Representation = {
  sourceKey: string;
  externalId: string;
  jobId: string | null;
  jobSourceId: string;
  lastSeenAt: Date;
  /** L'offre a-t-elle été retenue à la publication pendant cette collecte ? */
  held: boolean;
  /** L'écriture de cette offre a-t-elle échoué (refus d'identité) pendant cette collecte ? */
  writeFailed: boolean;
  /** L'adaptateur a-t-il REFUSÉ cette ligne (titre manquant, URL incohérente…) tout en l'observant ? */
  rejected?: boolean;
  /** Le filtre sectoriel a-t-il écarté cette ligne observée sans l'écrire ? */
  skipped?: boolean;
};

export type RepresentationState =
  | 'PRESENT_AND_REATTESTED'
  | 'PRESENT_BUT_HELD'
  | 'PRESENT_BUT_WRITE_FAILED'
  /**
   * VUE par le balayage, mais refusée par l'adaptateur lui-même (titre manquant, URL incohérente…).
   *
   * L'essentiel : ce n'est PAS une absence. L'identifiant est là, la source publie toujours la ligne — c'est
   * nous qui n'avons pas su en faire une offre. La présenter comme « ré-attestée » serait faux aussi : rien
   * n'a été écrit. Cet état ne désactive rien, ne ferme rien, et conserve le motif du rejet.
   */
  | 'PRESENT_BUT_REJECTED'
  | 'PRESENT_BUT_SKIPPED'
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
 * Dérivé des FAITS de sa capture attestante, jamais du statut `ACTIVE` du catalogue ni d'un compteur de santé :
 * « au catalogue » et « a démontré son exhaustivité » sont deux propriétés distinctes.
 */
export function sourceEligibility(facts: AttestationFacts | undefined, evidence: EnumerationEvidence | undefined) {
  const reasons: string[] = [];
  if (!facts) return { eligible: false, reasons: ['aucune collecte admise, scellée et achevée'] };
  if (!['OK', 'DEGRADED'].includes(facts.status)) reasons.push(`statut non probant : ${facts.status}`);
  if (facts.errors > 0) reasons.push(`errors = ${facts.errors}`);
  if (facts.truncated) reasons.push('truncated = true');
  if (facts.complete !== true) reasons.push(`complete = ${facts.complete}`);
  if (facts.canAttestAbsence !== true) reasons.push(`canAttestAbsence = ${facts.canAttestAbsence}`);
  if (!evidence) reasons.push('aucune preuve d\'énumération scellée');
  else {
    if (evidence.sourceKey !== facts.sourceKey) reasons.push('preuve d’une autre source');
    /**
     * LA CORRÉLATION PAR COLLECTE, et elle n'est pas décorative : juxtaposer des faits avec une preuve
     * d'énumération d'une AUTRE capture ferait fermer des offres sur la foi d'un balayage qui n'est pas celui-là.
     */
    if (evidence.captureBatchId !== facts.captureBatchId) reasons.push(`preuve d'énumération d'une autre collecte (${evidence.captureBatchId} ≠ ${facts.captureBatchId})`);
    if (!evidence.termination) reasons.push('terminaison absente');
    else if (!PROVING_TERMINATIONS.has(evidence.termination)) reasons.push(`terminaison non probante : ${evidence.termination}`);
    /**
     * LA DISPONIBILITÉ DU CONTRAT NE SE LIT PAS SUR LA TAILLE DE L'ENSEMBLE.
     *
     * `canonicalSet` vide est une valeur légitime : un board réellement vide, dont la terminaison est
     * démontrée, PROUVE que plus rien n'y est publié. C'est même la seule preuve qui justifie de fermer tout
     * un board. Seule l'absence — ou la rupture — du CONTRAT rend une absence indémontrable.
     */
    if (!evidence.canonicalContractDeclared) {
      reasons.push('l\'adaptateur ne déclare pas le contrat canonique sur tout le parcours : aucune absence n\'y est démontrable');
    } else if (evidence.canonicalContractBroken) {
      reasons.push('contrat canonique déclaré mais rompu : la preuve ne décrit pas ce que la source a écrit');
    } else if (evidence.canonicalAbsenceProofUsable === false) {
      reasons.push('des lignes observées n\'ont aucun identifiant canonique : une absence pourrait être l\'une '
        + 'd\'elles, donc aucune ne peut être prouvée pour cette collecte');
    }
  }
  return { eligible: reasons.length === 0, reasons };
}

/**
 * L'état d'une représentation au regard de la dernière énumération prouvée de sa source.
 *
 * `observed` est l'ensemble RÉELLEMENT lu, pas une déduction de fraîcheur : c'est toute la différence entre
 * « la source ne l'a plus listée » et « notre run ne l'a pas ré-écrite ».
 */
/** Conservative mismatch detector: zero overlap cannot support closing stored IDs.
 * One overlap does not prove identifier stability; the adapter's qualified ID
 * contract and complete enumeration supply that separate guarantee. */
export function identifiersComparable(
  observed: ReadonlySet<string>,
  stored: readonly string[],
  disposed: ReadonlySet<string> = new Set(),
): boolean {
  if (stored.length === 0) return false;
  if (observed.size === 0) return false;
  return stored.some((id) => observed.has(id) || disposed.has(id));
}

export function representationState(
  rep: Representation,
  observed: ReadonlySet<string> | null,
  sourceEligible: boolean,
): RepresentationState {
  if (!sourceEligible || observed === null) return 'UNVERIFIABLE';
  if (rep.writeFailed) return 'PRESENT_BUT_WRITE_FAILED';
  if (rep.held) return 'PRESENT_BUT_HELD';
  if (rep.rejected) return 'PRESENT_BUT_REJECTED';
  if (rep.skipped) return 'PRESENT_BUT_SKIPPED';
  if (observed.has(rep.externalId)) return 'PRESENT_AND_REATTESTED';
  return 'ABSENT_FROM_PROVEN_ENUMERATION';
}

export type PlannedDeactivation = {
  jobSourceId: string; sourceKey: string; externalId: string; jobId: string | null;
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
    if (!d.jobId) continue;
    const survivors = (activeByJob.get(d.jobId) ?? []).filter((id) => !removed.has(id));
    jobs.set(d.jobId, survivors.length > 0 ? 'JOB_KEPT_BY_ANOTHER_SOURCE' : 'JOB_CANDIDATE_FOR_CLOSURE');
  }
  return { deactivations, jobs };
}
