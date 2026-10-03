import type { DeactivationDisposition } from './lifecycle.js';

/** Explicit publisher observations, distinct from parsing/network failures. */
const dispositions: Readonly<Record<string, DeactivationDisposition>> = {
  APPLICATION_HTTP_404: { kind: 'CLOSED' },
  APPLICATION_HTTP_410: { kind: 'CLOSED' },
  APPLICATION_EXPLICITLY_CLOSED: { kind: 'CLOSED' },
  SOURCE_UNLISTED: { kind: 'WITHDRAWN', reason: 'SOURCE_UNLISTED' },
  /** A reviewed PostingScopeDecision OUT_OF_SCOPE: published no more, never an employer closure, never re-opened by attestation. */
  SCOPE_OUT_OF_PERIMETER: { kind: 'WITHDRAWN', reason: 'OUT_OF_SCOPE' },
  /**
   * D-508 §4 puis D-511 (02/10/2026) : une candidature spontanée que la source publie dans sa liste d'offres n'est pas
   * une offre, quelle que soit la source (preuve native : champ de l'éditeur ou libellé, `spontaneousApplication.ts` ;
   * Marc O'Polo : catégorie « Initiativ »), et D-512 : un vivier qui ne nomme aucun poste. Elle n'est pas publiée, et une publication antérieure est retirée, jamais
   * fermée au nom de l'employeur ni rouverte par une attestation (`canRefreshReactivate` ne rouvre que ATTESTATION_MISSING).
   */
  NATIVE_SPONTANEOUS_APPLICATION: { kind: 'WITHDRAWN', reason: 'OUT_OF_SCOPE' },
  /**
   * D-514 §4 (02/10/2026) : le poste que TalentRecruiter liste sans annonce publiée (`talentRecruiter.ts`) est une offre
   * que l'éditeur retire. Retrait `SOURCE_UNLISTED`, jamais une fermeture au nom de l'employeur : l'éditeur ne publie plus
   * l'offre, et seule une annonce de nouveau publiée la republie (`explicitlyListed`).
   */
  NATIVE_ADVERTISEMENT_WITHDRAWN: { kind: 'WITHDRAWN', reason: 'SOURCE_UNLISTED' },
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
 *     mono-marque ; exemple cité par D-453). C'est une preuve NÉGATIVE : la garde technique de `health.ts`
 *     la surveille ;
 *   · le retrait de son listing, la publication de test, l'événement de recrutement ou job dating (D-462) ;
 *   · la description que l'éditeur laisse lui-même vide, sur une fiche LUE (D-481 §3, 30/09/2026) — jamais une
 *     fiche que nous n'avons pas su lire, qui reste refusée et comptée. C'est la seconde preuve NÉGATIVE : la garde
 *     technique de `health.ts` la surveille aussi ;
 *   · le poste que TalentRecruiter liste avec un tableau d'annonces explicitement vide (D-514 §4, 02/10/2026) : l'offre
 *     qu'il retire. Un tableau absent, une annonce au texte vide ou une fiche illisible restent des anomalies ;
 *   · la fiche Workday que l'éditeur refuse en la nommant, `403 {"errorCode":"S22",…,"message":"permission denied"}`
 *     (D-484 §1, 30/09/2026) : l'offre qu'il retire. La preuve est ce corps, jamais le seul statut ; sous la garde
 *     de masse de `health.ts` (`MASS_GUARDED_RETENTIONS`).
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
  'NATIVE_DESCRIPTION_EMPTY', 'WORKDAY_DETAIL_PERMISSION_DENIED', 'NATIVE_SPONTANEOUS_APPLICATION', 'NATIVE_ADVERTISEMENT_WITHDRAWN',
]);
const TEAM_DECISION_RETENTIONS: ReadonlySet<string> = new Set(['SCOPE_OUT_OF_PERIMETER']);
/** The Workday NEGATIVE native proof: the page does not name its employer (its registry entry stays to instruct). */
export const NEGATIVE_PROOF_RETENTION = 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL';
/**
 * LES PREUVES NÉGATIVES que la garde technique de `health.ts` surveille, avec le mot que sa note imprime.
 *
 * Une preuve négative se lit comme une ABSENCE dans la fiche : un changement de format de l'éditeur la produit à
 * l'identique, et d'un coup sur une part de la source. La description vide (D-481 §3) en est une, sur le champ même
 * où 3 780 descriptions Eightfold ont déjà disparu sans alerte derrière une clé renommée : la même garde s'y applique.
 * Liste fermée ; les preuves positives de la source n'y entrent jamais.
 */
export const GUARDED_NEGATIVE_PROOFS: Readonly<Record<string, string>> = {
  WORKDAY_EMPLOYER_ABSENT_IN_DETAIL: 'employeur absent',
  NATIVE_DESCRIPTION_EMPTY: 'description vide chez l’éditeur',
};

/**
 * LA GARDE DE MASSE (D-484 §1) : un refus nommé par l'éditeur prouve le retrait d'UNE offre ; le même refus sur une
 * part de la source est une panne ou un blocage, pas une vague de retraits. Au-delà de max(`floor`, `share` × fiches
 * collectées), la source est bloquante (`health.ts`, `NATIVE_REFUSAL_MASS`). 16 refus mesurés en 12 jours sur 976
 * captures, jamais plus de 2 par capture.
 */
