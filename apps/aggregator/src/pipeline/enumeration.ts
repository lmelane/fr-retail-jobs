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
 *   (c) une unité d'écart sur un total déclaré rendait `complete = false`
 *       (kering 1 025/1 026) — alors que le seuil de couverture de 0,9 l'accepterait.
 *
 * D'où trois valeurs explicites, et la règle qui les sépare :
 *
 *   PROVEN      le balayage a atteint la fin du listing, et on peut le montrer ;
 *   UNKNOWN     la source ne dit pas combien elle publie — on ne sait pas, et on ne prétend pas savoir ;
 *   REFUTED     on a la preuve du contraire : troncature, ou couverture sous le seuil.
 *
 * `UNKNOWN` n'autorise pas à fermer par défaut : l'arbitrage revient à `isTrustedForAttestation`, qui applique
 * alors la garde d'effondrement face au dernier run productif. C'est la seule preuve dont on dispose quand la
 * source ne déclare rien, et elle a déjà attrapé de vraies pannes (L'Oréal 1 711 → 0).
 *
 * Ce que ce module NE fait PAS : juger la qualité du CONTENU. Une page dont l'employeur est illisible est un
 * défaut de cette offre-là ; elle ne dit rien sur le fait d'avoir atteint la fin du listing. Confondre les deux
 * est exactement le défaut (a).
 */

/** La couverture minimale d'un total DÉCLARÉ sous laquelle le balayage n'a pas vu le board. */
export const ENUMERATION_MIN_COVERAGE = 0.9;

export type EnumerationVerdict = 'PROVEN' | 'UNKNOWN' | 'REFUTED';

export type EnumerationInput = {
  /** Ce que l'ADAPTATEUR affirme de sa propre énumération, quand il est en mesure de l'affirmer. */
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
 * L'ordre compte : une preuve du contraire l'emporte sur une affirmation d'adaptateur, sinon un adaptateur
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
   * L'adaptateur affirme avoir atteint la fin ET a qualifié lui-même les lignes qu'il a écartées (une page
   * expirée encore listée dans un sitemap est un TÉMOIN de l'énumération, pas un trou dedans). Son verdict
   * l'emporte alors sur l'écart au total déclaré, qui compte des pages et non des offres — PVH 1 374 offres
   * pour 1 440 pages listées, Boots 1 489/1 610, NARS 53/158 (audit du 2026-09-09).
   */
  if (adapterProvesCompletion === true) return 'PROVEN';

  const hasDeclared = declaredTotal !== undefined && Number.isSafeInteger(declaredTotal) && declaredTotal > 0;
  if (hasDeclared) {
    // La source annonce un total : la couverture tranche, avec la même tolérance qu'`isTrustedForAttestation`.
    // 0,9 et non 1,0 : plusieurs ATS annoncent un total qui bouge d'une page à l'autre (une offre publiée
    // pendant le balayage), et exiger l'exactitude bloquerait toute expiration normale — kering, 1 025/1 026.
    if (uniqueCollected / declaredTotal! < ENUMERATION_MIN_COVERAGE) return 'REFUTED';
    /**
     * Le total est atteint, mais l'adaptateur n'a rien affirmé (traité plus haut) et une ligne est ILLISIBLE :
     * elle peut contenir n'importe quoi, donc on ne peut plus dire « tout vu ». C'est du doute, donc `UNKNOWN` —
     * et non `REFUTED`, qui prétendrait une preuve d'incomplétude qu'on n'a pas.
     */
    if (unreadableRows > 0) return 'UNKNOWN';
    return 'PROVEN';
  }

  // Ni total déclaré, ni affirmation d'adaptateur : on ne sait pas. On ne dit ni oui ni non — et surtout on ne
  // le déguise pas en « incomplet ».
  return 'UNKNOWN';
}

/**
 * Traduction vers le booléen historique, pour les appelants qui n'ont pas encore été convertis.
 *
 * `UNKNOWN` devient `undefined`, jamais `false` : c'est précisément la confusion que ce module supprime, et
 * `isTrustedForAttestation` distingue déjà les deux (`complete !== true` refuse, mais la garde d'effondrement
 * reste le seul arbitre quand rien n'est déclaré).
 */
export function verdictToComplete(verdict: EnumerationVerdict): boolean | undefined {
  return verdict === 'PROVEN' ? true : verdict === 'REFUTED' ? false : undefined;
}
