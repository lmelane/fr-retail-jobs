/**
 * L'ÉTAT OPÉRATIONNEL DES SOURCES — D-520 §2 et §4 ; architecture de l'assistant (lecture [[D-492]]). Pur, sans base.
 *
 * Deux notions séparées, jamais confondues :
 *   · l'INTENTION, `Source.status` (DRAFT, VALIDATED, ACTIVE, PAUSED, RETIRED), décidée par un humain ;
 *   · l'ÉTAT OPÉRATIONNEL, calculé ici après chaque collecte (RUN, passe incrémentale D-517, vérification ciblée) et
 *     persisté dans `SourceOperationalState` (`sourceStateStore.ts`).
 *
 * Tout état autre que NORMALE porte une CAUSE (vocabulaire fermé, `CAUSES`), une TRAJECTOIRE (AUTO, A_REPARER,
 * REVUE_HUMAINE, DECISION), CE QUI MANQUE (la prochaine action), DEPUIS QUAND, et, s'il est temporaire, une ÉCHÉANCE :
 * à l'échéance, l'état s'escalade de lui-même (`ESCALATION`). Un code d'échec que ce module ne sait pas classer donne
 * la cause NON_CLASSEE, et la réconciliation du RUN passe rouge : la classe manque, elle s'ajoute ICI, jamais ailleurs.
 *
 * Module unique du vocabulaire : le bulletin et les commandes `etat-sources` et `verifier-source` le lisent ; la
 * remédiation automatique, la réconciliation du registre et le futur écran du back-office doivent s'y brancher, sans
 * redéfinir ces constantes.
 */
import { isDecidedKnownFailure, isProvenSourceIssue, KNOWN_FAILURE_DECISION, NATIVE_RETENTION, type IngestionIssue } from '../lib/ingestionIssue.js';

export const OPERATIONAL_STATES = ['NORMALE', 'DEGRADEE', 'EN_ATTENTE', 'BLOQUEE', 'EN_PAUSE', 'EXCLUE'] as const;
export type OperationalState = typeof OPERATIONAL_STATES[number];
export const STATE_LABEL: Readonly<Record<OperationalState, string>> = {
  NORMALE: 'normale', DEGRADEE: 'dégradée (publie, avec réserve)', EN_ATTENTE: 'en attente (cause passagère, retente seule)',
  BLOQUEE: 'bloquée (ne publie pas)', EN_PAUSE: 'en pause (décision)', EXCLUE: 'exclue (décision)',
};

export const TRAJECTORIES = ['AUTO', 'A_REPARER', 'REVUE_HUMAINE', 'DECISION'] as const;
export type Trajectory = typeof TRAJECTORIES[number];
export const TRAJECTORY_LABEL: Readonly<Record<Trajectory, string>> = {
  AUTO: 'revient seule', A_REPARER: 'à réparer (code ou configuration, assistant)',
  REVUE_HUMAINE: 'revue humaine nécessaire', DECISION: 'décision (pause, exclusion ou échec connu)',
};

export const COLLECTION_KINDS = ['RUN', 'PASSE', 'VERIFICATION'] as const;
export type CollectionKind = typeof COLLECTION_KINDS[number];

/**
 * Les échéances, fixées par l'assistant sur la mesure du 02/10/2026 (`audits/2026-10-02/etat-sources/`) :
 *   · EN_ATTENTE (cause passagère) : 48 h ou 3 tentatives complètes (RUN ou vérification ; une passe incrémentale ne
 *     compte pas, elle relit la même liste plusieurs fois par jour) ; au-delà, BLOQUEE et A_REPARER ;
 *   · BLOQUEE qui devait revenir seule (volume à zéro, employeur à identifier sans aucune offre publiée) : comme
 *     EN_ATTENTE ;
 *   · DEGRADEE qui devait revenir seule : 7 jours ; au-delà, A_REPARER (ou REVUE_HUMAINE, `escalatesTo` de la cause) ;
 *     l'employeur à identifier, mesuré (16 épisodes sur 29 durent 4 RUN ou plus), n'a que 48 h (`deadlineHours`) ;
 *   · « depuis », les tentatives et l'escalade courent sur l'ÉPISODE (de la sortie de NORMALE au retour), pas sur la
 *     cause : une source qui alterne 429 et 403 ne repousse pas son échéance ;
 *   · à réparer ou en revue humaine : le RUN ne rougit pas chaque jour, mais au-delà de `REPAIR_CEILING_DAYS` jours
 *     l'état n'a plus de sortie crédible et le RUN passe rouge (réparer, ou décider une pause ou une exclusion).
 */
export const ESCALATION = { waitingHours: 48, waitingAttempts: 3, degradedDays: 7 } as const;
export const REPAIR_CEILING_DAYS = 14;

