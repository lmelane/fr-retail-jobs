/**
 * LE REGISTRE DES SITUATIONS INVÉRIFIABLES.
 *
 * Une offre dont on ne peut pas vérifier l'ouverture ne doit être ni déclarée ouverte indéfiniment, ni fermée
 * sans preuve. Elle doit avoir un ÉTAT, un MOTIF, une ANCIENNETÉ, une ACTION SUIVANTE et une CONDITION DE
 * RÉSOLUTION — sinon « on ne sait pas » devient « on ne regarde plus ».
 *
 * Ce module ne contient aucune règle de fermeture : il CLASSE. La décision de fermer reste à `runRefresh`, et le
 * droit de le faire à `isTrustedForAttestation`. Ici on répond à : *que fait-on de ce cas, et quand est-il clos ?*
 *
 * Deux familles, à ne jamais confondre :
 *
 *   RETENUE (`SourceObservation`)  l'offre a été VUE dans le listing, mais n'est pas publiée par cette collecte ;
 *                                 une publication antérieure ne se retire que si le motif porte une disposition
 *                                 (`publicationHold.ts`). Le défaut est celui de CETTE offre.
 *   SOURCE SANS DROIT D'ATTESTER  la source n'a pas pu prouver avoir lu son board. Ses offres restent publiées
 *                                 telles quelles ; c'est leur FERMETURE qui est suspendue, pas leur existence.
 *
 * Les états sont dérivés de ce qui est déjà stocké (`SourceObservation.observedAt`, `SourceRun`), sans nouvelle
 * colonne ni écriture : un registre qui inventerait une date de première retenue serait pire qu'absent.
 */
import { NEGATIVE_PROOF_RETENTION, retentionClass } from './publicationDisposition.js';

/** Ce qui empêche de conclure, classé par NATURE et non par message d'erreur. */
export type UnverifiableKind =
  /**
   * La page de l'offre n'a pas pu être lue (réseau, 403, timeout, parsing). Technique, jamais une fermeture ;
   * à instruire, donc bloquant au RUN.
   */
  | 'DETAIL_UNREADABLE'
  /**
   * La page a été lue mais ne nomme pas un fait indispensable : l'employeur d'une annonce Workday, sur un
   * portail non certifié mono-marque. Au RUN, c'est une retenue sur preuve de la source (D-453 §1), visible et
   * non bloquante sauf saut signalé par la garde technique de la preuve négative ; ici le cas reste à instruire,
   * car seule une certification du propriétaire du portail, sur preuve, permettrait de publier ces offres.
   */
  | 'DETAIL_INCOMPLETE'
  /**
   * La source publie elle-même la preuve que l'offre n'est pas à publier : candidature impossible sur son site
   * (close, page en erreur 404 ou 410, modèle expiré), retrait de son listing, publication de test, événement de
   * recrutement. Retenue non bloquante au RUN (D-453 §1, D-456 §1) : rien n'est à réparer, la preuve se relit.
   */
  | 'NATIVE_EVIDENCE'
  /**
   * L'éditeur contredit ses propres données. Aucun motif ne s'y classe depuis D-456 (le modèle expiré est une
   * preuve de la source) ; le type reste pour une contradiction nouvelle, à instruire et bloquante au RUN.
   */
  | 'PUBLISHER_CONTRADICTION'
  /** Décision de l'ÉQUIPE : l'offre sort du périmètre décidé en revue. Visible, non bloquante au RUN (D-456 §2). */
  | 'OUT_OF_PERIMETER'
  /**
   * La fin du listing n'est pas démontrée : énumération non prouvée (l'adaptateur ne sait pas la montrer) ou
   * réfutée (une coupure a été observée) — SourceRun ne garde pas laquelle, la note du run la nomme. L'absence
   * d'une offre n'y prouve rien ; bloquant au RUN dans les deux cas (D-453 §1).
   */
  | 'LISTING_NOT_ENUMERATED'
  /**
   * Aucun défaut de collecte nommé : énumération inconnue (l'adaptateur ne la déclare pas), premier run, ou statut
   * qui n'atteste pas. Ce n'est pas un incident au RUN, qui ne bloque pas dessus (`health.ts`) ; mais aucun droit
   * d'attester l'absence, que seule une énumération prouvée ouvre (`attestation.ts`, règle du 11/09).
   */
  | 'ENUMERATION_UNKNOWN'
  /** La collecte a échoué franchement (BROKEN, ERROR, TIMEOUT, CHALLENGED). */
  | 'COLLECTION_FAILED'
  /** Le volume s'est effondré face au dernier run productif : on attend une confirmation. */
  | 'VOLUME_COLLAPSED';

