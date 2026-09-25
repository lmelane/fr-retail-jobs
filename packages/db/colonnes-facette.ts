/**
 * CE QUE CHAQUE FACETTE MESURE — une seule déclaration, pour tout le monde.
 *
 * ── LE DÉFAUT QUE CE MODULE FERME, ET SON COÛT MESURÉ ─────────────────────────────────────────
 *
 * Le 15/09/2026, le registre des marchés a été re-mesuré : la facette « métier » agrège
 * `occupationCode`, pas `jobFunction`. L'écart est de 42 points en moyenne — 96,8 % contre 53,9 %
 * sur le marché américain. Le registre a été corrigé (commit b33e628).
 *
 * Les OUTILS DE MESURE, eux, ne l'ont pas été. Le 17/09, les deux sondes qui servent à décider
 * quels marchés ouvrir lisaient encore `jobFunction`. Conséquence chiffrée sur la décision : la
 * Pologne, annoncée « métier exposable », tombe à 20,2 % sur la colonne réellement servie ; le
 * Danemark à 17,6 % et la Thaïlande à 16,7 % — SOUS le seuil d'exposition.
 *
 * La cause n'est pas l'erreur de colonne, c'est sa DUPLICATION : trois fichiers déclaraient
 * chacun leur propre correspondance dimension → colonne, et corriger l'un ne corrigeait pas les
 * autres. Ce module supprime cette duplication : il est la SEULE déclaration, et tout outil qui
 * mesure une facette la lit ici.
 *
 * ── CE QUE « MESURER COMME LA FACETTE » VEUT DIRE EXACTEMENT ──────────────────────────────────
 *
 * La facette servie au candidat est construite par `facette()` dans `apps/api/lib/job-search-query.ts` :
 *
 *     SELECT <colonne>::text AS value, count(*) FROM base b
 *      WHERE ... AND <colonne> IS NOT NULL AND <colonne>::text <> ''
 *      GROUP BY <colonne>
 *
 * Trois propriétés en découlent, et chacune a été VÉRIFIÉE en production le 17/09 :
 *
 *  1. l'expression comptée n'est pas toujours la colonne nue — `ville` agrège
 *     `lower(trim(city))`, `metier` agrège `COALESCE(occupationCode, 'unclassified')` ;
 *  2. la chaîne VIDE est exclue, alors que `count(colonne)` la compte. Mesuré : zéro chaîne vide
 *     sur les six dimensions, donc l'écart est nul AUJOURD'HUI — mais la règle reste celle de la
 *     facette, pas celle de `count()`, pour que l'apparition d'une chaîne vide ne crée pas
 *     silencieusement un écart ;
 *  3. la base est une UNION de `Job` et `DirectOffer`. Les sondes mesurent `Job` seul, et le disent
 *     (`POPULATION_MESUREE`) : depuis D-444 (lot du 25/09/2026, non livré), l'UNION porte le métier
 *     de la taxonomie des offres directes, que la facette compte et que la mesure n'inclut pas —
 *     59 offres au 25/09/2026, face à environ 76 000 offres agrégées.
 *
 * ── CE QUE CE MODULE NE FAIT PAS ──────────────────────────────────────────────────────────────
 *
 * Il ne décide RIEN. Il ne porte ni seuil, ni verdict, ni politique d'exposition : ceux-là vivent
 * dans `marches.ts` (`facettesDuMarche`), sans seuil de couverture et n'ont pas à être dupliqués
 * ici — ce serait recréer le défaut qu'on ferme.
 *
 * Il ne mesure pas non plus la JUSTESSE d'une valeur. Le remplissage dit qu'une information
 * existe, jamais qu'elle est vraie : le salaire est renseigné sur plusieurs marchés avec des
 * montants annuels étiquetés horaires. La qualité reste une vérification humaine.
 */

