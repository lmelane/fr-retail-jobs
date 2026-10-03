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
 *  - Une source peut avoir écrit 20 offres — donc franchir une simple garde de
 *    « zéro silencieux » — alors qu'elle en déclarait 109 : elle n'a PAS le
 *    droit de déclarer les 89 autres disparues (cas `lagardere-travel-retail`).
 *
 * Ce module ne ferme ni n'écrit rien. Il répond à une seule question, et cette
 * réponse est lue par la clôture (refresh) depuis les faits scellés de la capture
 * attestante (`attestingCapture.ts`), et par la santé (`health.ts`) à titre
 * d'indicateur. L'ancienne purge de génération, second lecteur, a été supprimée.
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
  /**
   * Le verdict d'énumération, en booléen : `true` PROUVÉ, `false` NON PROUVÉ OU RÉFUTÉ, `undefined` INCONNU.
   *
   * **Seul `true` peut autoriser une fermeture** (règle imposée le 2026-09-11). `true` ne s'obtient que par un
   * PARCOURS DÉMONTRÉ — fin d'endpoint, fin de pagination, ou toutes les partitions lues ; jamais par un ratio.
   * Voir `pipeline/enumeration.ts`.
   *
   * `false` et `undefined` refusent tous deux la fermeture, mais ne disent pas la même chose. `false` ne prouve pas
   * qu'une coupure a été vue : un flux RSS ou le parcours des liens d'une page d'accueil rendent `false` parce
   * qu'ils ne savent pas démontrer la fin. Le RUN distingue « non prouvée » et « réfutée » sur les faits observés
   * (`enumerationReading.ts`, D-453 §1) ; les deux sont des échecs à instruire. `undefined` n'est pas un incident.
   */
  complete?: boolean;
  errors?: number;
  /** Le total que la SOURCE elle-même annonce pour son listing, si elle l'annonce. */
  declaredTotal?: number;
  /** Ce que le balayage a réellement collecté. */
  fetched?: number;
  /** Le balayage s'est arrêté sur un plafond de pages en produisant encore. */
  truncated?: boolean;
  /** Ce que le dernier run PRODUCTIF de cette source avait rendu. */
  previous?: number | null;
  /** Ce que CE run a publié : seule base de la confirmation d'une chute par l'éditeur (D-484 §2). */
  published?: number;
  /** Le total que la source annonçait au run de `previous`, s'il était connu : l'autre moitié de cette confirmation. */
  previousDeclaredTotal?: number | null;
};

/**
 * D-484 §2 (arbitrage CEO du 30/09/2026) : UNE CHUTE CONFIRMÉE PAR L'ÉDITEUR N'EST PAS UN EFFONDREMENT.
 *
 * L'effondrement (moins de la moitié du run précédent) bloque le RUN et refuse l'attestation parce qu'il est ce
 * que produisent une clé tournée, un chemin déplacé ou un anti-bot : des offres qui disparaissent sans que la source
 * le dise. Il ne l'est pas quand la source le DIT, et seulement si les trois conditions de la décision tiennent :
 *   1. le total qu'elle annonce baisse dans la même proportion que les offres publiées ;
 *   2. la liste est prouvée complète (énumération prouvée, sans troncature ni erreur) ;
 *   3. 100 % des offres annoncées sont lues (`fetched` = total annoncé).
 * Tout autre cas reste un effondrement : compteur absent (aujourd'hui ou au run de référence), compteur stable,
 * énumération non prouvée, lecture partielle.
 *
 * « Même proportion » : les deux proportions sont `publiées / publiées avant` et `annoncé / annoncé avant` ; leur
 * rapport, `(publiées / annoncé) / (publiées avant / annoncé avant)`, doit rester à `CONFIRMED_DROP_TOLERANCE` de 1.
 * Mesuré sur les runs de production du 20 au 29/09/2026 (`scripts/ops/mesures/stabilite-couverture-annoncee.mts`) :
 * 1 053 couples de runs consécutifs de 166 sources, tous deux à énumération prouvée ; ce rapport s'écarte de 1 de
 * moins de 0,32 % dans 95 % des cas, de plus de 1 % dans 29 cas seulement : 9 entre 1 et 2,8 % (une ou deux offres
 * d'écart entre le compteur et la publication, un jour ordinaire) et 20 au-delà de 8 %, où la publication et le
 * compteur divergent — offres qui remontent sans que le compteur bouge (reprises d'identité du 23/09 : 1 → 34 offres
 * pour 34 annoncées), sources dont la plupart des offres sont retenues (Nike, Levi's) — exactement ce que la règle
 * doit continuer à bloquer. 5 % couvre tout le bruit ordinaire et aucun de ces cas. Aigle, le 29/09 : 121 → 60
 * publiées, 122 → 60 annoncées, rapport 1,008 (0,8 %).
 *
 * Limite assumée de la condition 3 : un éditeur qui compte des DIFFUSIONS là où nous lisons des annonces
 * (DigitalRecruiters, une annonce diffusée en plusieurs lieux) peut tout lire sans que `fetched` égale son total ;
 * sa chute reste alors bloquante. 1 277 des 1 353 runs prouvés de la même période lisent exactement leur total.
 */
export const CONFIRMED_DROP_TOLERANCE = 0.05;
export type DropConfirmationInput = Pick<AttestationInput, 'complete' | 'errors' | 'truncated' | 'declaredTotal' | 'fetched' | 'previous' | 'previousDeclaredTotal'> & {
  published: number;
};