export type UnverifiableState =
  /** Suivi, en attente du prochain run : la condition de résolution est mécanique. */
  | 'AWAITING_NEXT_RUN'
  /** Le prochain run ne suffira pas : il faut une décision humaine ou un correctif. */
  | 'NEEDS_REVIEW'
  /** L'ancienneté dépasse le délai admis pour ce motif : à traiter, plus à attendre. */
  | 'OVERDUE';

/** Au-delà de ce délai, attendre n'est plus un traitement : le cas doit être instruit. */
export const OVERDUE_DAYS: Readonly<Record<UnverifiableKind, number>> = {
  // Un incident réseau se résout au run suivant ; s'il persiste une semaine, c'est un défaut installé.
  DETAIL_UNREADABLE: 7,
  // Un fait manquant dans le détail est un défaut d'adaptateur ou de portail : il ne se répare pas tout seul.
  DETAIL_INCOMPLETE: 3,
  // Choix TECHNIQUE, non arbitré (25/09/2026) : une preuve de la source n'attend rien, un marqueur qui persiste un
  // mois mérite pourtant une relecture.
  NATIVE_EVIDENCE: 30,
  // Une contradiction de l'éditeur ne se résoudra que s'il la corrige — ou par une décision de notre part.
  PUBLISHER_CONTRADICTION: 7,
  // Une décision de périmètre est déjà prise : rien n'est en attente, mais elle doit rester relue.
  OUT_OF_PERIMETER: 90,
  // Un listing non énuméré doit l'être : au-delà d'une semaine, la configuration est en cause.
  LISTING_NOT_ENUMERATED: 7,
  // Choix TECHNIQUE, non arbitré (25/09/2026) : rien ne bloque au RUN, le cas se relit une fois par trimestre.
  ENUMERATION_UNKNOWN: 90,
  // Une collecte en échec est l'incident le plus visible ; trois jours sans reprise est une panne.
  COLLECTION_FAILED: 3,
  // Un effondrement attend une confirmation par un run sain ; sans elle, il faut regarder la source.
  VOLUME_COLLAPSED: 3,
};

/** Ce qu'il faut faire ensuite, et à quelle condition le cas est clos. Une phrase chacun, actionnable. */
const TREATMENT: Readonly<Record<UnverifiableKind, { nextAction: string; resolvedWhen: string; state: UnverifiableState }>> = {
  DETAIL_UNREADABLE: {
    nextAction: 'Relire la page de l\'offre au prochain run borné de la source.',
    resolvedWhen: 'La page répond et le détail est exploitable, ou le listing cesse de lister l\'offre depuis un run fiable.',
    state: 'AWAITING_NEXT_RUN',
  },
  DETAIL_INCOMPLETE: {
    nextAction: 'Instruire le défaut : adaptateur (le fait existe et n\'est pas lu) ou portail (le fait est absent).',
    resolvedWhen: 'Le fait manquant est lu, ou une revue d\'identité autorise le propriétaire du portail certifié.',
    state: 'NEEDS_REVIEW',
  },
  NATIVE_EVIDENCE: {
    nextAction: 'Aucune collecte à refaire : la preuve vient de la source (D-453 §1, D-456 §1), non bloquante, visible au bilan du RUN.',
    resolvedWhen: 'La source republie l\'offre sans ce marqueur, ou la retire d\'un listing énuméré.',
    state: 'AWAITING_NEXT_RUN',
  },
  PUBLISHER_CONTRADICTION: {
    nextAction: 'Confronter la donnée contradictoire au listing : l\'offre est-elle encore énumérée ?',
    resolvedWhen: 'L\'éditeur corrige sa donnée, ou l\'offre disparaît d\'un listing énuméré.',
    state: 'NEEDS_REVIEW',
  },
  OUT_OF_PERIMETER: {
    nextAction: 'Aucune : la décision de périmètre de l\'équipe est archivée et s\'applique, non bloquante au RUN (D-456 §2).',
    resolvedWhen: 'Une nouvelle décision de périmètre réintègre l\'offre.',
    state: 'AWAITING_NEXT_RUN',
  },
  LISTING_NOT_ENUMERATED: {
    nextAction: 'Instruire selon la note du run : établir une preuve de parcours (énumération non prouvée) ou corriger la coupure observée (réfutée).',
    resolvedWhen: 'Un run rend un verdict d\'énumération PROVEN sur le périmètre où l\'offre doit apparaître.',
    state: 'NEEDS_REVIEW',
  },
  ENUMERATION_UNKNOWN: {
    nextAction: 'Aucune au RUN, qui ne bloque pas sur une énumération inconnue ; pour attester l\'absence, l\'adaptateur doit établir une preuve de parcours.',
    resolvedWhen: 'Un run rend un verdict d\'énumération PROVEN, ou nomme un défaut de collecte.',
    state: 'NEEDS_REVIEW',
  },
  COLLECTION_FAILED: {
    nextAction: 'Diagnostiquer la cause nommée du run (403, timeout, challenge, exception) avant tout autre travail.',
    resolvedWhen: 'Un run rend des offres sans erreur pour cette source.',
    state: 'NEEDS_REVIEW',
  },
  VOLUME_COLLAPSED: {
    nextAction: 'Confirmer ou infirmer la chute par un run borné sur cette seule source.',
    resolvedWhen: 'Un run sain confirme le nouveau volume, ou le volume revient à son ordre de grandeur.',
    state: 'AWAITING_NEXT_RUN',
  },
};

