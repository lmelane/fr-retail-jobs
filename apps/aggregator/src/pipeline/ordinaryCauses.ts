/**
 * D-520, critères 3 et 4 — LES CAUSES ET LEUR TRAJECTOIRE.
 *
 * Chaque issue d'une source (`IngestionIssue`, telle que le RUN la classe) reçoit ici UNE cause du catalogue, UNE
 * trajectoire et ce qui est attendu. Catalogue mesuré sur les 8 RUN du 24/09 au 01/10/2026
 * (`audits/2026-10-02/remediation-auto/`).
 *
 * LA RÈGLE. Une issue qui bloque le RUN n'est jamais présentée comme « rien à faire » : D-453 §1 veut qu'une cause
 * UNKNOWN ou INTERNAL soit instruite. Seules deux causes passagères par leur CLASSE d'erreur (une panne de base Prisma,
 * une panne de transport) sont reprises une fois dans le RUN (`RUN_RETRY`, `ingestOrchestrator.ts`) ; présentes aussi
 * au RUN complet précédent pour la même source, elles ne sont plus reprises et sont à instruire. Toute autre issue
 * bloquante est « à instruire » ou « revue humaine », avec l'indice mesuré qui oriente l'instruction.
 *
 * Mesuré, et qui fonde ces choix : les 15 « captures indisponibles » des RUN du 27 et 29/09 enveloppaient toutes
 * « This access policy certifies only native HTTP requests », un refus de la politique d'accès, déterministe, que la
 * requalification après déploiement masquait (corrigé par `scopeOutgrown`) : elles ne sont pas passagères. Un refus
 * (403, 406, 429, défi anti-robot) n'est jamais relu dans le même RUN ; Avature et les sources à amorçage anti-robot
 * ne sont jamais reprises (lecture D-492 de D-516 §1 : une relecture qui suit de près une lecture complète est refusée,
 * hypothèse la mieux soutenue ; D-483 : amorçages comptés par collecte).
 *
 * Ce module NOMME ; il ne rend rien non bloquant, ne publie, ne ferme ni ne retient rien.
 *
 * À RELIER : le vocabulaire d'état des sources de D-520 §2 (module d'état opérationnel, en construction par ailleurs)
 * doit reprendre ces trajectoires telles quelles plutôt qu'en définir de nouvelles.
 */
import { isDecidedKnownFailure, NATIVE_RETENTION, type IngestionIssue } from '../lib/ingestionIssue.js';

/** Où va la source, et qui la ramène. */
export type Trajectory =
  /** Rien d'anormal : une retenue prouvée par la source elle-même (D-453 §1). */
  | 'NORMALE'
  /** Elle revient sans personne : la reprise unique du RUN (causes passagères par leur classe, première occurrence). */
  | 'REVIENT_SEULE'
  /** À instruire puis réparer (lecteur, code, budget, accès) : un développement ou une enquête est attendu. */
  | 'A_REPARER'
  /** Une revue ou une décision humaine est attendue (identité, accès refusé, nouveau périmètre). */
  | 'REVUE_HUMAINE'
  /** Échec connu et décidé (D-480 §1) : visible, non bloquant, rien n'est attendu tant que la décision tient. */
  | 'DECIDEE';

/** Le moyen par lequel une cause qui revient seule revient. */
export type Means = 'RUN_RETRY' | null;

export type Cause =
  | 'NATIVE_RETENTION' | 'PUBLISHER_OUTAGE_PROVEN'
  | 'TRANSIENT_DATABASE' | 'TRANSIENT_NETWORK'
  | 'CAPTURE_REFUSED'
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

