/**
 * LE MODE OPÉRATIONNEL D'UNE SOURCE — ce qu'elle a le droit de faire, décidé sur des PREUVES.
 *
 * Le constat qui impose ce module : `status = ACTIVE` est un statut de CATALOGUE. Il dit qu'une source fait
 * partie du périmètre, jamais qu'elle a le droit de fermer des offres. Les traiter comme équivalents mène à
 * l'accident que P4 et P7 ont nommé : une source dont l'énumération n'est pas prouvée ferme des offres
 * vivantes parce qu'un passage ne les a pas revues.
 *
 * Quatre modes, et un seul par source :
 *
 *   FULL_AUTOMATION   collecte · publie · met à jour · FERME sur absence prouvée · rouvre
 *   PUBLISH_NO_CLOSE  collecte · publie · met à jour — **jamais** de fermeture sur absence
 *   EVIDENCE_ONLY     collecte bornée et archivage de preuves — aucune mutation publique
 *   PAUSED_BLOCKED    rien, avec motif et condition de reprise obligatoires
 *
 * ──────────────────────────────────────────────────────────────────────────────────────────────────────
 * LE PRINCIPE : ON N'EST JAMAIS ADMIS PAR DÉFAUT
 *
 * Le mode se GAGNE en satisfaisant des conditions mesurées. Une information absente ne vaut pas une
 * condition remplie : une source sans dernier run connu n'est pas « probablement saine », elle est
 * simplement non démontrée, et elle descend d'un cran. *Le droit de fermer une offre est le pouvoir le plus
 * destructeur du pipeline ; il ne s'accorde que sur preuve.*
 */

/** L'état d'une source, tel qu'il est LU — jamais déduit d'un autre champ. */
export type SourceEvidence = {
  readonly key: string;
  readonly status: string;                    // ACTIVE | PAUSED | …
  readonly hasConfig: boolean;
  readonly identityVerified: boolean;         // la revue LA PLUS RÉCENTE est VERIFIED
  readonly identityHashMatchesConfig: boolean;// et elle couvre la configuration actuelle (D59)
  readonly accessAllowed: boolean;            // verdict d'accès effectif favorable
  readonly tenantKey: string | null;
  readonly lastRunStatus: string | null;
  readonly lastRunComplete: boolean | null;
  readonly lastRunCanAttestAbsence: boolean | null;
  readonly lastRunAt: Date | null;
  readonly blockedReason?: string | null;     // blocage nommé, s'il existe
};

export const OPERATIONAL_MODES = [
  'FULL_AUTOMATION', 'PUBLISH_NO_CLOSE', 'EVIDENCE_ONLY', 'PAUSED_BLOCKED',
] as const;
export type OperationalMode = (typeof OPERATIONAL_MODES)[number];

export type ModeDecision = {
  readonly mode: OperationalMode;
  /** Ce qui a décidé — pas un score, des faits nommés, pour qu'une décision se conteste. */
  readonly reasons: readonly string[];
  /** L'action qui ferait progresser cette source. Jamais vide : aucune source ne reste « à vérifier ». */
  readonly nextAction: string;
};

/** Statuts de dernier run qui attestent d'une collecte exploitable. */
const HEALTHY_RUN = new Set(['OK', 'DEGRADED', 'NEW']);
/** Statuts qui disent explicitement que la collecte a échoué ou n'a pas vu le board entier. */
const FAILED_RUN = new Set(['BROKEN', 'ERROR', 'TIMEOUT', 'CHALLENGED', 'INTERRUPTED', 'FAILED']);

/**
 * Décide le mode. Aucune source n'en sort sans mode ni sans prochaine action.
 *
 * L'ordre des tests suit la sévérité : ce qui interdit toute collecte d'abord, ce qui interdit la
 * publication ensuite, ce qui interdit seulement la fermeture enfin.
 */