type CauseSpec = {
  label: string;
  /** L'état quand la collecte n'a rien publié ; une collecte qui publie malgré la cause est DEGRADEE. */
  base: 'DEGRADEE' | 'EN_ATTENTE' | 'BLOQUEE' | 'EN_PAUSE' | 'EXCLUE';
  trajectory: Trajectory;
  /** La prochaine action concrète. */
  missing: string;
  /** Pour une cause qui revient seule (AUTO) : la trajectoire à l'échéance (A_REPARER par défaut). */
  escalatesTo?: 'A_REPARER' | 'REVUE_HUMAINE';
  /** Échéance propre à la cause, en heures (sinon 48 h pour un état qui ne publie pas, 7 jours pour DEGRADEE). */
  deadlineHours?: number;
};

/** Le vocabulaire fermé des causes. Regroupe les codes de `source.issue_classified`, `SourceRun.status` et du registre. */
export const CAUSES = {
  INDISPONIBILITE_PASSAGERE: { label: 'indisponibilité passagère (délai dépassé, 5xx, réseau, quota)', base: 'EN_ATTENTE', trajectory: 'AUTO',
    missing: 'rien : la prochaine collecte retente ; sinon, vérifier la disponibilité du site, la politesse par hôte et le budget de la source' },
  ACCES_REFUSE: { label: 'accès refusé par la source (anti-robot, 401, 403, 406)', base: 'EN_ATTENTE', trajectory: 'AUTO',
    missing: 'rien tant que le refus est passager ; à l’échéance, revoir l’amorçage, la politesse par hôte ou la cadence' },
  QUALIFICATION_REFUSEE: { label: 'qualification ou périmètre d’accès refusé (nos gardes)', base: 'BLOQUEE', trajectory: 'A_REPARER',
    missing: 'lire la validation ou la décision d’accès refusée, corriger le lecteur ou la configuration, puis verifier-source' },
  IDENTITE_EMPLOYEUR: { label: 'employeur à identifier (nouvelle graphie ou employeur non certifié)', base: 'DEGRADEE', trajectory: 'AUTO',
    escalatesTo: 'REVUE_HUMAINE', deadlineHours: 48,
    missing: 'rien si la prochaine collecte rattache l’employeur (suivi de l’éditeur) ; sinon, revue d’identité par l’équipe Catwalks : rattacher la graphie à sa Maison ou la refuser, preuve à l’appui' },
  LISTE_NON_PROUVEE: { label: 'liste non prouvée complète (fin non démontrée, réfutée ou tronquée)', base: 'DEGRADEE', trajectory: 'AUTO',
    missing: 'rien si la prochaine collecte prouve sa liste ; sinon, adapter la pagination du lecteur' },
  CONTENU_INCOMPLET: { label: 'contenu incomplet (descriptions manquantes, lignes rejetées)', base: 'DEGRADEE', trajectory: 'A_REPARER',
    missing: 'corriger la lecture du détail des offres, puis verifier-source' },
  ANOMALIE_VOLUME: { label: 'volume anormal (chute, zéro, saut de retenues)', base: 'DEGRADEE', trajectory: 'AUTO',
    missing: 'rien si la prochaine collecte retrouve son volume ; sinon, comparer la liste à celle du site' },
  LECTEUR: { label: 'lecteur ou configuration de la source en échec', base: 'BLOQUEE', trajectory: 'A_REPARER',
    missing: 'corriger le lecteur ou l’adresse de la source, puis verifier-source' },
  CERTIFICAT_TLS: { label: 'certificat TLS du site invalide ou incomplet', base: 'BLOQUEE', trajectory: 'A_REPARER',
    missing: 'compléter la chaîne de certificats (politesse TLS) ou corriger l’adresse, puis verifier-source' },
  DEFAUT_INTERNE: { label: 'défaut interne de Catwalks (code, base, capture)', base: 'BLOQUEE', trajectory: 'A_REPARER',
    missing: 'corriger le code ou l’infrastructure Catwalks, puis verifier-source' },
  NON_COLLECTEE: { label: 'source active non collectée par le dernier RUN', base: 'BLOQUEE', trajectory: 'A_REPARER',
    missing: 'trouver pourquoi le RUN ne l’a pas sélectionnée ou terminée, puis verifier-source' },
  ACTIVATION_A_FAIRE: { label: 'source en préparation (DRAFT ou VALIDATED), pas encore dans la rotation', base: 'BLOQUEE', trajectory: 'A_REPARER',
    missing: 'qualifier la source puis la promouvoir (source-campaign), ou la retirer' },
  PAUSE_DECIDEE: { label: 'pause décidée', base: 'EN_PAUSE', trajectory: 'DECISION', missing: 'rien : la pause se lève par la décision qui l’a posée' },
  EXCLUSION_DECIDEE: { label: 'exclusion décidée', base: 'EXCLUE', trajectory: 'DECISION', missing: 'rien : la source n’est plus collectée' },
  MOTIF_ABSENT: { label: 'pause ou exclusion sans décision référencée', base: 'EN_PAUSE', trajectory: 'A_REPARER',
    missing: 'consigner dans le registre (Source.note) la décision qui porte la pause ou l’exclusion (référence D-…, ou décision datée)' },
  NON_CLASSEE: { label: 'cause non classée : la classe manque', base: 'BLOQUEE', trajectory: 'A_REPARER',
    missing: 'ajouter la classe de ce code dans pipeline/sourceState.ts' },
} as const satisfies Record<string, CauseSpec>;
export type CauseClass = keyof typeof CAUSES;
export const CAUSE_CLASSES = Object.keys(CAUSES) as CauseClass[];