/** LE CATALOGUE. Un ajout ici est la seule façon d'enseigner une cause nouvelle au système. */
export const CAUSES: Readonly<Record<Cause, Entry>> = {
  NATIVE_RETENTION: { trajectory: 'NORMALE', means: null, label: 'retenue prouvée par la source',
    expected: 'rien : les offres retenues le sont sur la preuve de l’éditeur (D-453 §1)' },
  PUBLISHER_OUTAGE_PROVEN: { trajectory: 'NORMALE', means: null, label: 'panne de l’éditeur prouvée (5xx archivé)',
    expected: 'rien : non bloquante sur sa réponse native (D-453 §1) ; ses offres restent ouvertes, le RUN suivant relit' },
  TRANSIENT_DATABASE: { trajectory: 'REVIENT_SEULE', means: 'RUN_RETRY', label: 'base de données indisponible ou lente',
    expected: 'rien : reprise une fois en fin de RUN ; si elle échoue, instruire (verrous, délais de transaction)',
    escalation: { trajectory: 'A_REPARER', expected: 'instruire la base (verrous, délais de transaction) : la panne était déjà là au RUN complet précédent' } },
  TRANSIENT_NETWORK: { trajectory: 'REVIENT_SEULE', means: 'RUN_RETRY', label: 'panne de transport vers l’hôte',
    expected: 'rien : reprise une fois en fin de RUN ; si elle échoue, instruire le transport (DNS, TLS, connexion)',
    escalation: { trajectory: 'A_REPARER', expected: 'instruire le transport vers cet hôte (DNS, TLS, connexion) : la panne était déjà là au RUN complet précédent' } },
  CAPTURE_REFUSED: { trajectory: 'A_REPARER', means: null, label: 'capture native refusée ou indisponible',
    expected: 'lire la cause enveloppée (`source.ingest_failed`) : les 15 cas mesurés étaient une requête que la politique d’accès ne certifie pas (périmètre ou transport)' },
  TIMEOUT: { trajectory: 'A_REPARER', means: null, label: 'délai de la source dépassé',
    expected: 'instruire le budget ou le lecteur ; ses offres restent ouvertes (L-01)' },
  ACCESS_RENEWAL: { trajectory: 'A_REPARER', means: null, label: 'décision d’accès non renouvelée',
    expected: 'le RUN renouvelle seul l’accès avant la collecte (406 à 411 sources par RUN après une release) : s’il échoue, lire son motif (`source.access_qualification_started`)' },
  SCOPE_OUTGROWN: { trajectory: 'REVUE_HUMAINE', means: null, label: 'requête hors du périmètre qualifié',
    expected: 'relire le périmètre : la qualification du jour n’a pas pu le redériver (`source.access_scope_outgrown`)' },
  ACCESS_DENIED: { trajectory: 'REVUE_HUMAINE', means: null, label: 'refus d’accès explicite en vigueur',
    expected: 'une décision humaine : lever le refus par une nouvelle revue d’accès, ou retirer la source' },
  PUBLISHER_REFUSAL: { trajectory: 'A_REPARER', means: null, label: 'réponse de refus (403, 406, 429, défi anti-robot)',
    expected: 'instruire le refus (limite de débit, anti-robot, adresse) ; jamais relu dans le même RUN' },
  QUALIFICATION_REJECTED: { trajectory: 'A_REPARER', means: null, label: 'capture de qualification rejetée par sa validation',
    expected: 'instruire le lecteur : motifs dans `SourceValidation.report` (mesuré : persiste au RUN suivant 18 fois sur 25)' },
  ENUMERATION_INCOMPLETE: { trajectory: 'A_REPARER', means: null, label: 'liste incomplète ou non prouvée',
    expected: 'instruire la lecture de la liste ; aucune offre n’est fermée sur une liste non prouvée' },
  HEALTH_REGRESSION: { trajectory: 'A_REPARER', means: null, label: 'régression de volume ou de champs',
    expected: 'instruire la régression (mesuré : 39 sur 57 avaient disparu au RUN suivant, du 24/09 au 01/10)' },
  IDENTITY_REVIEW: { trajectory: 'REVUE_HUMAINE', means: null, label: 'identité d’employeur en revue',
    expected: 'une revue d’identité : preuve officielle de l’employeur à relire (`SourceIdentityReview`)' },
  CODE_DEFECT: { trajectory: 'A_REPARER', means: null, label: 'défaut de code Catwalks',
    expected: 'corriger le code (erreur INTERNAL, jamais acceptée comme incident de source)' },
  UNCLASSIFIED: { trajectory: 'A_REPARER', means: null, label: 'cause absente du catalogue',
    expected: 'instruire la cause, puis l’ajouter au catalogue (`ordinaryCauses.ts`)' },
};

