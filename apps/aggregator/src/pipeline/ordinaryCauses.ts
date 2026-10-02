/**
 * D-520, critère 3 et 4 — LES CAUSES ORDINAIRES ET LEUR TRAJECTOIRE.
 *
 * « Les problèmes ordinaires pourront être absorbés sans intervention permanente ; les exceptions nécessitant
 * réellement un humain seront clairement identifiées. » Chaque issue d'une source (`IngestionIssue`, telle que le RUN
 * la classe) reçoit ici UNE cause du catalogue et UNE trajectoire, avec ce qui la fait revenir ou ce qui est attendu
 * d'un humain. Le catalogue est mesuré sur les 8 RUN du 24/09 au 01/10/2026 (`audits/2026-10-02/remediation-auto/`).
 *
 * LA RÈGLE, UNE SEULE POUR TOUTES LES CAUSES QUI NE DEMANDENT PAS D'EMBLÉE UN HUMAIN : elle revient seule une fois ;
 * présente aussi au RUN complet précédent pour la même source, elle n'est plus ordinaire et passe « à réparer ».
 * Mesuré : les échecs internes passagers (capture indisponible, base) disparaissent au RUN suivant 15 fois sur 15 ;
 * ce qui persiste deux RUN (Avature 406, PVH et Estée Lauder rejetées, Ralph Lauren « fetch failed ») a tenu 5 à 7 RUN.
 *
 * Ce module ne décide ni de publier, ni de fermer, ni de bloquer : il NOMME. La seule action automatique qu'il
 * commande est la reprise unique dans le RUN (`RUN_RETRY`, `ingestOrchestrator.ts`), réservée aux causes passagères
 * dont une seconde lecture ne coûte rien à l'éditeur. Un refus de l'éditeur (403, 406, 429, anti-robot) n'est jamais
 * repris dans le même RUN : relire aussitôt un hôte qui refuse aggrave le refus (D-516 §2).
 *
 * À RELIER : le vocabulaire d'état des sources de D-520 §2 (module d'état opérationnel, en construction par ailleurs)
 * doit reprendre ces trajectoires telles quelles plutôt qu'en définir de nouvelles.
 */
import { isDecidedKnownFailure, NATIVE_RETENTION, type IngestionIssue } from '../lib/ingestionIssue.js';

/** Où va la source, et qui la ramène. */
export type Trajectory =
  /** Rien d'anormal : une retenue prouvée par la source elle-même (D-453 §1). */
  | 'NORMALE'
  /** Elle revient sans personne : par la reprise du RUN, la requalification du RUN, ou le RUN suivant. */
  | 'REVIENT_SEULE'
  /** Quelque chose est à réparer (lecteur, code, budget) : un développement est attendu. */
  | 'A_REPARER'
  /** Une revue ou une décision humaine est attendue (identité, accès refusé, nouveau périmètre). */
  | 'REVUE_HUMAINE'
  /** Échec connu et décidé (D-480 §1) : visible, non bloquant, rien n'est attendu tant que la décision tient. */
  | 'DECIDEE';

/** Le moyen par lequel une cause qui revient seule revient. */
export type Means = 'RUN_RETRY' | 'REQUALIFICATION' | 'NEXT_RUN' | null;

export type Cause =
  | 'NATIVE_RETENTION'
  | 'TRANSIENT_CAPTURE' | 'TRANSIENT_DATABASE' | 'TRANSIENT_NETWORK'
  | 'TIMEOUT'
  | 'ACCESS_RENEWAL' | 'SCOPE_OUTGROWN' | 'ACCESS_DENIED'
  | 'PUBLISHER_REFUSAL'
  | 'QUALIFICATION_REJECTED'
  | 'ENUMERATION_INCOMPLETE'
  | 'HEALTH_REGRESSION'
  | 'IDENTITY_REVIEW'
  | 'CODE_DEFECT'
  | 'UNCLASSIFIED';

type Entry = { trajectory: Trajectory; means: Means; label: string; expected: string; escalation?: { trajectory: Trajectory; expected: string } };

/** Une cause ordinaire qui persiste au RUN complet suivant n'est plus ordinaire : elle passe à réparer. */
const persistent = (expected: string) => ({ trajectory: 'A_REPARER' as const, expected });