export function decideMode(e: SourceEvidence): ModeDecision {
  const reasons: string[] = [];

  // ── 1. Blocages qui interdisent toute collecte automatique.
  if (e.status === 'PAUSED') {
    return {
      mode: 'PAUSED_BLOCKED',
      reasons: [`source en PAUSED${e.blockedReason ? ` : ${e.blockedReason}` : ''}`],
      nextAction: e.blockedReason
        ? `lever le blocage nommé : ${e.blockedReason}`
        : 'documenter le motif de pause et sa condition de reprise',
    };
  }
  if (e.blockedReason) {
    return { mode: 'PAUSED_BLOCKED', reasons: [`blocage nommé : ${e.blockedReason}`],
      nextAction: `lever le blocage : ${e.blockedReason}` };
  }
  if (!e.hasConfig) {
    return { mode: 'PAUSED_BLOCKED', reasons: ['aucune configuration d\'adaptateur'],
      nextAction: 'renseigner la configuration de l\'adaptateur, puis revalider' };
  }
  if (!e.accessAllowed) {
    return { mode: 'PAUSED_BLOCKED', reasons: ['verdict d\'accès non favorable'],
      nextAction: 'relire le robots.txt à la source et établir la base d\'autorisation (D62)' };
  }

  // ── 2. L'identité : sans elle, on peut collecter pour prouver, jamais publier sous un nom.
  if (!e.identityVerified) {
    reasons.push('identité non certifiée');
    return { mode: 'EVIDENCE_ONLY', reasons,
      nextAction: 'produire la preuve de portail (D60) et enregistrer la revue d\'identité' };
  }
  if (!e.identityHashMatchesConfig) {
    // D59 : une configuration modifiée ré-émet la certification. Une revue périmée ne vaut pas revue.
    reasons.push('revue d\'identité périmée : la configuration a changé depuis (D59)');
    return { mode: 'EVIDENCE_ONLY', reasons,
      nextAction: 're-certifier l\'identité pour la configuration actuelle' };
  }
  reasons.push('identité certifiée et valide pour la configuration actuelle');

  // ── 3. La collecte : un run en échec ne publie pas.
  if (!e.lastRunStatus) {
    reasons.push('aucun run connu');
    return { mode: 'EVIDENCE_ONLY', reasons,
      nextAction: 'exécuter une ingestion bornée pour établir un premier run' };
  }
  if (FAILED_RUN.has(e.lastRunStatus)) {
    reasons.push(`dernier run ${e.lastRunStatus}`);
    return { mode: 'EVIDENCE_ONLY', reasons,
      nextAction: `diagnostiquer l'échec ${e.lastRunStatus} et rejouer une ingestion bornée` };
  }
  if (!HEALTHY_RUN.has(e.lastRunStatus)) {
    // Un statut inconnu n'est pas une autorisation : on ne suppose pas ce qu'on ne sait pas lire.
    reasons.push(`statut de run non reconnu : ${e.lastRunStatus}`);
    return { mode: 'EVIDENCE_ONLY', reasons,
      nextAction: `qualifier le statut de run « ${e.lastRunStatus} »` };
  }
  reasons.push(`dernier run ${e.lastRunStatus}`);

  // ── 4. Le droit de FERMER : il exige que le parcours ait été prouvé.
  if (e.lastRunComplete !== true || e.lastRunCanAttestAbsence !== true) {
    reasons.push(
      e.lastRunComplete !== true ? 'énumération non prouvée (complete ≠ true)' : 'droit d\'attester une absence refusé');
    return { mode: 'PUBLISH_NO_CLOSE', reasons,
      nextAction: 'prouver l\'énumération complète du board avant d\'autoriser la fermeture' };
  }
  if (!e.tenantKey) {
    // Sans clé de tenant, la politesse réseau n'a pas de grain : on publie, on ne pilote pas de fermeture.
    reasons.push('aucune clé de tenant');
    return { mode: 'PUBLISH_NO_CLOSE', reasons, nextAction: 'déterminer la clé de limitation par tenant' };
  }

  reasons.push('énumération prouvée', 'droit d\'attester une absence accordé');
  return { mode: 'FULL_AUTOMATION', reasons, nextAction: 'aucune — surveiller le prochain cycle' };
}

/** Les modes qui autorisent une collecte automatique. */
export function collectsAutomatically(mode: OperationalMode): boolean {
  return mode !== 'PAUSED_BLOCKED';
}

/** Les modes qui autorisent la publication d'offres. */
export function publishes(mode: OperationalMode): boolean {
  return mode === 'FULL_AUTOMATION' || mode === 'PUBLISH_NO_CLOSE';
}

/** Le seul mode qui autorise une fermeture sur absence. Lu par le refresh. */
export function mayCloseOnAbsence(mode: OperationalMode): boolean {
  return mode === 'FULL_AUTOMATION';
}
