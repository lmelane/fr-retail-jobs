/**
 * Les règles d'attribution d'un défaut de collecte, PURES : aucun client HTTP, navigateur ni stockage. Elles vivaient dans
 * `ingestionIssue.ts`, qui importe toute la chaîne de capture ; extraites telles quelles (D-522 §5) pour que l'état
 * opérationnel des sources (`pipeline/sourceState.ts`) se lise depuis l'API du catalogue sans embarquer le worker.
 * `ingestionIssue.ts` les réexporte : ses appelants n'ont pas changé.
 */
/** Attribution is independent of impact. Unknown is never accepted as upstream. */
export type IngestionIssue = {
  origin: 'SOURCE' | 'INTERNAL' | 'UNKNOWN';
  code: string;
  count: number;
  captureBatchId?: string;
  rawCaptureId?: string;
  /** Proof of a native-evidence retention (D-453 §1): the sealed end-of-ingestion report naming each HELD fate. */
  completionReportHash?: string;
  /** Le statut d'une `HttpStatusError` (`HTTP_406`) : sans lui, un échec connu décidé pour un statut couvrirait tous les autres. */
  detail?: string;
};

/** D-453 §1: postings retained on the publisher's own evidence. Visible, attributed to the source, not blocking. */
export const NATIVE_RETENTION = 'NATIVE_RETENTION';

/**
 * A SOURCE attribution stands only on its archived proof: the exact native response of a 5xx, or — for a
 * retention decided on native evidence (D-453 §1) — the sealed completion report of the admitted capture.
 * Only such an issue leaves the RUN healthy; every other issue blocks it.
 */
export function isProvenSourceIssue(issue: IngestionIssue): boolean {
  return issue.origin === 'SOURCE' && !!issue.captureBatchId &&
    (issue.code === NATIVE_RETENTION ? !!issue.completionReportHash : !!issue.rawCaptureId);
}

/**
 * D-480 §1 (arbitrage CEO du 30/09/2026) : huit sources NOMMÉES, et pour chacune son seul défaut décrit, sont des
 * échecs connus. Elles restent collectées et publient leurs offres ; une liste non prouvée ne ferme jamais d'offre ;
 * elles restent visibles au bilan et dans l'alerte, avec la décision, mais ne font plus échouer le RUN. Tout AUTRE
 * défaut de ces sources reste bloquant. Liste fermée : l'étendre est une décision du CEO, jamais une configuration.
 */
type KnownFailure = { code: string; detail?: string };
export const DECIDED_KNOWN_FAILURES: Readonly<Record<string, readonly KnownFailure[]>> = {
  // L'éditeur ne permet pas de prouver la liste complète. `ENUMERATION_UNPROVABLE` (D-520, 02/10/2026) nomme le MÊME défaut
  // quand le lecteur dit pourquoi (page d'accueil sans liste, flux RSS) ; pour toute source, c'est depuis D-520 §4 b une
  // limite connue (`isKnownListLimit`), et la décision D-480 reste celle que portent ces quatre sources.
  lumentee: [{ code: 'ENUMERATION_NOT_PROVEN' }, { code: 'ENUMERATION_UNPROVABLE' }],
  attaquer: [{ code: 'ENUMERATION_NOT_PROVEN' }, { code: 'ENUMERATION_UNPROVABLE' }],
  'kastner-ohler': [{ code: 'ENUMERATION_NOT_PROVEN' }, { code: 'ENUMERATION_UNPROVABLE' }],
  picard: [{ code: 'ENUMERATION_NOT_PROVEN' }, { code: 'ENUMERATION_UNPROVABLE' }],
  tapestry: [{ code: 'ENUMERATION_REFUTED' }, { code: 'ENUMERATION_NOT_PROVEN' }],
  'knitwell-us-retail': [{ code: 'ENUMERATION_REFUTED' }, { code: 'ENUMERATION_NOT_PROVEN' }],
  // L'éditeur bloque par sa limite de débit (réponse 406, et elle seule) ou vide ses offres (description « - »).
  'l-oreal-professionnel': [{ code: 'HttpStatusError', detail: 'HTTP_406' }],
  'on-running': [{ code: 'DESCRIPTION_COVERAGE_BELOW_FLOOR' }],
};
export const KNOWN_FAILURE_DECISION = 'D-480';

export function isDecidedKnownFailure(source: string, issue: Pick<IngestionIssue, 'code' | 'detail'>): boolean {
  return DECIDED_KNOWN_FAILURES[source]?.some(known => known.code === issue.code && (known.detail === undefined || known.detail === issue.detail)) ?? false;
}

/**
 * D-520 : une offre dont l'employeur n'est pas prouvé est retenue et rejoint la file de revue d'identité
 * (`identity/reviewQueue.ts`) avec la question à trancher ; ce refus n'est plus une panne du RUN. La source reste
 * classée IDENTITE_EMPLOYEUR (`pipeline/sourceState.ts`) jusqu'à la réponse, escaladée à l'échéance.
 */
export const IDENTITY_REVIEW_ISSUE = 'EmployerIdentityReviewRequired';
/** Le `detail` de l'issue d'identité d'une source qui ouvre une entrée de file dans cette collecte (garde IDENTITY_MASS). */
export const IDENTITY_NEW_ENTRY = 'NOUVELLE_ENTREE';
export function isQueuedIdentityIssue(issue: Pick<IngestionIssue, 'code'>): boolean {
  return issue.code === IDENTITY_REVIEW_ISSUE;
}

/**
 * D-520 §4 b (lecture D-492 « listes, volumes et lecteurs », 02/10/2026) : une liste que la famille de lecteur ne peut pas
 * démontrer (page d'accueil sans liste ni plan, flux RSS sans total : `ENUMERATION_UNPROVABLE`, posé par `health.ts` sur les
 * seuls motifs de `STRUCTURAL_LIMIT_MARKERS`, jamais à côté d'un autre défaut) est une LIMITE CONNUE ET CLASSÉE : elle ne
 * fait pas échouer le RUN, n'escalade pas à 14 jours (`sourceState.ts`), et n'autorise JAMAIS d'attestation d'absence (sa
 * collecte reste `complete: false`). La fraîcheur de ses offres passe par le plafond de 72 h et la sonde des liens (R-143 §2).
 */
export const KNOWN_LIST_LIMIT = 'ENUMERATION_UNPROVABLE';
export const KNOWN_LIST_LIMIT_DECISION = 'D-520 §4 b';
export function isKnownListLimit(issue: Pick<IngestionIssue, 'code'>): boolean {
  return issue.code === KNOWN_LIST_LIMIT;
}

/**
 * Ce qui ne fait pas échouer le RUN : une preuve native de la source (D-453 §1), un échec connu décidé (D-480 §1), un
 * employeur à identifier mis en file de revue (D-520), ou une liste indémontrable, limite connue (D-520 §4 b).
 */
export function isNonBlockingIssue(source: string, issue: IngestionIssue): boolean {
  return isProvenSourceIssue(issue) || isDecidedKnownFailure(source, issue) || isQueuedIdentityIssue(issue) || isKnownListLimit(issue);
}
