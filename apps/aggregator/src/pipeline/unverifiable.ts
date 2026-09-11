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
 *   RETENUE (`SourceObservation`)  l'offre a été VUE dans le listing, mais sa page est inexploitable. Elle n'est
 *                                 pas publiée. Le défaut est celui de CETTE offre.
 *   SOURCE SANS DROIT D'ATTESTER  la source n'a pas pu prouver avoir lu son board. Ses offres restent publiées
 *                                 telles quelles ; c'est leur FERMETURE qui est suspendue, pas leur existence.
 *
 * Les états sont dérivés de ce qui est déjà stocké (`SourceObservation.observedAt`, `SourceRun`), sans nouvelle
 * colonne ni écriture : un registre qui inventerait une date de première retenue serait pire qu'absent.
 */

/** Ce qui empêche de conclure, classé par NATURE et non par message d'erreur. */
export type UnverifiableKind =
  /** La page de l'offre n'a pas pu être lue (réseau, 403, timeout, parsing). Technique, jamais une fermeture. */
  | 'DETAIL_UNREADABLE'
  /** La page a été lue mais un fait indispensable y manque (employeur absent du détail). */
  | 'DETAIL_INCOMPLETE'
  /** L'éditeur contredit ses propres données (validité expirée sur une offre encore listée). */
  | 'PUBLISHER_CONTRADICTION'
  /** L'offre sort du périmètre sectoriel décidé en revue. Acte administratif, pas un défaut. */
  | 'OUT_OF_PERIMETER'
  /** Le balayage n'a pas atteint la fin du listing : l'absence d'une offre n'y prouve rien. */
  | 'LISTING_NOT_ENUMERATED'
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
  // Une contradiction de l'éditeur ne se résoudra que s'il la corrige — ou par une décision de notre part.
  PUBLISHER_CONTRADICTION: 7,
  // Une décision de périmètre est déjà prise : rien n'est en attente, mais elle doit rester relue.
  OUT_OF_PERIMETER: 90,
  // Un listing non énuméré doit l'être : au-delà d'une semaine, la configuration est en cause.
  LISTING_NOT_ENUMERATED: 7,
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
  PUBLISHER_CONTRADICTION: {
    nextAction: 'Confronter la donnée contradictoire au listing : l\'offre est-elle encore énumérée ?',
    resolvedWhen: 'L\'éditeur corrige sa donnée, ou l\'offre disparaît d\'un listing énuméré.',
    state: 'NEEDS_REVIEW',
  },
  OUT_OF_PERIMETER: {
    nextAction: 'Aucune : la décision de périmètre est archivée et s\'applique.',
    resolvedWhen: 'Une nouvelle décision de périmètre réintègre l\'offre.',
    state: 'AWAITING_NEXT_RUN',
  },
  LISTING_NOT_ENUMERATED: {
    nextAction: 'Établir l\'énumération : partition par facette, ou relever le plafond de pages.',
    resolvedWhen: 'Un run rend un verdict d\'énumération PROVEN sur le périmètre où l\'offre doit apparaître.',
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
 * de libellés. Un motif inconnu est classé `DETAIL_UNREADABLE` — le cas le plus prudent, qui n'autorise rien.
 */
export function classifyHold(reason: string): UnverifiableKind {
  if (reason === 'SCOPE_OUT_OF_PERIMETER') return 'OUT_OF_PERIMETER';
  if (reason.endsWith('_FETCH_FAILED') || reason.includes('HTTP_')) return 'DETAIL_UNREADABLE';
  if (reason.includes('EXPIRY_CONTRADICTION') || reason.includes('EXPLICITLY_CLOSED')) return 'PUBLISHER_CONTRADICTION';
  if (reason.includes('ABSENT_IN_DETAIL')) return 'DETAIL_INCOMPLETE';
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
  // Rien ne bloque : `complete` inconnu avec une référence stable suffit désormais à attester.
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