const TRANSIENT_INTERNAL: Readonly<Record<string, Cause>> = { DATABASE_FAILURE: 'TRANSIENT_DATABASE' };
const CODE_DEFECTS = new Set(['TypeError', 'ReferenceError', 'RangeError', 'OfflineReplayError', 'ObservabilityUnavailableError']);
const HEALTH_CODES = new Set(['SOURCE_HEALTH_REGRESSION', 'NATIVE_RETENTION_JUMP', 'DESCRIPTION_COVERAGE_BELOW_FLOOR']);

/**
 * La cause d'une issue. `message` est celui de l'erreur quand la source n'a pas été collectée : il ne sert qu'à nommer
 * un refus, un délai ou une qualification rejetée, jamais à rendre une erreur passagère (donc reprise). Pure.
 */
export function causeOf(issue: Pick<IngestionIssue, 'origin' | 'code' | 'detail'>, message = '', errorCode?: string): Cause {
  const { code, detail } = issue;
  // `ingestionIssue` nomme un refus d'accès explicite par sa classe (`SourceAccessGateError`) : son code propre vient d'ici.
  const is = (wanted: string) => code === wanted || errorCode === wanted;
  if (code === NATIVE_RETENTION) return issue.origin === 'SOURCE' ? 'NATIVE_RETENTION' : 'UNCLASSIFIED';
  // Un 5xx attesté par sa réponse native archivée : panne de l'éditeur prouvée, non bloquante (D-453 §1), jamais reprise.
  if (issue.origin === 'SOURCE' && /^HTTP_5\d\d$/.test(code)) return 'PUBLISHER_OUTAGE_PROVEN';
  // LES REFUS D'ABORD : un refus d'accès ou de l'éditeur n'est jamais reclassé passager, quel que soit son message.
  if (is('ACCESS_DENIED') || /cannot replace an explicit denial|does not authorize collection/.test(message)) return 'ACCESS_DENIED';
  if (is('ACCESS_SCOPE')) return 'SCOPE_OUTGROWN';
  if (code === 'WafChallengeError' || /^HTTP_(403|406|429)$/.test(detail ?? '')) return 'PUBLISHER_REFUSAL';
  if (is('ACCESS_STALE') || is('ACCESS_MISSING') || is('ACCESS_SUPERSEDED')) return 'ACCESS_RENEWAL';
  // Toute autre garde d'accès (ACCESS_INVALID : qualification refusée) n'est jamais passagère.
  if (code === 'SourceAccessGateError') return 'UNCLASSIFIED';
  // Le passager se reconnaît à la CLASSE de l'erreur, jamais à son texte : une panne de base est une erreur Prisma
  // (`DATABASE_FAILURE`, `isDatabaseFailure`, origine INTERNAL), y compris pendant la qualification d'accès depuis le
  // 01/10/2026 (`sourceAccessQualification.ts` la relance au lieu de la rapporter en refus) ; une panne de transport est
  // un code `TRANSPORT_*` (cause undici nommée). Une capture indisponible n'est pas passagère (en-tête du module).
  if (issue.origin === 'INTERNAL' && TRANSIENT_INTERNAL[code]) return TRANSIENT_INTERNAL[code];
  if (code === 'CaptureUnavailableError') return 'CAPTURE_REFUSED';
  if (CODE_DEFECTS.has(code)) return 'CODE_DEFECT';
  if (code.startsWith('TRANSPORT_')) return 'TRANSIENT_NETWORK';
  if (message.startsWith('__TIMEOUT__')) return 'TIMEOUT';
  if (is('CAPTURE_NOT_VALIDATED') || /requires validated native evidence|Native qualification failed|requires a qualified native result/.test(message)) return 'QUALIFICATION_REJECTED';
  if (code === 'ENUMERATION_NOT_PROVEN' || code === 'ENUMERATION_REFUTED') return 'ENUMERATION_INCOMPLETE';
  if (HEALTH_CODES.has(code)) return 'HEALTH_REGRESSION';
  if (code === 'EmployerIdentityReviewRequired') return 'IDENTITY_REVIEW';
  return 'UNCLASSIFIED';
}

