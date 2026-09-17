import { describe, it, expect } from 'vitest';
import {
  CODES_MARCHE,
  DIMENSIONS_FACETTE,
  MARCHES,
  SEUIL_AFFICHAGE_FACETTE,
  facettesDuMarche,
  libelleFacette,
} from '@catwalks/db/marches';

/**
 * LA PARITÉ DES DEUX REGISTRES DE MARCHÉS — le témoin qui empêche la RÉCIDIVE.
 *
 * ── LE FICHIER JUMEAU ─────────────────────────────────────────────────────
 *
 *   ICI (amont, ce dépôt) : packages/db/marches.ts        → CODES_MARCHE
 *   LÀ-BAS (site candidat) : catwalks-website
 *                            src/lib/emplois/marche.ts    → type CodeMarche
 *
 * Dépôt du site : `catwalks-website`, fichier `src/lib/emplois/marche.ts`.
 * Le témoin symétrique y vit dans
 * `src/lib/emplois/__tests__/marches-parite-amont.test.ts`.
 *
 * ── POURQUOI UNE LISTE RECOPIÉE ET PAS UN IMPORT ──────────────────────────
 *
 * Parce qu'aucun import n'est possible : ce sont DEUX DÉPÔTS SÉPARÉS, et le
 * site ne déclare pas `@catwalks/db` en dépendance (vérifié dans son
 * `package.json` le 2026-09-15, et c'est un choix d'architecture, pas un
 * oubli). Partager le code exigerait de publier un paquet ou de fusionner les
 * dépôts — deux décisions qui appartiennent au CEO, pas à un témoin.
 *
 * Ce qui est possible, et suffit : GRAVER LA LISTE ATTENDUE DES DEUX CÔTÉS.
 * Le témoin ne peut pas empêcher la divergence ; il la rend IMPOSSIBLE À
 * COMMETTRE EN SILENCE. Quiconque ajoute ou retire un marché ici voit ce
 * fichier rougir, avec le chemin exact du jumeau à mettre à jour.
 *
 * ── LE DÉFAUT RÉEL QUE CE TÉMOIN AURAIT ATTRAPÉ ───────────────────────────
 *
 * Mesuré le 2026-09-15, avant correction : l'amont portait
 * US FR GB CA DE IT ES NL AU CH, le site portait FR DE GB US IT ES BE CH.
 * Conséquence en production :
 *
 *   · CA 3 129 offres · NL 1 849 · AU 1 234 — mesurées en amont, FERMÉES
 *     côté site : le candidat ne pouvait pas choisir ces marchés ;
 *   · BE 671 offres — ouvertes côté site, INCONNUES en amont : aucune facette
 *     native, alors que c'est le marché le mieux couvert du catalogue.
 *
 * Soit 6 212 offres inaccessibles par marché. Aucun typecheck, aucun build et
 * aucun test ne le voyait : les deux fichiers étaient valides séparément. Le
 * défaut ne vivait PAS dans l'un des deux registres, il vivait dans leur
 * ÉCART — exactement le mode de panne qu'aucune vérification statique d'un
 * seul dépôt ne peut attraper.
 */