/**
 * La NATURE d'une retenue, depuis son motif.
 *
 * Le motif est une chaîne écrite par l'ingestion ; on la classe ici pour que le registre parle de causes et non
 * de libellés. Le registre et le RUN lisent LES MÊMES listes (`retentionClass`, D-453 §1, D-456) : une retenue
 * non bloquante au RUN n'apparaît jamais ici comme une panne ou une contradiction, et une retenue à instruire au
 * RUN n'apparaît jamais comme décidée. Un motif inconnu est classé `DETAIL_UNREADABLE` — le cas le plus prudent,
 * qui n'autorise rien.
 */
export function classifyHold(reason: string): UnverifiableKind {
  if (retentionClass(reason) === 'TEAM_DECISION') return 'OUT_OF_PERIMETER';
  if (reason === NEGATIVE_PROOF_RETENTION) return 'DETAIL_INCOMPLETE';
  if (retentionClass(reason) === 'NATIVE') return 'NATIVE_EVIDENCE';
  if (reason.endsWith('_FETCH_FAILED') || reason.includes('HTTP_')) return 'DETAIL_UNREADABLE';
  if (reason.includes('CONTRADICTION')) return 'PUBLISHER_CONTRADICTION';
  return 'DETAIL_UNREADABLE';
}

/**
 * La NATURE du blocage d'une source, depuis son dernier run.
 *
 * L'ordre est celui du diagnostic : un échec franc explique tout le reste, une troncature explique une absence,
 * un effondrement ne se lit qu'une fois les deux premiers écartés.
 */
export function classifySourceBlock(run: {
  status: string; complete?: boolean | null; truncated?: boolean | null; errors?: number | null;
  declaredTotal?: number | null; fetched?: number | null; previous?: number | null;
}): UnverifiableKind | null {
  if (['BROKEN', 'ERROR', 'TIMEOUT', 'CHALLENGED'].includes(run.status) || (run.errors ?? 0) > 0) return 'COLLECTION_FAILED';
  if (run.truncated || run.complete === false) return 'LISTING_NOT_ENUMERATED';
  if (run.declaredTotal && run.declaredTotal > 0 && (run.fetched ?? 0) / run.declaredTotal < 0.9) return 'LISTING_NOT_ENUMERATED';
  if (run.previous && run.previous > 0 && (run.fetched ?? 0) < run.previous * 0.5) return 'VOLUME_COLLAPSED';
  /**
   * Aucune des natures ci-dessus. Ce n'est PAS un droit d'attester : seule une énumération prouvée
   * (`complete === true`) en ouvre un (`attestation.ts`, règle du 11/09), et une énumération inconnue n'est pas
   * prouvée, même avec une référence stable. `null` dit seulement que le blocage ne tient à aucun défaut de
   * collecte nommé ici — l'énumération inconnue n'est pas un incident de santé.
   */
  return null;
}

export type UnverifiableEntry = {
  sourceKey: string;
  /** Absent pour un blocage de SOURCE : il porte sur tout le périmètre, pas sur une offre. */
  externalId?: string;
  kind: UnverifiableKind;
  reason: string;
  /** Première observation de cette situation. */
  firstHeldAt: Date;
  /** Dernière TENTATIVE de collecte — qui n'est pas une observation réussie. */
  lastAttemptAt: Date | null;
  /** Dernière observation FIABLE de l'offre ou de la source. Jamais écrasée par une tentative échouée. */
  lastReliableObservationAt: Date | null;
  ageDays: number;
  state: UnverifiableState;
  nextAction: string;
  resolvedWhen: string;
  /** Ce qui empêche la résolution, quand ce n'est pas seulement le temps. */
  blockedBy?: string;
};