export type Remediation = {
  cause: Cause; trajectory: Trajectory; means: Means; label: string; expected: string;
  /** 2 quand la même source portait déjà cette cause au RUN complet précédent, sinon 1 (pas un compte au-delà). */
  consecutiveRuns: number;
  /** D-480 §1 : échec connu décidé pour cette source et ce défaut. */
  decided?: string;
};

/** À partir de combien de RUN complets consécutifs une cause passagère n'est plus reprise (la même cause au précédent). */
export const ESCALATION_RUNS = 2;

/**
 * La trajectoire d'une issue de `source`, sachant les causes que la même source portait au RUN complet précédent
 * (`previousCauses`, vide s'il n'y en a pas). Pure.
 */
export function remediationOf(source: string, issue: IngestionIssue, message = '', previousCauses: ReadonlySet<Cause> = new Set(),
  errorCode?: string, retried = false): Remediation {
  const cause = causeOf(issue, message, errorCode);
  const entry = CAUSES[cause];
  const consecutiveRuns = previousCauses.has(cause) ? ESCALATION_RUNS : 1;
  if (isDecidedKnownFailure(source, issue))
    return { cause, trajectory: 'DECIDEE', means: null, label: entry.label, expected: 'rien : échec connu décidé, visible au bilan', consecutiveRuns, decided: 'D-480' };
  if (entry.trajectory === 'REVIENT_SEULE' && consecutiveRuns >= ESCALATION_RUNS && entry.escalation)
    return { cause, trajectory: entry.escalation.trajectory, means: null, label: entry.label, expected: entry.escalation.expected, consecutiveRuns };
  // La reprise du RUN a échoué à son tour : la panne n'est plus présumée passagère.
  if (entry.trajectory === 'REVIENT_SEULE' && retried && entry.escalation)
    return { cause, trajectory: entry.escalation.trajectory, means: null, label: `${entry.label} (reprise échouée)`,
      expected: entry.escalation.expected.replace(/ : la panne était déjà là au RUN complet précédent$/, ' : la reprise du RUN a échoué'), consecutiveRuns };
  return { cause, trajectory: entry.trajectory, means: entry.means, label: entry.label, expected: entry.expected, consecutiveRuns };
}

/** La reprise unique dans le RUN vaut-elle pour cette trajectoire ? Seules les causes passagères à la première occurrence. */
export function retriesInRun(remediation: Pick<Remediation, 'trajectory' | 'means'>): boolean {
  return remediation.trajectory === 'REVIENT_SEULE' && remediation.means === 'RUN_RETRY';
}

const TRAJECTORY_LABELS: Readonly<Record<Trajectory, string>> = {
  NORMALE: 'normal', REVIENT_SEULE: 'revient seule', A_REPARER: 'à instruire', REVUE_HUMAINE: 'revue humaine', DECIDEE: 'décidée',
};

/** La ligne de l'alerte : la trajectoire, puis ce qui est attendu. */
export function remediationLine(remediation: Remediation): string {
  return `${remediationNote(remediation)} : ${remediation.expected}`;
}

/** Le mot du bilan : la cause, puis où elle va. */
export function remediationNote(remediation: Remediation): string {
  const run = remediation.consecutiveRuns >= ESCALATION_RUNS ? ', déjà là au RUN complet précédent' : '';
  return `${remediation.label} → ${TRAJECTORY_LABELS[remediation.trajectory]}${run}`;
}
