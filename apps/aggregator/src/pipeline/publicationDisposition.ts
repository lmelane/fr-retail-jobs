import type { DeactivationDisposition } from './lifecycle.js';

/** Explicit publisher observations, distinct from parsing/network failures. */
const dispositions: Readonly<Record<string, DeactivationDisposition>> = {
  APPLICATION_HTTP_404: { kind: 'CLOSED' },
  APPLICATION_HTTP_410: { kind: 'CLOSED' },
  APPLICATION_EXPLICITLY_CLOSED: { kind: 'CLOSED' },
  SOURCE_UNLISTED: { kind: 'WITHDRAWN', reason: 'SOURCE_UNLISTED' },
  /** A reviewed PostingScopeDecision OUT_OF_SCOPE: published no more, never an employer closure, never re-opened by attestation. */
  SCOPE_OUT_OF_PERIMETER: { kind: 'WITHDRAWN', reason: 'OUT_OF_SCOPE' },
};
export function publicationDisposition(reason: string): DeactivationDisposition | undefined {
  return Object.hasOwn(dispositions, reason) ? dispositions[reason] : undefined;
}

/**
 * LES RETENUES QUI NE FONT PAS ÉCHOUER LE RUN, ET POURQUOI (D-453 §1, D-456).
 *
 * Une retenue reste visible dans le bilan et l'alerte ; seules celles-ci ne font pas échouer le RUN. Les deux
 * listes sont POSITIVES et FERMÉES : un motif absent reste « à instruire », donc bloquant.
 *
 * PREUVE DE LA SOURCE — c'est la source elle-même qui la publie :
 *   · la candidature impossible sur son site : close explicitement (exemple cité par D-453), page de
 *     candidature en erreur 404 ou marquée « modèle expiré » (D-456 §1), page supprimée en 410 (D-462) ;
 *   · l'employeur absent de l'annonce Workday, sous la politique revue du 09/09 (portail non certifié
 *     mono-marque ; exemple cité par D-453). C'est la seule preuve NÉGATIVE : la garde technique de `health.ts`
 *     la surveille ;
 *   · le retrait de son listing, la publication de test, l'événement de recrutement ou job dating (D-462).
 *
 * DÉCISION DE L'ÉQUIPE — l'exclusion de périmètre revue (`SCOPE_OUT_OF_PERIMETER`) : ce n'est pas une preuve
 * de la source, c'est un choix de Catwalks ; visible, non bloquant (D-456 §2), nommé comme tel.
 *
 * Restent à instruire : les échecs de lecture (`*_DETAIL_FETCH_FAILED`), les états que le lecteur ne reconnaît
 * pas (`UNRECOGNISED_*`), les conflits ou résolutions d'identité, tout motif nouveau.
 *
 * La garde de masse de JobAffinity (`jobaffinityWordpress.ts` : plus de la moitié des pages retirées sur
 * 50 offres ou plus = collecte refusée) reste en place : ces motifs ne changent que le verdict du RUN.
 */
const NATIVE_EVIDENCE_RETENTIONS: ReadonlySet<string> = new Set([
  'APPLICATION_EXPLICITLY_CLOSED', 'APPLICATION_HTTP_404', 'APPLICATION_HTTP_410', 'APPLICATION_TEMPLATE_EXPIRY_CONTRADICTION',
  'SOURCE_UNLISTED', 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL', 'NATIVE_TEST_PUBLICATION', 'NATIVE_RECRUITMENT_EVENT',
]);
const TEAM_DECISION_RETENTIONS: ReadonlySet<string> = new Set(['SCOPE_OUT_OF_PERIMETER']);
/** The only NEGATIVE native proof: the page does not name its employer. */
export const NEGATIVE_PROOF_RETENTION = 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL';

export function isNativeEvidenceRetention(reason: string): boolean {
  return NATIVE_EVIDENCE_RETENTIONS.has(reason);
}
export function isTeamDecisionRetention(reason: string): boolean {
  return TEAM_DECISION_RETENTIONS.has(reason);
}
export type RetentionClass = 'NATIVE' | 'TEAM_DECISION' | 'TO_INSTRUCT';
export function retentionClass(reason: string): RetentionClass {
  return isNativeEvidenceRetention(reason) ? 'NATIVE' : isTeamDecisionRetention(reason) ? 'TEAM_DECISION' : 'TO_INSTRUCT';
}