/** LE CATALOGUE. Un ajout ici est la seule façon d'enseigner une cause nouvelle au système. */
export const CAUSES: Readonly<Record<Cause, Entry>> = {
  NATIVE_RETENTION: { trajectory: 'NORMALE', means: null, label: 'retenue prouvée par la source',
    expected: 'rien : les offres retenues le sont sur la preuve de l’éditeur (D-453 §1)' },
  TRANSIENT_CAPTURE: { trajectory: 'REVIENT_SEULE', means: 'RUN_RETRY', label: 'capture native indisponible',
    expected: 'rien : une reprise dans le RUN, puis le RUN suivant',
    escalation: persistent('vérifier le stockage des captures (écriture des réponses natives) : la panne a tenu deux RUN') },
  TRANSIENT_DATABASE: { trajectory: 'REVIENT_SEULE', means: 'RUN_RETRY', label: 'base de données indisponible ou lente',
    expected: 'rien : une reprise dans le RUN, puis le RUN suivant',
    escalation: persistent('vérifier la base (verrous, délais de transaction) : la panne a tenu deux RUN') },
  TRANSIENT_NETWORK: { trajectory: 'REVIENT_SEULE', means: 'RUN_RETRY', label: 'réseau ou serveur de l’éditeur passager',
    expected: 'rien : une reprise dans le RUN, puis le RUN suivant',
    escalation: persistent('enquêter le transport vers cet hôte (DNS, TLS, refus de connexion, 5xx) : la panne a tenu deux RUN') },
  TIMEOUT: { trajectory: 'REVIENT_SEULE', means: 'NEXT_RUN', label: 'délai de la source dépassé',
    expected: 'rien : le RUN suivant la relit, ses offres restent ouvertes (L-01)',
    escalation: persistent('revoir le budget ou le lecteur de la source : deux RUN coupés de suite') },
  ACCESS_RENEWAL: { trajectory: 'REVIENT_SEULE', means: 'REQUALIFICATION', label: 'décision d’accès à renouveler',
    expected: 'rien : le RUN (ou une collecte ciblée) refait la qualification native et redérive l’accès sur une capture fraîche',
    escalation: persistent('la requalification automatique échoue deux RUN de suite : lire son motif (`source.access_qualification_started`)') },
  SCOPE_OUTGROWN: { trajectory: 'REVIENT_SEULE', means: 'REQUALIFICATION', label: 'requête hors du périmètre qualifié',
    expected: 'rien : la qualification du RUN suivant redérive le périmètre de sa capture du jour',
    escalation: { trajectory: 'REVUE_HUMAINE', expected: 'relire le nouveau périmètre de la source : il n’a pas pu être redérivé deux RUN de suite' } },
  ACCESS_DENIED: { trajectory: 'REVUE_HUMAINE', means: null, label: 'refus d’accès explicite en vigueur',
    expected: 'une décision humaine : lever le refus par une nouvelle revue d’accès, ou retirer la source' },
  PUBLISHER_REFUSAL: { trajectory: 'REVIENT_SEULE', means: 'NEXT_RUN', label: 'refus de l’éditeur (403, 406, 429, anti-robot)',
    expected: 'rien : jamais relu dans le même RUN ; le RUN suivant réessaie',
    escalation: persistent('enquêter le refus (limite de débit, anti-robot, adresse) : il a tenu deux RUN (D-516 §2)') },
  QUALIFICATION_REJECTED: { trajectory: 'REVIENT_SEULE', means: 'NEXT_RUN', label: 'capture de qualification rejetée par sa validation',
    expected: 'rien d’abord : le RUN suivant refait la capture',
    escalation: persistent('réparer le lecteur : sa capture est rejetée deux RUN de suite (motifs dans `SourceValidation.report`)') },
  ENUMERATION_INCOMPLETE: { trajectory: 'REVIENT_SEULE', means: 'NEXT_RUN', label: 'liste incomplète ou non prouvée',
    expected: 'rien d’abord : aucune offre n’est fermée sur une liste non prouvée',
    escalation: persistent('réparer la lecture de la liste : incomplète deux RUN de suite') },
  HEALTH_REGRESSION: { trajectory: 'REVIENT_SEULE', means: 'NEXT_RUN', label: 'régression de volume ou de champs',
    expected: 'rien d’abord : 39 régressions sur 57 ont disparu au RUN suivant (mesure du 02/10/2026)',
    escalation: persistent('vérifier le lecteur ou la source : la régression a tenu deux RUN') },
  IDENTITY_REVIEW: { trajectory: 'REVUE_HUMAINE', means: null, label: 'identité d’employeur en revue',
    expected: 'une revue d’identité : preuve officielle de l’employeur à relire (`SourceIdentityReview`)' },
  CODE_DEFECT: { trajectory: 'A_REPARER', means: null, label: 'défaut de code Catwalks',
    expected: 'corriger le code (erreur INTERNAL, jamais acceptée comme incident de source)' },
  UNCLASSIFIED: { trajectory: 'A_REPARER', means: null, label: 'cause inconnue du catalogue',
    expected: 'instruire la cause, puis l’ajouter au catalogue (`ordinaryCauses.ts`)' },
};

const TRANSIENT_INTERNAL: Readonly<Record<string, Cause>> = {
  CaptureUnavailableError: 'TRANSIENT_CAPTURE',
  DATABASE_FAILURE: 'TRANSIENT_DATABASE',
};
const CODE_DEFECTS = new Set(['TypeError', 'ReferenceError', 'RangeError', 'OfflineReplayError', 'ObservabilityUnavailableError']);
const HEALTH_CODES = new Set(['SOURCE_HEALTH_REGRESSION', 'NATIVE_RETENTION_JUMP', 'DESCRIPTION_COVERAGE_BELOW_FLOOR']);

/**
 * La cause d'une issue. `message` est celui de l'erreur quand la source n'a pas été collectée (il départage une
 * transaction close, rapportée par la garde d'accès, d'un vrai refus). Pure.
 */
