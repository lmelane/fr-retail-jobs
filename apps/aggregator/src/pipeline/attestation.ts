/**
 * Le DROIT D'ATTESTER — le garde-fou central du catalogue.
 *
 * Règle posée par Loïc le 2026-09-08, après le cas L'Oréal :
 *
 *   « Seul un run complet et fiable peut attester l'absence d'une offre. »
 *
 * Et son corollaire, qui est la vraie découverte :
 *
 *   0 offre retournée ≠ 0 offre publiée.
 *
 * La santé d'une source (OK / DEGRADED / BROKEN) et son DROIT D'ATTESTER sont
 * deux questions différentes, et les confondre a produit les deux pannes
 * mesurées ce jour :
 *
 *  - Une source peut être DEGRADED (descriptions manquantes) tout en ayant vu
 *    la totalité de son board : elle garde le droit d'attester, sinon plus
 *    aucune offre expirée ne se fermerait.
 *  - Une source peut avoir écrit 20 offres — donc franchir la garde « silent
 *    zero » de la purge — alors qu'elle en déclarait 109 : elle n'a PAS le
 *    droit de déclarer les 89 autres disparues (cas `lagardere-travel-retail`).
 *
 * Ce module ne ferme ni n'écrit rien. Il répond à une seule question, et cette
 * réponse est ensuite lue par la purge (ingest) et par la clôture (refresh).
 */

/** L'issue d'une exécution de source, du point de vue du cycle de vie. */
export type RunStatus = 'OK' | 'DEGRADED' | 'BROKEN' | 'NEW' | 'TIMEOUT' | 'ERROR' | 'CHALLENGED';

/**
 * Sous ce ratio de ce que la source ANNONCE, le balayage n'a pas vu son board :
 * il ne peut rien conclure sur ce qu'il n'a pas lu.
 *
 * 0,9 et non 1,0 : plusieurs ATS annoncent un total légèrement instable entre
 * la première et la dernière page (une offre publiée pendant le crawl), et
 * exiger l'exactitude bloquerait toute expiration normale.
 */
export const ATTESTATION_MIN_COVERAGE = 0.9;

/**
 * Une chute sous cette part du run précédent est un effondrement, pas une
 * journée d'expirations : c'est le motif exact de L'Oréal (1 711 → 0) et de
 * Michael Page. On refuse d'attester tant qu'un run sain ne l'a pas confirmé.
 */
const COLLAPSE_RATIO = 0.5;

/** Les issues qui ne prouvent rien sur ce que la source publie réellement. */
const NEVER_ATTESTS: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'BROKEN', // 0 offre sans erreur : clé tournée, chemin déplacé, anti-bot silencieux
  'TIMEOUT', // coupé avant la fin : le reste du board n'a pas été lu
  'ERROR', // exception : rien de ce run n'est exploitable
  'CHALLENGED', // WAF/anti-bot : on a lu une page d'attente, pas des offres
  'NEW', // aucun passé : rien à attester
]);

export type AttestationInput = {
  status: RunStatus;
  /** Le total que la SOURCE elle-même annonce pour son listing, si elle l'annonce. */
  declaredTotal?: number;
  /** Ce que le balayage a réellement collecté. */
  fetched?: number;
  /** Le balayage s'est arrêté sur un plafond de pages en produisant encore. */
  truncated?: boolean;
  /** Ce que le dernier run PRODUCTIF de cette source avait rendu. */
  previous?: number | null;
};

/**
 * Ce run a-t-il le droit de faire disparaître des offres qu'il n'a pas revues ?
 *
 * `false` ne signifie pas « la source est cassée » : il signifie « le silence de
 * ce run ne prouve pas l'absence ». Les offres non revues survivent alors telles
 * quelles jusqu'à un run digne de foi — une anomalie externe ne devient jamais
 * une suppression dans notre catalogue.
 */
export function isTrustedForAttestation(run: AttestationInput): boolean {
  if (NEVER_ATTESTS.has(run.status)) return false;

  // Le balayage s'est arrêté sur un plafond : par construction, il n'a pas
  // atteint la fin du board.
  if (run.truncated) return false;

  // La source annonce un total : on exige d'en avoir vu l'essentiel.
  if (run.declaredTotal && run.declaredTotal > 0) {
    const fetched = run.fetched ?? 0;
    if (fetched / run.declaredTotal < ATTESTATION_MIN_COVERAGE) return false;
  }

  // Effondrement inexpliqué face au dernier run productif.
  if (run.previous && run.previous > 0) {
    const fetched = run.fetched ?? 0;
    if (fetched < run.previous * COLLAPSE_RATIO) return false;
  }

  return true;
}