/**
 * What the operator reads, one text per reason (alert). Grouped by what the posting means for a candidate,
 * never by the technical code alone.
 */
const RETENTION_TEXT: Readonly<Record<string, string>> = {
  APPLICATION_EXPLICITLY_CLOSED: 'la source rend la candidature impossible (candidature close)',
  APPLICATION_HTTP_404: 'la source rend la candidature impossible (page de candidature en erreur 404)',
  APPLICATION_HTTP_410: 'la source rend la candidature impossible (page de candidature supprimée, 410)',
  APPLICATION_TEMPLATE_EXPIRY_CONTRADICTION: 'la source rend la candidature impossible (modèle expiré)',
  SOURCE_UNLISTED: 'retirée de son listing par la source',
  NATIVE_TEST_PUBLICATION: 'publication de test déclarée par la source',
  NATIVE_RECRUITMENT_EVENT: 'événement de recrutement déclaré par la source',
  SCOPE_OUT_OF_PERIMETER: 'écartée par l’équipe (hors périmètre)',
};
/**
 * The standing of each non-blocking reason, with the decision that settles it. Every non-blocking reason is now
 * arbitrated by the CEO (D-462, 25/09/2026, settled the 410, the listing withdrawal, the test publication and the
 * recruitment event). A reason missing here would print « application non arbitrée »: the witness in `lib/nativeRetention.test.ts`
 * requires « décidé » for each of the nine non-blocking reasons of 25/09.
 * A reason to instruct has no standing: it blocks. Nothing here decides: the list only says what DECISIONS.md holds.
 */
const DECIDED: Readonly<Record<string, string>> = {
  APPLICATION_EXPLICITLY_CLOSED: 'D-453 §1', // exemple cité par la décision
  WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 'D-453 §1', // exemple cité par la décision
  APPLICATION_HTTP_404: 'D-456 §1',
  APPLICATION_TEMPLATE_EXPIRY_CONTRADICTION: 'D-456 §1',
  SCOPE_OUT_OF_PERIMETER: 'D-456 §2',
  APPLICATION_HTTP_410: 'D-462',
  SOURCE_UNLISTED: 'D-462',
  NATIVE_TEST_PUBLICATION: 'D-462',
  NATIVE_RECRUITMENT_EVENT: 'D-462',
};
export type RetentionStatus = 'décidé' | 'application non arbitrée' | 'à instruire';
export function retentionStatus(reason: string): RetentionStatus {
  if (retentionClass(reason) === 'TO_INSTRUCT') return 'à instruire';
  return Object.hasOwn(DECIDED, reason) ? 'décidé' : 'application non arbitrée';
}
/** The status as the alert prints it: « décidé (D-456 §1) », « application non arbitrée », « à instruire ». */
export function retentionStatusLabel(reason: string): string {
  const status = retentionStatus(reason);
  return status === 'décidé' ? `décidé (${DECIDED[reason]})` : status;
}

/** `share` is the part of the source's collected postings this reason holds back (0..1). */
export function retentionText(reason: string, share: number): string {
  if (reason === NEGATIVE_PROOF_RETENTION) {
    return `l’annonce ne nomme pas l’employeur (${(share * 100).toFixed(1).replace('.', ',')} % des offres collectées de la source)`;
  }
  return RETENTION_TEXT[reason] ?? `à instruire (${reason})`;
}

/** Only explicit native evidence can lift a publisher's earlier unlisting. */
export function explicitlyListed(kind: string | undefined, raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  if (kind === 'ASHBY') return value.isListed === true;
  if (kind !== 'HARRI' || !value.detail || typeof value.detail !== 'object' || Array.isArray(value.detail)) return false;
  const detail = value.detail as Record<string, unknown>;
  return detail.status === 'PUBLISHED' && detail.access_mode !== 'PRIVATE' && detail.post_type !== 'PRIVATE' && detail.deleted !== true;
}