/** Les trois conditions de D-484 §2 sur une chute de plus de moitié ; `false` pour tout ce qui n'est pas une telle chute. */
export function isPublisherConfirmedDrop(run: DropConfirmationInput): boolean {
  const { previous, previousDeclaredTotal: before, declaredTotal: after, published } = run;
  if (!previous || previous <= 0 || !(published < previous * COLLAPSE_RATIO)) return false;
  // 2. Liste prouvée complète.
  if (run.complete !== true || run.truncated === true || (run.errors ?? 0) > 0) return false;
  // 1. Un compteur des deux côtés — l'absence de l'un ou de l'autre ne confirme rien.
  if (!Number.isInteger(before) || before! <= 0 || !Number.isInteger(after) || after! <= 0) return false;
  // 3. Toutes les offres annoncées lues.
  if (run.fetched !== after) return false;
  // 1. La même proportion.
  return Math.abs((published / after!) / (previous / before!) - 1) <= CONFIRMED_DROP_TOLERANCE;
}

/** An explicit publisher zero plus completed collection is different from a silent empty response. */
export function isDeclaredEmptyEnumeration(run: Pick<AttestationInput, 'complete' | 'errors' | 'truncated' | 'declaredTotal' | 'fetched'>): boolean {
  return run.complete === true && run.errors === 0 && run.truncated !== true && run.declaredTotal === 0 && run.fetched === 0;
}

/**
 * D-523 (règle du CEO, 03/10/2026) — UNE LISTE COMPLÈTE PROUVÉE ET VIDE, sans total annoncé : parcours démontré, sans erreur
 * ni troncature, rien collecté, aucun total positif ne la contredit. Avec un total annoncé à 0 c'est le zéro annoncé
 * (`isDeclaredEmptyEnumeration`). `health.ts` en fait un zéro prouvé pour une source sans offre au dernier run productif ;
 * juste après des offres, c'est le cas où la distinction avec un lecteur qui perd tout est impossible (zéro non prouvé).
 * Elle ne donne PAS le droit d'attester : sans total annoncé à 0, la preuve scellée dit BROKEN et n'atteste rien
 * (`attestingCapture.ts`, `attestationFacts`).
 */
export function isCompleteEmptyListing(run: Pick<AttestationInput, 'complete' | 'errors' | 'truncated' | 'declaredTotal' | 'fetched'>): boolean {
  return run.complete === true && run.errors === 0 && run.truncated !== true && run.fetched === 0
    && (run.declaredTotal === 0 || run.declaredTotal === undefined || run.declaredTotal === null);
}

/**
 * Ce run a-t-il le droit de faire disparaître des offres qu'il n'a pas revues ?
 *
 * `false` ne signifie pas « la source est cassée » : il signifie « le silence de
 * ce run ne prouve pas l'absence ». Les offres non revues survivent alors telles
 * quelles jusqu'à un run digne de foi — une anomalie externe ne devient jamais
 * une suppression dans notre catalogue.
 */
export function isTrustedForAttestation(run: AttestationInput): boolean {
  /**
   * LA PORTE PRINCIPALE, ET ELLE EST FERMÉE PAR DÉFAUT : **seule une énumération PROUVÉE autorise à faire
   * disparaître une offre non revue.** (Règle imposée par le propriétaire le 2026-09-11.)
   *
   * Ce que la version précédente faisait, et qui était faux : elle acceptait `undefined` puis se rabattait sur
   * la couverture (0,9) et l'effondrement (0,5). Or ni l'un ni l'autre ne prouve qu'on a parcouru le même
   * périmètre — 90 % de couverture n'atteste RIEN sur les offres situées dans les 10 % non lus, et un volume
   * stable peut être composé d'offres entièrement différentes.
   *
   * Les deux seuils restent utilisés ci-dessous, mais uniquement pour REFUSER : ce sont des indicateurs de santé
   * et de régression, jamais une preuve de disparition.
   */
  if (run.complete !== true) return false;

  if (NEVER_ATTESTS.has(run.status) || (run.errors ?? 0) > 0) return false;

  // Le balayage s'est arrêté sur un plafond : par construction, il n'a pas
  // atteint la fin du board.
  if (run.truncated) return false;

  // Indicateur de santé : sous cette couverture d'un total déclaré, on refuse — même parcours démontré.
  if (run.declaredTotal && run.declaredTotal > 0) {
    const fetched = run.fetched ?? 0;
    if (fetched / run.declaredTotal < ATTESTATION_MIN_COVERAGE) return false;
  }

  /**
   * Effondrement inexpliqué face au dernier run productif.
   *
   * `fetched` INCONNU n'est pas `fetched = 0`. Mesuré le 2026-09-11 : **98 sources** dont le dernier run
   * précède l'ajout de cette colonne (runs des 5–6 septembre) portent `fetched: null` avec un volume
   * parfaitement stable par ailleurs (`jobs` 20, `previousJobs` 20). Les compter à zéro y lisait un
   * effondrement de 100 % qui n'a jamais eu lieu.
   *
   * Quand `fetched` manque, la comparaison ne peut pas se faire ici. Ce n'est pas un trou dans la garde : en
   * exécution, `health.ts` applique SA propre comparaison d'effondrement sur `result.jobs` — qui n'est jamais
   * nul — en plus de cette porte. La garde reste donc entière sur le chemin réel ; seules les lignes archivées
   * sans la colonne cessent d'être lues comme un effondrement inventé.
   */
  if (!isDeclaredEmptyEnumeration(run) && run.previous && run.previous > 0 && run.fetched != null) {
    // Sauf chute confirmée par l'éditeur (D-484 §2) : elle atteste comme toute liste prouvée.
    if (run.fetched < run.previous * COLLAPSE_RATIO &&
      !(run.published !== undefined && isPublisherConfirmedDrop({ ...run, published: run.published }))) return false;
  }

  return true;
}