/** Quand une collecte porte plusieurs causes, la première de cet ordre l'emporte (les autres codes restent dans la preuve). */
const PRECEDENCE: readonly CauseClass[] = ['NON_CLASSEE', 'DEFAUT_INTERNE', 'QUALIFICATION_REFUSEE', 'CERTIFICAT_TLS', 'LECTEUR', 'ACCES_REFUSE',
  'INDISPONIBILITE_PASSAGERE', 'ANOMALIE_VOLUME', 'IDENTITE_EMPLOYEUR', 'LISTE_NON_PROUVEE', 'CONTENU_INCOMPLET'];

const TLS_CODES = /(CERT|LEAF_SIGNATURE|SELF_SIGNED|TLS|SSL)/;
const READER_TRANSPORT = /^TRANSPORT_(ERR_INVALID_URL|UND_ERR_INVALID_ARG)$/;
const BY_NAME: Readonly<Record<string, CauseClass>> = {
  WafChallengeError: 'ACCES_REFUSE',
  IncompleteBodyError: 'INDISPONIBILITE_PASSAGERE', AbortError: 'INDISPONIBILITE_PASSAGERE', TimeoutError: 'INDISPONIBILITE_PASSAGERE',
  SourceAdmissionGateError: 'QUALIFICATION_REFUSEE', SourceAccessGateError: 'QUALIFICATION_REFUSEE', SourceValidationGateError: 'QUALIFICATION_REFUSEE',
  SourcePromotionGateError: 'QUALIFICATION_REFUSEE', SourceIdentityGateError: 'QUALIFICATION_REFUSEE', AccessScopeBudgetError: 'QUALIFICATION_REFUSEE',
  FashionjobsOffersWithdrawn: 'QUALIFICATION_REFUSEE',
  ACCESS_SCOPE: 'QUALIFICATION_REFUSEE', ACCESS_MISSING: 'QUALIFICATION_REFUSEE', ACCESS_STALE: 'QUALIFICATION_REFUSEE', ACCESS_SUPERSEDED: 'QUALIFICATION_REFUSEE',
  ACCESS_DENIED: 'QUALIFICATION_REFUSEE', ACCESS_INVALID: 'QUALIFICATION_REFUSEE',
  EmployerIdentityReviewRequired: 'IDENTITE_EMPLOYEUR', PublisherFollowDeferred: 'IDENTITE_EMPLOYEUR',
  ENUMERATION_NOT_PROVEN: 'LISTE_NON_PROUVEE', ENUMERATION_REFUTED: 'LISTE_NON_PROUVEE',
  DESCRIPTION_COVERAGE_BELOW_FLOOR: 'CONTENU_INCOMPLET', REJECTED_NATIVE_ROWS: 'CONTENU_INCOMPLET', NATIVE_REFUSAL_MASS: 'CONTENU_INCOMPLET',
  SOURCE_HEALTH_REGRESSION: 'ANOMALIE_VOLUME', NATIVE_RETENTION_JUMP: 'ANOMALIE_VOLUME',
  Error: 'LECTEUR', UNCLASSIFIED_FAILURE: 'LECTEUR', SyntaxError: 'LECTEUR', BlockedUrlError: 'LECTEUR', ChainCompletionRefused: 'CERTIFICAT_TLS',
  UNCLASSIFIED_INGEST_ERRORS: 'DEFAUT_INTERNE', PipelinePausedError: 'NON_COLLECTEE',
};

export type IssueLike = Pick<IngestionIssue, 'origin' | 'code'> & Partial<Pick<IngestionIssue, 'detail' | 'captureBatchId' | 'rawCaptureId' | 'completionReportHash'>>;

/** Le statut HTTP d'un échec : son `detail`, sinon la note de la collecte (les événements d'avant le 30/09 n'avaient pas de détail). */
function httpStatus(issue: IssueLike, note: string | null | undefined): number | null {
  const fromDetail = /^HTTP_(\d{3})$/.exec(issue.detail ?? '')?.[1] ?? /^HTTP_(\d{3})$/.exec(issue.code)?.[1];
  const fromNote = /\bHTTP (\d{3})\b/.exec(note ?? '')?.[1];
  const status = Number(fromDetail ?? fromNote);
  return Number.isInteger(status) && status >= 100 ? status : null;
}