/** Assemble une entrée du registre : l'état dépend de la nature ET de l'ancienneté. */
export function describeUnverifiable(input: {
  sourceKey: string; externalId?: string; kind: UnverifiableKind; reason: string;
  firstHeldAt: Date; lastAttemptAt?: Date | null; lastReliableObservationAt?: Date | null;
  now?: Date; blockedBy?: string;
}): UnverifiableEntry {
  const now = input.now ?? new Date();
  const ageDays = Math.floor((now.getTime() - input.firstHeldAt.getTime()) / 86_400_000);
  const treatment = TREATMENT[input.kind];
  return {
    sourceKey: input.sourceKey,
    ...(input.externalId ? { externalId: input.externalId } : {}),
    kind: input.kind,
    reason: input.reason,
    firstHeldAt: input.firstHeldAt,
    lastAttemptAt: input.lastAttemptAt ?? null,
    lastReliableObservationAt: input.lastReliableObservationAt ?? null,
    ageDays,
    // L'ancienneté l'emporte : un cas trop vieux n'est plus « en attente », quelle que soit sa nature.
    state: ageDays > OVERDUE_DAYS[input.kind] ? 'OVERDUE' : treatment.state,
    nextAction: treatment.nextAction,
    resolvedWhen: treatment.resolvedWhen,
    ...(input.blockedBy ? { blockedBy: input.blockedBy } : {}),
  };
}

/** Une retenue archivée, telle que la lit `scripts/coverage/unverifiable-register.mts`. */
export type HoldRow = { sourceKey: string; externalId: string; reason: string; first_held_at: Date; last_attempt: Date | null;
  representation_active: boolean | null; representation_last_seen: Date | null };
/** Une source dont le dernier run n'atteste pas l'absence, telle que la lit le même script. */
export type BlockedSourceRow = { sourceKey: string; status: string | null; complete: boolean | null; truncated: boolean | null;
  errors: number | null; declaredTotal: number | null; fetched: number | null; previousJobs: number | null;
  last_attempt: Date | null; last_reliable_run: Date | null; blocked_since: Date | null };

/** Une source qui n'atteste pas sans qu'aucun défaut de collecte ne soit nommé. */
export const NO_NAMED_DEFECT = 'AUCUN DÉFAUT DE COLLECTE NOMMÉ, PAS DE DROIT D\'ATTESTER';

/**
 * Les entrées du registre, depuis les lignes lues par le script : le script ne fait que lire et écrire, les
 * règles et les textes sont ici, sous témoin.
 */
export function registerEntries(holdRows: readonly HoldRow[], sourceRows: readonly BlockedSourceRow[], now: Date): UnverifiableEntry[] {
  const holds = holdRows.map(h => describeUnverifiable({
    sourceKey: h.sourceKey, externalId: h.externalId, kind: classifyHold(h.reason), reason: h.reason,
    firstHeldAt: h.first_held_at, lastAttemptAt: h.last_attempt,
    // Une retenue signifie précisément qu'on n'a pas pu publier cette offre : la dernière observation FIABLE est
    // celle de sa représentation publiée, si elle en a une. Sinon il n'y en a aucune.
    lastReliableObservationAt: h.representation_active ? h.representation_last_seen : null, now,
    ...(h.representation_active ? {} : { blockedBy: 'Offre non publiée : aucune observation fiable à comparer.' }),
  }));
  const sources = sourceRows.map(s => {
    const kind = classifySourceBlock({ status: s.status ?? 'NEW', complete: s.complete, truncated: s.truncated, errors: s.errors,
      declaredTotal: s.declaredTotal, fetched: s.fetched, previous: s.previousJobs });
    /**
     * `null` = aucun défaut de collecte nommé : ENUMERATION_UNKNOWN, non bloquant comme au RUN. Ce n'est PAS un droit
     * d'attester retrouvé : la source est dans cette liste parce que son dernier run n'atteste pas, et seule une
     * énumération prouvée en ouvre un (`attestation.ts`). Une énumération `complete: false` (non prouvée ou réfutée)
     * n'arrive jamais ici : elle est LISTING_NOT_ENUMERATED, bloquante.
     */
    return describeUnverifiable({
      sourceKey: s.sourceKey, kind: kind ?? 'ENUMERATION_UNKNOWN',
      reason: kind ? `${s.status ?? 'NEW'} (déclaré ${s.declaredTotal ?? 'n/d'}, lu ${s.fetched ?? 'n/d'}, précédent ${s.previousJobs ?? 'n/d'})` : NO_NAMED_DEFECT,
      firstHeldAt: s.blocked_since ?? s.last_attempt ?? now, lastAttemptAt: s.last_attempt, lastReliableObservationAt: s.last_reliable_run, now,
      blockedBy: kind ? undefined
        : 'Énumération inconnue (complete absent), premier run ou statut qui n\'atteste pas : aucun incident au RUN, mais aucun droit d\'attester l\'absence.',
    });
  });
  return [...holds, ...sources];
}