describe('parité des registres de marchés — amont ↔ site', () => {
  /*
   * LA LISTE DE RÉFÉRENCE, triée pour que l'ORDRE de déclaration ne compte pas.
   *
   * L'ordre diffère légitimement entre les deux dépôts : l'amont classe par
   * volume mesuré décroissant, le site par ordre d'ouverture. Comparer des
   * listes triées garde ce qui compte — QUELS marchés — sans imposer une
   * convention d'écriture à l'autre dépôt.
   */
  const ATTENDUS = ['AU', 'BE', 'CA', 'CH', 'CN', 'DE', 'ES', 'FR', 'GB', 'IT', 'NL', 'US'] as const;

  it('PRÉMISSE : la liste de référence n’est pas vide et ne contient pas de doublon', () => {
    /*
     * Sans cette assertion, une liste vide ferait passer au vert la
     * comparaison contre un registre lui aussi vidé — le témoin graverait la
     * panne au lieu de la détecter.
     */
    expect(ATTENDUS.length).toBe(12);
    expect(new Set(ATTENDUS).size, 'aucun doublon dans la référence').toBe(ATTENDUS.length);
  });

  it('LE REGISTRE AMONT PORTE EXACTEMENT LES MARCHÉS ATTENDUS', () => {
    /*
     * Si ce témoin rougit, il y a DEUX gestes à faire, pas un :
     *
     *  1. mettre à jour `ATTENDUS` ici ;
     *  2. mettre à jour le registre du site ET son témoin jumeau —
     *     catwalks-website/src/lib/emplois/marche.ts
     *     catwalks-website/src/lib/emplois/__tests__/marches-parite-amont.test.ts
     *
     * Ne faire que le premier rétablit le vert en recréant exactement le
     * défaut de 6 212 offres que ce fichier existe pour empêcher.
     */
    expect([...CODES_MARCHE].sort()).toEqual([...ATTENDUS].sort());
  });

  it('LES MARCHÉS DE LA DIVERGENCE SONT BIEN PRÉSENTS — CA, NL, AU, BE et CN', () => {
    /*
     * Un témoin d'égalité de listes rougit pour n'importe quel écart, ce qui
     * est sa force et sa faiblesse : il ne DIT pas ce qui manque. Celui-ci
     * nomme les marchés qui ont réellement divergé, avec leur volume, pour
     * qu'une régression parle d'elle-même dans le rapport d'échec.
     *
     * CN rejoint la liste le 2026-09-15 : ouvert des deux côtés le même jour,
     * il est le marché le plus récent et donc le plus exposé à n'être ajouté
     * qu'à moitié — précisément le défaut que ce fichier existe pour empêcher.
     */
    const presents = new Set<string>(CODES_MARCHE);
    for (const [code, offres] of [
      ['CA', 3_129],
      ['NL', 1_849],
      ['AU', 1_234],
      ['CN', 1_224],
      ['BE', 671],
    ] as const) {
      expect(presents.has(code), `${code} (${offres} offres) doit être au registre amont`).toBe(true);
    }
  });

  /*
   * ── LE SECOND BORD DE LA PARITÉ : LES FACETTES, PAS SEULEMENT LES CODES ──
   *
   * Ce fichier gardait les CODES de marché des deux côtés. Il ne gardait pas
   * ce que chaque marché EXPOSE — et c'est par là que la divergence est
   * revenue le 2026-09-15, sous une forme nouvelle :
   *
   *   le site affichait `programme` sur DE (8,0 %), IT (16,2 %) et ES (5,3 %),
   *   et `contrat` sur CH (17,2 %) — quatre facettes SOUS le seuil, qu'aucune
   *   mesure amont n'autorise. Un candidat espagnol cochait « Stage », voyait
   *   le catalogue fondre de 95 %, et concluait que le site était vide.
   *
   * Le site porte maintenant son propre témoin, qui rejoue le calcul amont.
   * Mais la parité n'était gardée que d'UN SEUL CÔTÉ : un changement de
   * couverture ici ne faisait rougir rien ici. Or c'est ici que la mesure
   * change — le site ne fait que la refléter.
   *
   * Ce témoin ferme ce bord. Il ne recopie AUCUNE liste attendue : il affirme
   * l'INVARIANT qui fonde la décision produit, à savoir qu'une facette exposée
   * a toujours ses deux conditions réunies (couverture au-dessus du seuil ET
   * libellé natif). Une liste recopiée dériverait ; un invariant, non.
   */
  it('TOUTE FACETTE EXPOSÉE TIENT SES DEUX CONDITIONS — le bord amont de la parité', () => {
    /*
     * PRÉMISSE — le calcul doit réellement ÉCARTER quelque chose, sinon cette
     * boucle passerait au vert sur un registre qui exposerait tout, et le
     * témoin graverait le défaut au lieu de le détecter.
     */
    const ecartees = CODES_MARCHE.flatMap((code) =>
      DIMENSIONS_FACETTE.filter((d) => !facettesDuMarche(code).includes(d)).map((d) => `${code}.${d}`),
    );
    expect(
      ecartees.length,
      'la prémisse : le seuil et le libellé écartent bien des dimensions',
    ).toBeGreaterThan(0);

    for (const code of CODES_MARCHE) {
      for (const dimension of facettesDuMarche(code)) {
        expect(
          MARCHES[code].couverture[dimension],
          `${code}.${dimension} est exposée : sa couverture doit tenir le seuil`,
        ).toBeGreaterThanOrEqual(SEUIL_AFFICHAGE_FACETTE);
        expect(
          libelleFacette(code, dimension),
          `${code}.${dimension} est exposée : elle doit porter un libellé natif`,
        ).toBeDefined();
      }
    }
  });

  it('AUCUN LIBELLÉ MORT — un libellé sans facette exposée est de la donnée qui ment', () => {
    /*
     * Le symétrique du témoin ci-dessus, et il garde une chose différente :
     * un libellé peut survivre à la facette qu'il nommait. C'est arrivé le
     * 2026-09-15 côté site (`Programmart`, `Tipo di programma`, `Tipo de
     * programa` sont restés après le retrait de la facette).
     *
     * ⚠ EXCEPTION VOULUE, et c'est pourquoi ce témoin ne boucle pas aveuglément :
     * la Suisse GARDE « Type de contrat » alors que la facette n'est pas
     * exposée (17,2 %). C'est délibéré — le libellé décrit le MARCHÉ, le seuil
     * décide de l'AFFICHAGE, et les séparer évite d'avoir à retraduire le jour
     * où la couverture monte. Le témoin grave donc l'écart CONNU, et rougit
     * si un écart INCONNU apparaît.
     */
    const dormants = CODES_MARCHE.flatMap((code) =>
      DIMENSIONS_FACETTE.filter(
        (d) => libelleFacette(code, d) !== undefined && !facettesDuMarche(code).includes(d),
      ).map((d) => `${code}.${d}`),
    ).sort();

    expect(dormants, 'les seuls libellés dormants sont ceux que le registre assume').toEqual([
      'CH.contrat',
    ]);
  });
});