/** La classe d'un code d'échec, ou null pour ce qui n'est pas un défaut (une retenue prouvée par la source). */
export function issueCause(issue: IssueLike, note?: string | null): CauseClass | null {
  if (issue.code === NATIVE_RETENTION && isProvenSourceIssue(issue as IngestionIssue)) return null;
  const status = issue.code === 'HttpStatusError' || /^HTTP_\d{3}$/.test(issue.code) ? httpStatus(issue, note) : null;
  if (status !== null) {
    if (status >= 500 || status === 429 || status === 408) return 'INDISPONIBILITE_PASSAGERE';
    if ([401, 403, 406].includes(status)) return 'ACCES_REFUSE';
    return 'LECTEUR';
  }
  if (issue.code.startsWith('TRANSPORT_'))
    return TLS_CODES.test(issue.code) ? 'CERTIFICAT_TLS' : READER_TRANSPORT.test(issue.code) ? 'LECTEUR' : 'INDISPONIBILITE_PASSAGERE';
  const named = BY_NAME[issue.code];
  if (named) return named;
  if (issue.origin === 'INTERNAL') return 'DEFAUT_INTERNE';
  return 'NON_CLASSEE';
}

export type RegistryIntent = { key: string; status: string; note: string | null };
export type CollectionOutcome = {
  kind: CollectionKind; at: Date; runId: string | null;
  /** `SourceRun.status` de la collecte : OK, DEGRADED, BROKEN, NEW, TIMEOUT, CHALLENGED, ERROR. */
  runStatus: string | null;
  /** Offres publiées par la collecte (`SourceRun.jobs`). */
  jobs: number;
  issues: readonly IssueLike[];
  note?: string | null;
};
export type SourceState = {
  sourceKey: string;
  state: OperationalState;
  cause: CauseClass | null;
  trajectory: Trajectory | null;
  missing: string | null;
  since: Date;
  deadline: Date | null;
  attempts: number;
  escalated: boolean;
  /** La décision qui porte l'état (pause, exclusion, échec connu D-480), ou null. */
  decision: string | null;
  /** Les codes d'échec de la dernière collecte (`origin/code[/detail]`), la preuve de la classe. */
  codes: string[];
  lastCollectionAt: Date | null;
  lastCollectionKind: CollectionKind | null;
  lastRunId: string | null;
  computedAt: Date;
};

const HOUR = 3_600_000;
const DECISION_REF = /\b(D-?\d{2,4}|DEC-\d+)\b/;
/** Un motif de pause ou d'exclusion porte une décision : une référence (D-…, D39, DEC-…) ou une décision datée écrite. */
const DECIDED = /\b(D-?\d{2,4}|DEC-\d+)\b|d[ée]cision/i;
/** Une note du registre citée dans un texte visible : sans tiret cadratin ni flèche (D-319), bornée. */
const quoted = (note: string) => note.replace(/\s*[\u2014\u2192]\s*/g, ', ').replace(/\s+/g, ' ').slice(0, 160);
const INTENT_CAUSES: ReadonlySet<string> = new Set(['PAUSE_DECIDEE', 'EXCLUSION_DECIDEE', 'MOTIF_ABSENT', 'ACTIVATION_A_FAIRE']);
const codeOf = (issue: IssueLike) => [issue.origin, issue.code, issue.detail].filter(Boolean).join('/');

function normal(sourceKey: string, now: Date, outcome: CollectionOutcome | null, previous: SourceState | null): SourceState {
  return { sourceKey, state: 'NORMALE', cause: null, trajectory: null, missing: null,
    since: previous?.state === 'NORMALE' ? previous.since : now, deadline: null, attempts: 0, escalated: false, decision: null,
    codes: outcome?.issues.map(codeOf) ?? [], lastCollectionAt: outcome?.at ?? previous?.lastCollectionAt ?? null,
    lastCollectionKind: outcome?.kind ?? previous?.lastCollectionKind ?? null, lastRunId: outcome?.runId ?? previous?.lastRunId ?? null, computedAt: now };
}