export function causeOf(issue: Pick<IngestionIssue, 'origin' | 'code' | 'detail'>, message = ''): Cause {
  const { code, detail } = issue;
  if (code === NATIVE_RETENTION) return issue.origin === 'SOURCE' ? 'NATIVE_RETENTION' : 'UNCLASSIFIED';
  if (TRANSIENT_INTERNAL[code]) return TRANSIENT_INTERNAL[code];
  // RUN du 01/10/2026, diptyque-workday : une transaction close à 7 446 ms, rapportée par la garde d'accès.
  if (/Transaction (API error|already closed)/.test(message)) return 'TRANSIENT_DATABASE';
  if (CODE_DEFECTS.has(code)) return 'CODE_DEFECT';
  if (code.startsWith('TRANSPORT_') || /^HTTP_5\d\d$/.test(code)) return 'TRANSIENT_NETWORK';
  if (message.startsWith('__TIMEOUT__')) return 'TIMEOUT';
  if (code === 'ACCESS_STALE' || code === 'ACCESS_MISSING' || code === 'ACCESS_SUPERSEDED') return 'ACCESS_RENEWAL';
  if (code === 'ACCESS_SCOPE') return 'SCOPE_OUTGROWN';
  if (code === 'ACCESS_DENIED' || /cannot replace an explicit denial|does not authorize collection/.test(message)) return 'ACCESS_DENIED';
  if (code === 'WafChallengeError' || /^HTTP_(403|406|429)$/.test(detail ?? '')) return 'PUBLISHER_REFUSAL';
  if (code === 'CAPTURE_NOT_VALIDATED' || /requires validated native evidence|Native qualification failed/.test(message)) return 'QUALIFICATION_REJECTED';
  if (code === 'ENUMERATION_NOT_PROVEN' || code === 'ENUMERATION_REFUTED') return 'ENUMERATION_INCOMPLETE';
  if (HEALTH_CODES.has(code)) return 'HEALTH_REGRESSION';
  if (code === 'EmployerIdentityReviewRequired') return 'IDENTITY_REVIEW';
  return 'UNCLASSIFIED';
}

export type Remediation = {
  cause: Cause; trajectory: Trajectory; means: Means; label: string; expected: string;
  /** RUN complets consécutifs où la source porte cette cause, celui-ci compris. */
  consecutiveRuns: number;
  /** D-480 §1 : échec connu décidé pour cette source et ce défaut. */
  decided?: string;
};

/** Le nombre de RUN complets consécutifs à partir duquel une cause ordinaire n'est plus ordinaire. */
export const ESCALATION_RUNS = 2;

/**
 * La trajectoire d'une issue de `source`, sachant les causes que la même source portait au RUN complet précédent
 * (`previousCauses`, vide s'il n'y en a pas). Pure.
 */
export function remediationOf(source: string, issue: IngestionIssue, message = '', previousCauses: ReadonlySet<Cause> = new Set()): Remediation {
  const cause = causeOf(issue, message);
  const entry = CAUSES[cause];
  const consecutiveRuns = previousCauses.has(cause) ? ESCALATION_RUNS : 1;
  if (isDecidedKnownFailure(source, issue))
    return { cause, trajectory: 'DECIDEE', means: null, label: entry.label, expected: 'rien : échec connu décidé, visible au bilan', consecutiveRuns, decided: 'D-480' };
  if (entry.trajectory === 'REVIENT_SEULE' && consecutiveRuns >= ESCALATION_RUNS && entry.escalation)
    return { cause, trajectory: entry.escalation.trajectory, means: null, label: entry.label, expected: entry.escalation.expected, consecutiveRuns };
  return { cause, trajectory: entry.trajectory, means: entry.means, label: entry.label, expected: entry.expected, consecutiveRuns };
}

/** La reprise unique dans le RUN vaut-elle pour cette trajectoire ? Seules les causes passagères à la première occurrence. */
export function retriesInRun(remediation: Pick<Remediation, 'trajectory' | 'means'>): boolean {
  return remediation.trajectory === 'REVIENT_SEULE' && remediation.means === 'RUN_RETRY';
}

const TRAJECTORY_LABELS: Readonly<Record<Trajectory, string>> = {
  NORMALE: 'normal', REVIENT_SEULE: 'revient seule', A_REPARER: 'à réparer', REVUE_HUMAINE: 'revue humaine', DECIDEE: 'décidée',
};

/** La ligne de l'alerte : la trajectoire, puis ce qui est attendu. */
export function remediationLine(remediation: Remediation): string {
  return `${remediationNote(remediation)} : ${remediation.expected}`;
}

/** Le mot du bilan : la cause, puis où elle va. */
export function remediationNote(remediation: Remediation): string {
  const run = remediation.consecutiveRuns >= ESCALATION_RUNS ? `, ${remediation.consecutiveRuns}e RUN de suite` : '';
  return `${remediation.label} → ${TRAJECTORY_LABELS[remediation.trajectory]}${run}`;
}