/**
 * La correspondance dimension → expression SQL, telle que la facette l'agrège.
 *
 * `metier` est déclaré sans le `COALESCE(..., 'unclassified')` de la facette, et c'est délibéré :
 * le COALESCE sert à afficher une OPTION « Métier à préciser » au candidat, pas à mesurer la
 * couverture. Compter les `unclassified` comme renseignés rendrait 100 % partout et viderait la
 * mesure de son sens. `COLONNE_AFFICHEE` porte l'expression d'affichage pour qui en a besoin.
 */
export const EXPRESSION_FACETTE = {
  metier: '"occupationCode"',
  contrat: '"employmentTerm"',
  temps: '"workTime"',
  programme: '"programType"',
  ville: 'lower(trim(city))',
  langue: 'language',
  pays: '"countryCode"',
} as const;

export type DimensionMesurable = keyof typeof EXPRESSION_FACETTE;

/**
 * L'expression exacte que la facette AFFICHE, quand elle diffère de celle qu'on mesure.
 * Aujourd'hui `metier` seulement : le candidat voit « Métier à préciser » là où la mesure voit
 * une absence de donnée.
 */
export const EXPRESSION_AFFICHEE: Partial<Record<DimensionMesurable, string>> = {
  metier: `COALESCE("occupationCode", 'unclassified')`,
};

/**
 * Les dimensions d’emploi mesurables séparément dans les RAW.
 *
 * Volontairement plus étroit que `EXPRESSION_FACETTE` : `ville`, `langue` et `pays` sont des
 * facettes de SITE, servies partout sans mesure de couverture — une ville est une ville sur tous
 * les marchés. `saisonnier` est dans `DIMENSIONS_FACETTE` (marches.ts) mais n'a AUCUNE colonne
 * dédiée : il vit dans `isSeasonal`, un booléen, et aucun marché ne porte de libellé natif pour
 * lui — donc aucune facette n'est servie. Il est absent ici pour cette raison, pas par oubli.
 */
export const DIMENSIONS_EMPLOI_MESURABLES = ['metier', 'contrat', 'temps', 'programme'] as const;

/**
 * La population que les sondes mesurent, et ce qu'elle laisse de côté.
 *
 * Les sondes mesurent la qualité du catalogue AGRÉGÉ, sur lequel se décide l'exposition d'une
 * facette par marché : `Job` seul. Jusqu'au 25/09/2026, c'était aussi toute la population servie
 * (`DirectOffer` : 0 ligne, et l'UNION forçait `NULL::text` sur leur `occupationCode`). D-444 fait
 * entrer les offres Catwalks dans la recherche avec le métier de la taxonomie appliquée à leur
 * intitulé : la facette les compte, la mesure non. L'écart est nommé ici plutôt que caché : 59
 * offres au 25/09/2026, soit moins de 0,1 % des offres publiables. Le témoin
 * `colonnes-facette.test.ts` rougit si l'UNION ou cette déclaration changent sans l'autre.
 */
export const POPULATION_MESUREE = {
  table: 'Job',
  filtre: '"isActive"',
  tableExclue: 'DirectOffer',
  raisonExclusion: 'D-444 : les offres directes Catwalks portent le métier de la taxonomie et sont comptées par la facette, pas par la mesure de couverture du catalogue agrégé (59 offres au 2026-09-25)',
} as const;

/**
 * Le SQL qui compte une dimension EXACTEMENT comme la facette la construit.
 *
 * Rend deux nombres par appel : `remplies` (ce que la facette exposerait) et `distinctes` (la
 * diversité des options). Les deux comptent sur la même expression et avec la même exclusion de
 * la chaîne vide — c'est tout l'intérêt de passer par ici plutôt que d'écrire `count(colonne)`.
 */
export function sqlCouverture(dimension: DimensionMesurable): string {
  const e = EXPRESSION_FACETTE[dimension];
  return `count(*) FILTER (WHERE ${e} IS NOT NULL AND (${e})::text <> '')::int`;
}

export function sqlDiversite(dimension: DimensionMesurable): string {
  const e = EXPRESSION_FACETTE[dimension];
  return `count(DISTINCT ${e}) FILTER (WHERE ${e} IS NOT NULL AND (${e})::text <> '')::int`;
}