/** L'état que porte l'intention d'un humain (tout statut autre qu'ACTIVE). Null pour une source ACTIVE. */
export function intentState(source: RegistryIntent, previous: SourceState | null, now: Date): SourceState | null {
  if (source.status === 'ACTIVE') return null;
  const note = source.note?.trim() || null;
  // Une trace de promotion ou de validation (« promu par validation-volume… ») n'est pas un motif : seule une décision l'est.
  const decided = !!note && DECIDED.test(note);
  const cause: CauseClass = source.status === 'PAUSED' ? (decided ? 'PAUSE_DECIDEE' : 'MOTIF_ABSENT')
    : source.status === 'RETIRED' ? (decided ? 'EXCLUSION_DECIDEE' : 'MOTIF_ABSENT') : 'ACTIVATION_A_FAIRE';
  const state: OperationalState = source.status === 'PAUSED' ? 'EN_PAUSE' : source.status === 'RETIRED' ? 'EXCLUE' : 'BLOQUEE';
  const same = previous?.cause === cause && previous.state === state;
  return { sourceKey: source.key, state, cause, trajectory: CAUSES[cause].trajectory,
    missing: note && (cause === 'PAUSE_DECIDEE' || cause === 'EXCLUSION_DECIDEE') ? `${CAUSES[cause].missing} ; motif : ${quoted(note)}` : CAUSES[cause].missing,
    since: same ? previous!.since : now, deadline: null, attempts: 0, escalated: false,
    decision: note ? DECISION_REF.exec(note)?.[1] ?? null : null, codes: [],
    lastCollectionAt: previous?.lastCollectionAt ?? null, lastCollectionKind: previous?.lastCollectionKind ?? null,
    lastRunId: previous?.lastRunId ?? null, computedAt: now };
}

/**
 * L'état d'une source après une collecte. `previous` est l'état persisté avant elle (continuité de « depuis », du
 * compte des tentatives et de l'escalade). Pur : `now` est l'horloge du calcul.
 */
export function computeSourceState(input: { source: RegistryIntent; outcome: CollectionOutcome | null; previous: SourceState | null; now: Date }): SourceState {
  const { source, outcome, previous, now } = input;
  const intent = intentState(source, previous, now);
  if (intent) return intent;
  if (!outcome) return withCause(source.key, 'NON_COLLECTEE', 'BLOQUEE', null, previous, now, null, null);
  const causes = outcome.runStatus === 'TIMEOUT' ? ['INDISPONIBILITE_PASSAGERE' as const]
    : outcome.runStatus === 'CHALLENGED' ? ['ACCES_REFUSE' as const]
      : outcome.issues.map(issue => issueCause(issue, outcome.note)).filter((c): c is CauseClass => c !== null);
  if (!causes.length) {
    // Une passe incrémentale réussie ne lève rien : elle ne lit que le neuf, n'est jamais référence du rapport de santé
    // (lecture D-517 §2) ; seuls un RUN ou une vérification ciblée remettent une source à la normale.
    if (outcome.kind === 'PASSE' && previous && previous.state !== 'NORMALE' && previous.cause && !INTENT_CAUSES.has(previous.cause))
      return { ...previous, lastCollectionAt: outcome.at, lastCollectionKind: outcome.kind, lastRunId: outcome.runId, computedAt: now };
    return normal(source.key, now, outcome, previous);
  }
  const cause = PRECEDENCE.find(c => causes.includes(c))!;
  const spec: CauseSpec = CAUSES[cause];
  // D-480 §1 : un échec connu décidé par le CEO a une trajectoire de décision, sans échéance ; tout autre défaut non.
  const known = outcome.issues.length > 0 && outcome.issues.every(issue => isDecidedKnownFailure(source.key, issue) || issueCause(issue, outcome.note) === null);
  const publishes = outcome.jobs > 0 && outcome.runStatus !== 'TIMEOUT' && outcome.runStatus !== 'CHALLENGED';
  // Un échec connu n'est jamais « en attente » : il ne revient pas seul, il publie (DEGRADEE) ou non (BLOQUEE).
  const state: OperationalState = publishes ? 'DEGRADEE' : known || spec.base === 'DEGRADEE' ? 'BLOQUEE' : spec.base as OperationalState;
  return withCause(source.key, cause, state, outcome, previous, now, known ? (publishes ? 'PUBLIE' : 'MUET') : null, outcome.issues.map(codeOf));
}

/**
 * `known` : un échec connu décidé (D-480 §1). Qui PUBLIE garde sa trajectoire de décision, sans échéance ; qui ne publie
 * rien (MUET) contredit la prémisse de la décision (« elles restent collectées et publient leurs offres ») : à réparer.
 */
