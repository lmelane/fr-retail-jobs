/**
 * A-T-ON VU LA FIN DU LISTING ? — une question, une réponse à TROIS valeurs.
 *
 * Le défaut mesuré le 2026-09-11 : `complete` était un booléen qui répondait à trois questions différentes, et
 * dont l'absence de réponse valait « non ». Résultat, **187 sources portant 20 796 représentations vivantes**
 * avaient lu tout ce qu'elles déclaraient, sans erreur ni troncature, et ne pouvaient plus attester l'absence
 * d'une offre. Leurs offres ne se fermaient plus jamais.
 *
 * Trois causes y étaient confondues :
 *
 *   (a) une SEULE page défectueuse mettait `complete = false` pour toute la source
 *       (tapestry : 5 retenues sur 2 091 offres lues ; vf-corporation : 695 sur 1 273) ;
 *   (b) un adaptateur qui ne déclare aucun total rendait `complete = false`
 *       (boots 1 472 offres, pvh 1 358, adidas 1 069) — or **inconnu n'est pas incomplet** ;
 *   (c) une unité d'écart sur un total déclaré rendait `complete = false` (kering 1 025/1 026).
 *
 * D'où trois valeurs explicites :
 *
 *   PROVEN      on a **atteint la fin du parcours**, et on peut le montrer ;
 *   UNKNOWN     on ne sait pas si on a tout vu — suivi et mesuré, mais **aucun droit de fermer** ;
 *   REFUTED     on a la preuve du contraire : troncature, cycle, contradiction du compteur.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * RÈGLE MÉTIER IMPOSÉE LE 2026-09-11 (arbitrage du propriétaire) — LA PREUVE EST UN PARCOURS, PAS UN RATIO.
 *
 * La première version de ce module laissait un RATIO produire `PROVEN` : atteindre 90 % d'un total déclaré
 * suffisait. C'était faux, et l'objection est exacte : **une couverture de 90 % n'atteste rien sur les 10 %
 * non lus** — l'offre disparue est précisément celle qu'on n'a pas vue. De même, un volume stable ou supérieur
 * à la moitié du run précédent ne prouve pas que le MÊME PÉRIMÈTRE a été parcouru : 1 000 offres lues peuvent
 * être 1 000 offres différentes.
 *
 * Donc, désormais :
 *
 *   · seul un PARCOURS DÉMONTRÉ produit `PROVEN` — fin d'endpoint, fin de pagination, ou toutes les partitions ;
 *   · les seuils de 0,9 (couverture) et 0,5 (effondrement) restent des INDICATEURS DE SANTÉ et de régression,
 *     jamais une preuve de disparition. Ils peuvent REFUTER, ils ne peuvent plus PROUVER ;
 *   · un écart au total déclaré ne devient `PROVEN` que si le parcours est démontré par ailleurs ;
 *   · un ATS sans total peut être `PROVEN` : c'est le cas quand son protocole démontre la fin (Teamtailor rend
 *     `next_url: null`, Recruitee sert un endpoint unique non paginé, Personio une liste close).
 *
 * Ce que ce module NE fait PAS : juger la qualité du CONTENU. Une page dont l'employeur est illisible est un
 * défaut de cette offre-là ; elle ne dit rien sur le fait d'avoir atteint la fin du listing. Confondre les deux
 * était le défaut (a), et la correction des retenues individuelles est conservée : Tapestry 2 091/2 091 et VF
 * 1 273/1 273 restent `PROVEN`, car leur parcours est complet et leurs retenues ne touchent que certaines offres.
 */

/**
 * Le seuil de couverture d'un total déclaré. **Indicateur de santé** : sous ce seuil on REFUTE l'énumération ;
 * au-dessus on ne PROUVE rien — il faut un parcours démontré. Ce n'est plus une preuve de complétude.
 */
export const ENUMERATION_MIN_COVERAGE = 0.9;

export type EnumerationVerdict = 'PROVEN' | 'UNKNOWN' | 'REFUTED';