export const MASS_GUARDED_RETENTIONS: Readonly<Record<string, { label: string; floor: number; share: number }>> = {
  WORKDAY_DETAIL_PERMISSION_DENIED: { label: 'fiches refusées par l’éditeur (Workday S22)', floor: 5, share: 0.05 },
  /**
   * D-511 et D-512 (02/10/2026) : le vivier sans poste est une DÉDUCTION (le reste de l'intitulé ne nomme que le lieu
   * ou la Maison de l'offre) ; un changement d'intitulés ou de champs chez l'éditeur la produirait d'un coup sur une part
   * de la source. Au-delà de
   * max(20, 25 %) des fiches collectées, la source bloque le RUN (le retrait, lui, a déjà eu lieu : la garde alerte, elle
   * ne l'empêche pas). Calibrage mesuré (`audits/2026-10-02/d512-viviers/garde-de-masse.sql`) : le premier passage
   * légitime le plus lourd est Mejuri, 16 viviers sur 188 fiches (8,5 %, sous le plancher absolu de 20) ; lerros, faite
   * d'une seule candidature spontanée, 1 sur 1, sous le même plancher ; aucune source de D-511 n'en retient plus de 4.
   * Le seuil s'applique à chaque RUN, pas seulement au premier : les viviers restent listés et retenus à chaque collecte.
   */
  NATIVE_SPONTANEOUS_APPLICATION: { label: 'candidatures spontanées ou viviers sans poste retenus', floor: 20, share: 0.25 },
  /**
   * D-514 §4 (02/10/2026) : le poste que TalentRecruiter liste sans annonce est une preuve NÉGATIVE (un tableau vide) ; un
   * changement de format de l'éditeur viderait d'un coup toutes les annonces et retirerait tout le catalogue. Calibré sur
   * le seul catalogue concerné (GANNI, 12 à 21 postes) : la plus forte vague réelle est de 10 postes sur 20 lus (01/10,
   * 50 %), les autres jours 0 ou 1. Au-delà de max(5, 60 %) des fiches collectées, la source bloque le RUN : la vague du
   * 01/10 passe (borne 12), un catalogue entier sans annonce bloque dès 6 postes (12 sur 12 : borne 7,2). En dessous, la
   * validation native refuse déjà une collecte sans aucune offre qualifiée (`NO_QUALIFIED_PUBLICATION`).
   */
  NATIVE_ADVERTISEMENT_WITHDRAWN: { label: 'postes listés sans annonce (TalentRecruiter)', floor: 5, share: 0.6 },
};
/**
 * D-523 §3 (03/10/2026) : une offre dont la fiche n'a pas de contenu exploitable (vide ou illisible pour notre lecteur) est
 * RETENUE, avec cette cause ; la source n'est plus refusée pour elle. Ce n'est pas une preuve de la source (D-481 §3 réserve
 * la description vide chez l'éditeur à une fiche LUE et reconnue comme telle) : motif à instruire, sans disposition (une
 * publication antérieure reste en ligne). Sous le seuil de tolérance du 19/09 (`unqualifiedAllowanceFor`), la retenue ne fait
 * pas un défaut de la source ; au-delà, elle est à instruire ; la quasi-totalité des fiches sans contenu est un soupçon de
 * lecture (`health.ts`, DETAIL_READABILITY_COLLAPSE, classé « lecteur »).
 */
export const DETAIL_CONTENT_MISSING = 'DETAIL_CONTENT_MISSING';

/** D-514 §4 : le motif de la retenue d'un poste TalentRecruiter listé sans annonce (`talentRecruiter.ts`). */
export const ADVERTISEMENT_WITHDRAWN_RETENTION = 'NATIVE_ADVERTISEMENT_WITHDRAWN';

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
  NATIVE_DESCRIPTION_EMPTY: 'la source publie l’offre sans description (fiche lue, vide ou réduite à ses titres de rubrique)',
  WORKDAY_DETAIL_PERMISSION_DENIED: 'refusée par l’éditeur (Workday S22)',
  SCOPE_OUT_OF_PERIMETER: 'écartée par l’équipe (hors périmètre)',
  NATIVE_SPONTANEOUS_APPLICATION: 'candidature spontanée ou vivier sans poste publié par la source parmi ses offres',
  NATIVE_ADVERTISEMENT_WITHDRAWN: 'listée par la source sans annonce publiée (offre retirée)',
  DETAIL_CONTENT_MISSING: 'fiche sans contenu exploitable (vide ou illisible pour notre lecteur), retenue (D-523 §3)',
};
/**
 * The standing of each non-blocking reason, with the decision that settles it. Every non-blocking reason is now
 * arbitrated by the CEO (D-462, 25/09/2026, settled the 410, the listing withdrawal, the test publication and the
 * recruitment event). A reason missing here would print « application non arbitrée »: the witness in `lib/nativeRetention.test.ts`
 * requires « décidé » for each of the nine non-blocking reasons of 25/09, and for the description left empty by
 * the publisher (D-481 §3, 30/09).
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
  NATIVE_DESCRIPTION_EMPTY: 'D-481 §3',
  WORKDAY_DETAIL_PERMISSION_DENIED: 'D-484 §1',
  NATIVE_SPONTANEOUS_APPLICATION: 'D-508 §4, D-511, D-512',
  NATIVE_ADVERTISEMENT_WITHDRAWN: 'D-514 §4',
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
  // D-514 §4 : l'annonce de nouveau publiée, symétrique exacte de la retenue (un tableau d'annonces explicitement vide).
  if (kind === 'TALENT_RECRUITER') {
    const position = value.position as Record<string, unknown> | undefined;
    return !!position && typeof position === 'object' && position.ProjectType === 'RecruitmentProject' &&
      Array.isArray(position.Advertisements) && position.Advertisements.length > 0;
  }
  if (kind !== 'HARRI' || !value.detail || typeof value.detail !== 'object' || Array.isArray(value.detail)) return false;
  const detail = value.detail as Record<string, unknown>;
  return detail.status === 'PUBLISHED' && detail.access_mode !== 'PRIVATE' && detail.post_type !== 'PRIVATE' && detail.deleted !== true;
}