function withCause(sourceKey: string, cause: CauseClass, state: OperationalState, outcome: CollectionOutcome | null, previous: SourceState | null,
  now: Date, known: 'PUBLIE' | 'MUET' | null, codes: string[] | null): SourceState {
  const spec: CauseSpec = CAUSES[cause];
  // L'épisode court de la sortie de NORMALE au retour, quelle que soit la cause (une intention passée n'en est pas un).
  const ongoing = !!previous && previous.state !== 'NORMALE' && !(previous.cause && INTENT_CAUSES.has(previous.cause));
  const counts = outcome ? outcome.kind !== 'PASSE' : true;
  const since = ongoing ? previous!.since : now;
  const attempts = (ongoing ? previous!.attempts : 0) + (counts ? 1 : 0);
  let trajectory: Trajectory = known === 'PUBLIE' ? 'DECISION' : known === 'MUET' ? 'A_REPARER' : spec.trajectory;
  let finalState = state, deadline: Date | null = null, escalated = ongoing ? previous!.escalated : false;
  let missing: string = known === 'PUBLIE' ? `rien : échec connu décidé (${KNOWN_FAILURE_DECISION}), la source publie ses offres`
    : known === 'MUET' ? `échec connu décidé (${KNOWN_FAILURE_DECISION}), mais cette collecte n’a rien publié, contrairement à la prémisse de la décision : réparer, ou proposer une pause décidée`
      : spec.missing;
  if (!known && trajectory === 'AUTO') {
    const waiting = state !== 'DEGRADEE';
    deadline = new Date(since.getTime() + deadlineHours(spec, waiting) * HOUR);
    if (escalated || now.getTime() >= deadline.getTime() || (waiting && attempts >= ESCALATION.waitingAttempts)) {
      escalated = true;
      trajectory = spec.escalatesTo ?? 'A_REPARER';
      if (waiting) finalState = 'BLOQUEE';
      missing = escalatedMissing(spec, waiting);
    }
  }
  return { sourceKey, state: finalState, cause, trajectory, missing, since, deadline: escalated ? null : deadline, attempts, escalated,
    decision: known ? KNOWN_FAILURE_DECISION : null, codes: codes ?? [],
    lastCollectionAt: outcome?.at ?? previous?.lastCollectionAt ?? null, lastCollectionKind: outcome?.kind ?? previous?.lastCollectionKind ?? null,
    lastRunId: outcome?.runId ?? previous?.lastRunId ?? null, computedAt: now };
}

const deadlineHours = (spec: CauseSpec, waiting: boolean) => spec.deadlineHours ?? (waiting ? ESCALATION.waitingHours : ESCALATION.degradedDays * 24);
function escalatedMissing(spec: CauseSpec, waiting: boolean): string {
  const hours = deadlineHours(spec, waiting);
  const limit = waiting ? `${hours} h ou ${ESCALATION.waitingAttempts} tentatives` : hours % 24 === 0 && hours >= 72 ? `${hours / 24} jours` : `${hours} h`;
  return `échéance dépassée (${limit}) : ${spec.missing.replace(/^rien[^;]*; (sinon, )?/, '')}`;
}

/** Un état persisté dont l'échéance est passée, recalculé à `now` sans nouvelle collecte (lecture et réconciliation). */
export function ageState(state: SourceState, now: Date): SourceState {
  if (state.trajectory !== 'AUTO' || !state.deadline || now.getTime() < state.deadline.getTime() || !state.cause) return state;
  const spec: CauseSpec = CAUSES[state.cause];
  const waiting = state.state !== 'DEGRADEE';
  return { ...state, state: waiting ? 'BLOQUEE' : state.state, trajectory: spec.escalatesTo ?? 'A_REPARER', escalated: true, deadline: null,
    computedAt: now, missing: escalatedMissing(spec, waiting) };
}

export const VERDICT_REASONS = ['SOURCE_NON_CLASSEE', 'MOTIF_ABSENT', 'ECHEANCE_DEPASSEE', 'ANCIENNETE_DEPASSEE', 'PANNE_SYSTEME', 'COUVERTURE_INEXPLIQUEE'] as const;
export type VerdictReason = typeof VERDICT_REASONS[number];
/**
 * Panne du système : au moins ce nombre de sources que CE RUN a laissées bloquées de NOTRE côté (défaut interne ou
 * qualification refusée à leur collecte de ce RUN, ou non collectées), qu'elles le soient depuis ce RUN ou depuis
 * plus longtemps : une panne large et persistante ne se cache pas derrière l'ancienneté de ses sources. Seuil mesuré
 * sur les RUN du 24/09 au 01/10 (`audits/2026-10-02/etat-sources/`).
 */
export const SYSTEMIC_OUR_SIDE_BLOCKED = 5;
const OUR_SIDE: ReadonlySet<CauseClass> = new Set(['DEFAUT_INTERNE', 'QUALIFICATION_REFUSEE', 'NON_COLLECTEE']);

export type RunVerdict = { green: boolean; reasons: Array<{ reason: VerdictReason; detail: string; sources: string[] }> };

/** Les motifs de blocage de `lib/runSummary.ts` qui disent une panne du RUN lui-même, jamais celle d'une source. */
export const SYSTEM_BLOCKING_REASONS: ReadonlySet<string> = new Set(['INVALID_COUNTS', 'INCOMPLETE_RUN', 'NO_ACTIVE_SOURCE', 'ALL_SOURCES_FAILED']);

