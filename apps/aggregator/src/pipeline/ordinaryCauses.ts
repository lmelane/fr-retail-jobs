/**
 * D-520, critère 3 — LA REPRISE DES PANNES PASSAGÈRES, BRANCHÉE SUR LE VOCABULAIRE UNIQUE DE L'ÉTAT DES SOURCES.
 *
 * La cause, la trajectoire et « ce qui manque » d'une issue viennent de `sourceState.ts` (`issueCause`, `CAUSES`,
 * `TRAJECTORY_LABEL`), module unique du vocabulaire de D-520 §2 ; ce module ne les redéfinit pas. Il n'ajoute qu'une
 * chose : décider si une issue est reprise UNE fois dans le RUN (`ingestOrchestrator.ts`), et le dire au bilan et à
 * l'alerte.
 *
 * LA RÈGLE DE REPRISE (architecture de l'assistant, lecture D-492 ; catalogue mesuré sur les 8 RUN du 24/09 au
 * 01/10/2026, `audits/2026-10-02/remediation-auto/`) : seules les pannes passagères par leur CLASSE d'erreur — une panne
 * de base Prisma (`DATABASE_FAILURE`, origine INTERNAL) et une panne de transport non TLS (`TRANSPORT_*` de classe
 * INDISPONIBILITE_PASSAGERE) —, absentes du RUN complet précédent pour la même source. Jamais un refus (401, 403, 406,
 * 429, défi anti-robot), un délai, une garde d'accès ou de qualification, une capture refusée : les 15 « captures
 * indisponibles » mesurées enveloppaient toutes « This access policy certifies only native HTTP requests », un refus
 * déterministe de la politique d'accès. Jamais par le texte d'un message.
 *
 * Ce module NOMME et décide la seule reprise ; il ne rend rien non bloquant, ne publie, ne ferme ni ne retient rien.
 */
import { isDecidedKnownFailure, KNOWN_FAILURE_DECISION, type IngestionIssue } from '../lib/ingestionIssue.js';
import { CAUSES, issueCause, TRAJECTORY_LABEL, type CauseClass, type Trajectory } from './sourceState.js';

/** La famille de panne passagère qu'une reprise peut lever, ou null. Par la classe de l'erreur, jamais par son texte. Pure. */
export type TransientKind = 'DATABASE' | 'TRANSPORT';
export function transientKind(issue: Pick<IngestionIssue, 'origin' | 'code' | 'detail'>): TransientKind | null {
  if (issue.origin === 'INTERNAL' && issue.code === 'DATABASE_FAILURE') return 'DATABASE';
  if (issue.code.startsWith('TRANSPORT_') && issueCause(issue) === 'INDISPONIBILITE_PASSAGERE') return 'TRANSPORT';
  return null;
}

export type Remediation = {
  /** La classe du vocabulaire unique (`sourceState.ts`) ; null pour une retenue prouvée par la source. */
  cause: CauseClass | null;
  trajectory: Trajectory | null;
  label: string;
  expected: string;
  /** La famille passagère de l'issue, s'il y en a une (inscrite au journal : c'est elle que lit l'escalade). */
  transient: TransientKind | null;
  /** Reprise une fois dans ce RUN. */
  retry: boolean;
  /** La même famille passagère était déjà là au RUN complet précédent : elle n'est plus reprise. */
  seenAtPreviousRun: boolean;
  /** La reprise de ce RUN a échoué à son tour. */
  retryFailed: boolean;
  /** D-480 §1 : échec connu décidé pour cette source et ce défaut. */
  decided?: string;
};

const RETENTION = { label: 'retenue prouvée par la source', expected: 'rien : retenue sur la preuve de l’éditeur (D-453 §1)' };

/**
 * La remédiation d'une issue de `source`. `previousTransient` : les familles passagères que la même source portait au
 * RUN complet précédent ; `retried` : cette issue vient de la reprise du RUN. Pure.
 */
export function remediationOf(source: string, issue: IngestionIssue, note: string | null = null,
  previousTransient: ReadonlySet<TransientKind> = new Set(), retried = false): Remediation {
  const cause = issueCause(issue, note);
  const transient = transientKind(issue);
  const seenAtPreviousRun = transient !== null && previousTransient.has(transient);
  const base = { cause, transient, seenAtPreviousRun, retryFailed: transient !== null && retried };
  if (!cause) return { ...base, trajectory: null, ...RETENTION, retry: false };
  const spec = CAUSES[cause];
  if (isDecidedKnownFailure(source, issue))
    return { ...base, trajectory: 'DECISION', label: spec.label, expected: `rien : échec connu décidé (${KNOWN_FAILURE_DECISION})`, retry: false, decided: KNOWN_FAILURE_DECISION };
  const retry = transient !== null && !seenAtPreviousRun && !retried;
  // Une panne passagère qui revient, ou que la reprise n'a pas levée, n'est plus présumée passagère : à réparer.
  const persistent = transient !== null && (seenAtPreviousRun || retried);
  return { ...base, trajectory: persistent ? 'A_REPARER' : spec.trajectory, label: spec.label, retry,
    expected: retry ? `reprise une fois en fin de RUN ; sinon : ${spec.missing}` : spec.missing };
}

/** Le mot du bilan : la classe, puis où elle va. */
export function remediationNote(r: Remediation): string {
  const where = r.trajectory ? TRAJECTORY_LABEL[r.trajectory] : 'normal';
  const extra = r.retryFailed ? ', reprise échouée' : r.seenAtPreviousRun ? ', déjà là au RUN complet précédent' : r.retry ? ', reprise dans ce RUN' : '';
  return `${r.label} → ${where}${extra}`;
}

/** La ligne de l'alerte : la trajectoire, puis ce qui manque. */
export function remediationLine(r: Remediation): string {
  return `${remediationNote(r)} : ${r.expected}`;
}
