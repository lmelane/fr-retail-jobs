import { describe, it, expect } from 'vitest';
import { CODES_MARCHE } from '@catwalks/db/marches';

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
});