/** La panne du système lui-même, lue sur le RUN : ses comptes, le refresh, le bilan et le bulletin, l'état des sources. */
export function systemFailuresOf(input: { blockingReasons: readonly string[]; refreshRefused?: boolean; alertDeliveryFailed?: boolean;
  coverageFailed?: boolean; stateFailures?: readonly string[]; statesUnavailable?: boolean }): string[] {
  return [...input.blockingReasons.filter(reason => SYSTEM_BLOCKING_REASONS.has(reason)),
    ...(input.refreshRefused ? ['REFRESH_REFUSED'] : []), ...(input.alertDeliveryFailed ? ['ALERT_NOT_DELIVERED'] : []),
    ...(input.coverageFailed ? ['COVERAGE_FAILED'] : []), ...(input.stateFailures?.length ? ['SOURCE_STATE_NOT_RECORDED'] : []),
    ...(input.statesUnavailable ? ['SOURCE_STATES_UNAVAILABLE'] : [])];
}

/** Les pertes de couverture qui réveillent sans cause trouvée (`coverage/coverageAlert.ts`, cause INEXPLIQUEE). */
export function unexplainedCoverageOf(findings: readonly { scope: string; key: string; label?: string; cause: string; gravity: string }[]): string[] {
  return findings.filter(f => f.cause === 'INEXPLIQUEE' && f.gravity !== 'INFORMATION').map(f => `${f.scope}:${f.label ?? f.key}`);
}

/**
 * Le verdict du RUN est une RÉCONCILIATION (D-520 §4) : vert quand chaque source est dans un état expliqué (cause
 * classée, trajectoire) et que l'alerte de couverture n'a rien d'inexpliqué. Rouge pour une cause non classée, une
 * pause ou une exclusion sans motif, un état temporaire échu sans escalade, ou une panne du système lui-même. Une
 * source bloquée déjà classée à réparer ou en revue humaine ne rend pas le RUN rouge : le bulletin dit son ancienneté.
 */
export function reconcileRun(input: { states: readonly SourceState[]; now: Date; runStartedAt: Date | null;
  systemFailures: readonly string[]; unexplainedCoverage: readonly string[] }): RunVerdict {
  const reasons: RunVerdict['reasons'] = [];
  const add = (reason: VerdictReason, detail: string, sources: string[]) => { if (sources.length || reason === 'PANNE_SYSTEME') reasons.push({ reason, detail, sources }); };
  add('SOURCE_NON_CLASSEE', 'cause non classée ou absente', input.states.filter(s => s.state !== 'NORMALE' && (!s.cause || s.cause === 'NON_CLASSEE' || !s.trajectory)).map(s => s.sourceKey));
  add('MOTIF_ABSENT', 'pause ou exclusion sans décision référencée', input.states.filter(s => s.cause === 'MOTIF_ABSENT').map(s => s.sourceKey));
  add('ECHEANCE_DEPASSEE', 'état temporaire échu sans escalade', input.states.filter(s => s.trajectory === 'AUTO' && !s.escalated && s.deadline
    && s.deadline.getTime() <= input.now.getTime()).map(s => s.sourceKey));
  const ceiling = input.now.getTime() - REPAIR_CEILING_DAYS * 24 * HOUR;
  add('ANCIENNETE_DEPASSEE', `à réparer ou en revue depuis plus de ${REPAIR_CEILING_DAYS} jours : réparer, ou décider une pause ou une exclusion`,
    input.states.filter(s => (s.trajectory === 'A_REPARER' || s.trajectory === 'REVUE_HUMAINE') && s.cause !== 'MOTIF_ABSENT'
      && s.since.getTime() <= ceiling).map(s => s.sourceKey));
  const start = input.runStartedAt?.getTime();
  const ourSide = start === undefined ? [] : input.states.filter(s => s.state === 'BLOQUEE' && s.cause && OUR_SIDE.has(s.cause)
    && (s.cause === 'NON_COLLECTEE' ? s.computedAt.getTime() >= start : (s.lastCollectionAt?.getTime() ?? 0) >= start)).map(s => s.sourceKey);
  if (input.systemFailures.length) add('PANNE_SYSTEME', input.systemFailures.join(', '), []);
  if (ourSide.length >= SYSTEMIC_OUR_SIDE_BLOCKED) add('PANNE_SYSTEME', `${ourSide.length} sources laissées bloquées de notre côté par ce RUN (seuil ${SYSTEMIC_OUR_SIDE_BLOCKED})`, ourSide);
  if (input.unexplainedCoverage.length) add('COUVERTURE_INEXPLIQUEE', 'perte de couverture sans cause trouvée', [...input.unexplainedCoverage]);
  return { green: reasons.length === 0, reasons };
}