export type EnumerationInput = {
  /**
   * L'adaptateur DÉMONTRE avoir atteint la fin du parcours : dernière page sans continuation, endpoint unique
   * documenté comme complet, ou toutes les partitions lues. C'est la SEULE façon d'obtenir `PROVEN`.
   *
   * `false` est un refus explicite (l'adaptateur a vu la coupure) ; `undefined` signifie qu'il ne se prononce
   * pas — et une absence de démonstration n'est pas une démonstration.
   */
  adapterProvesCompletion?: boolean;
  /** Le total que la SOURCE annonce pour son listing, si elle l'annonce. */
  declaredTotal?: number;
  /** Le nombre d'identifiants DISTINCTS collectés. */
  uniqueCollected: number;
  /** Le balayage s'est arrêté sur un plafond de pages en produisant encore. */
  truncated?: boolean;
  /** Des lignes que l'adaptateur n'a pas su LIRE (une rejection expliquée n'en est pas une). */
  unreadableRows?: number;
};

/**
 * Le verdict d'énumération d'un run.
 *
 * L'ordre compte : une preuve du contraire l'emporte sur une démonstration d'adaptateur, sinon un adaptateur
 * optimiste couvrirait une troncature.
 */
export function enumerationVerdict(input: EnumerationInput): EnumerationVerdict {
  const { declaredTotal, uniqueCollected, truncated, unreadableRows = 0, adapterProvesCompletion } = input;

  // Une troncature est une preuve directe : le balayage s'est arrêté sur un plafond, la fin n'est pas atteinte.
  if (truncated) return 'REFUTED';

  /**
   * Un adaptateur qui REFUSE explicitement la preuve sait quelque chose que le compte ne dit pas — une page
   * d'index mal déclarée, une pagination dont il a vu la coupure. Son refus n'est pas rattrapable par un total
   * atteint : il l'emporte. (C'est le cas `complete: false` respecté depuis l'audit du 2026-09-09.)
   */
  if (adapterProvesCompletion === false) return 'REFUTED';

  /**
   * Un total déclaré à 0 en face d'offres réellement collectées est une CONTRADICTION, pas une absence de
   * déclaration : c'est la signature d'un en-tête de pagination manquant que l'adaptateur a lu comme un zéro.
   * Le traiter comme « inconnu » laisserait une source dont on sait que le compteur ment franchir la porte.
   */
  if (declaredTotal === 0 && uniqueCollected > 0) return 'REFUTED';

  /**
   * LA DÉMONSTRATION DU PARCOURS — la seule voie vers `PROVEN`.
   *
   * Elle est évaluée AVANT le compteur, volontairement : un adaptateur qui a vu la fin de sa pagination l'emporte
   * sur un compteur qui compte autre chose que des offres (PVH 1 374 offres pour 1 440 pages listées, Boots
   * 1 489/1 610, NARS 53/158 — audit 2026-09-09). Ordre retenu : troncature → refus → contradiction →
   * démonstration → compteur.
   *
   * Les rejections QUALIFIÉES par l'adaptateur n'arrivent pas dans `unreadableRows` : elles sont des témoins de
   * l'énumération, pas des trous dedans.
   */
  if (adapterProvesCompletion === true) return 'PROVEN';

  /**
   * Aucun parcours démontré. Le compteur de la source ne sert plus qu'à RÉFUTER : sous le seuil de couverture on
   * sait qu'une part substantielle du board manque. Au-dessus, il ne prouve rien.
   */
  const hasDeclared = declaredTotal !== undefined && Number.isSafeInteger(declaredTotal) && declaredTotal > 0;
  if (hasDeclared && uniqueCollected / declaredTotal! < ENUMERATION_MIN_COVERAGE) return 'REFUTED';

  /**
   * Qu'un total déclaré soit atteint (kering 1 025/1 026, tapestry 2 091/2 091 sans démonstration d'adaptateur)
   * ou qu'il n'y ait aucun total (boots 1 472), le résultat est le même : **on ne sait pas si on a vu la fin**.
   * `UNKNOWN`, donc aucun droit de fermer. C'est le changement du 2026-09-11 — auparavant un ratio atteint
   * valait `PROVEN`, ce qui attestait l'absence d'offres situées dans la part non lue.
   *
   * `unreadableRows` ne change rien ici : sans démonstration, on est déjà au maximum du doute.
   */
  return 'UNKNOWN';
}

/**
 * Traduction vers le booléen de `SourceRun.complete`.
 *
 * `UNKNOWN` devient `undefined`, jamais `false` : « on ne sait pas » n'est pas « on sait que non ». La différence
 * est portée par `isTrustedForAttestation`, où **seul `true` autorise à fermer**.
 */
export function verdictToComplete(verdict: EnumerationVerdict): boolean | undefined {
  return verdict === 'PROVEN' ? true : verdict === 'REFUTED' ? false : undefined;
}