export type StateSummary = {
  total: number;
  byState: Record<OperationalState, number>;
  byTrajectory: Record<Trajectory, number>;
  byCause: Partial<Record<CauseClass, number>>;
  /** Chaque source non normale, la plus ancienne d'abord dans sa trajectoire. */
  sources: Array<Pick<SourceState, 'sourceKey' | 'state' | 'cause' | 'trajectory' | 'missing' | 'since' | 'deadline' | 'attempts' | 'escalated' | 'decision' | 'codes'> & { ageDays: number }>;
};

export function summarizeStates(states: readonly SourceState[], now: Date): StateSummary {
  const byState = Object.fromEntries(OPERATIONAL_STATES.map(s => [s, 0])) as Record<OperationalState, number>;
  const byTrajectory = Object.fromEntries(TRAJECTORIES.map(t => [t, 0])) as Record<Trajectory, number>;
  const byCause: Partial<Record<CauseClass, number>> = {};
  for (const s of states) {
    byState[s.state]++;
    if (s.trajectory) byTrajectory[s.trajectory]++;
    if (s.cause) byCause[s.cause] = (byCause[s.cause] ?? 0) + 1;
  }
  const order = (t: Trajectory | null) => (t ? TRAJECTORIES.indexOf(t) : -1);
  const sources = states.filter(s => s.state !== 'NORMALE').map(s => ({ sourceKey: s.sourceKey, state: s.state, cause: s.cause, trajectory: s.trajectory,
    missing: s.missing, since: s.since, deadline: s.deadline, attempts: s.attempts, escalated: s.escalated, decision: s.decision, codes: s.codes,
    ageDays: Math.max(0, Math.floor((now.getTime() - s.since.getTime()) / (24 * HOUR))) }))
    .sort((a, b) => order(a.trajectory) - order(b.trajectory) || a.since.getTime() - b.since.getTime() || a.sourceKey.localeCompare(b.sourceKey));
  return { total: states.length, byState, byTrajectory, byCause, sources };
}

const NUMBER = new Intl.NumberFormat('fr-FR');
/** La synthèse courte, en tête du bulletin de la boucle et de la commande `etat-sources` (sans tiret cadratin, D-319). */
export function summaryLines(summary: StateSummary, verdict?: RunVerdict | null, options: { detailed?: number; provisional?: boolean } = {}): string[] {
  const s = summary.byState, t = summary.byTrajectory, detailed = options.detailed ?? 6;
  const keys = (list: readonly string[]) => `${list.slice(0, 6).join(', ')}${list.length > 6 ? `, et ${list.length - 6} autres` : ''}`;
  const lines = [`Sources : ${NUMBER.format(summary.total)} ; ${s.NORMALE} normales, ${s.DEGRADEE} dégradées, ${s.EN_ATTENTE} en attente, ${s.BLOQUEE} bloquées, ${s.EN_PAUSE} en pause, ${s.EXCLUE} exclues.`,
    `Trajectoires : ${t.AUTO} reviennent seules, ${t.A_REPARER} à réparer, ${t.REVUE_HUMAINE} en revue humaine, ${t.DECISION} sur décision.`];
  const when = options.provisional ? ' (au moment de ce bulletin ; le verdict final du RUN y ajoute la remise du bilan)' : '';
  if (verdict) lines.unshift(verdict.green ? `Réconciliation${when} : vert, chaque source a un état expliqué.`
    : `Réconciliation${when} : rouge ; ${verdict.reasons.map(r => `${r.detail}${r.sources.length ? ` : ${r.sources.length} (${keys(r.sources)})` : ''}`).join(' ; ')}.`);
  // Une ligne par cause hors décision : combien, lesquelles, la plus ancienne.
  const byCause = new Map<CauseClass, StateSummary['sources']>();
  for (const x of summary.sources) if (x.cause && x.cause !== 'PAUSE_DECIDEE' && x.cause !== 'EXCLUSION_DECIDEE')
    byCause.set(x.cause, [...(byCause.get(x.cause) ?? []), x]);
  for (const [cause, list] of [...byCause.entries()].sort((a, b) => b[1].length - a[1].length))
    lines.push(`${CAUSES[cause].label} : ${list.length} (${keys(list.map(x => x.sourceKey))}) ; la plus ancienne depuis ${Math.max(...list.map(x => x.ageDays))} j.`);
  const repair = summary.sources.filter(x => (x.trajectory === 'A_REPARER' || x.trajectory === 'REVUE_HUMAINE') && x.cause !== 'MOTIF_ABSENT');
  for (const x of repair.slice(0, detailed)) lines.push(`${x.sourceKey}, depuis ${x.ageDays} j : ${x.missing ?? ''}`);
  if (repair.length > detailed) lines.push(`Et ${repair.length - detailed} autres à réparer ou en revue : commande etat-sources.`);
  return lines;
}
