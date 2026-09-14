import { describe, it, expect } from 'vitest';
import {
  CODES_MARCHE,
  DIMENSIONS_FACETTE,
  MARCHES,
  SEUIL_AFFICHAGE_FACETTE,
  estCodeMarche,
  facettesDuMarche,
  libelleFacette,
  marche,
  type CodeMarche,
  type DimensionFacette,
} from '../marches.js';

/**
 * D-436 — LE REGISTRE DU VOCABULAIRE NATIF PAR MARCHÉ.
 *
 * ── CE QUE CES TÉMOINS GRAVENT ────────────────────────────────────────────
 *
 * Des CONSÉQUENCES PRODUIT, pas la structure d'un objet. Chacune est
 * contre-intuitive et serait « corrigée » de bonne foi par quelqu'un qui n'a
 * pas la mesure sous les yeux :
 *
 *  · les États-Unis, notre plus gros marché, n'exposent PAS de facette contrat ;
 *  · la Suisse non plus — mais elle expose « programme », que personne d'autre
 *    n'expose ;
 *  · l'Australie n'expose PAS le saisonnier, alors que c'est son vocabulaire ;
 *  · le Canada francophone n'a PAS le libellé de la France.
 *
 * ── LA MÉTHODE : UNE ASSERTION DE PRÉMISSE PAR TEST ───────────────────────
 *
 * Chaque témoin affirme d'abord que sa SITUATION DE DÉPART remplit la condition
 * du défaut qu'il cherche, avant d'affirmer le résultat. Sans cela, un témoin
 * passe au vert sur un registre vide, un seuil inopérant ou une dimension
 * renommée — il graverait le défaut au lieu de le détecter.
 *
 * Ces témoins ne prouvent RIEN sur le rendu : ce lot livre le registre seul,
 * sans appelant. Aucun gain de conversion n'est revendiqué ici.
 */
describe('D-436 — registre du vocabulaire natif par marché', () => {
  it('PRÉMISSE : le seuil est bien la seule source du nombre, et il vaut 20 %', () => {
    /*
     * Si le seuil n'était pas une constante lue par la fonction, tous les
     * témoins de conséquence ci-dessous testeraient une valeur figée ailleurs
     * et le « prouve qu'il peut échouer » ne prouverait rien.
     */
    expect(SEUIL_AFFICHAGE_FACETTE).toBe(0.2);
    expect(DIMENSIONS_FACETTE).toEqual(['contrat', 'temps', 'programme', 'saisonnier']);
  });

  it('LES US N’EXPOSENT PAS LA FACETTE CONTRAT — 19,2 %, at-will', () => {
    /*
     * PRÉMISSE — le marché doit exister et sa couverture contrat doit être
     * SOUS le seuil. Sans cette assertion, un registre où les US auraient
     * disparu rendrait aussi une liste sans « contrat », au vert, pour la
     * mauvaise raison.
     */
    const us = MARCHES.US;
    expect(us.offresMesurees, 'la prémisse : le marché US est bien mesuré').toBe(36_942);
    expect(
      us.couverture.contrat,
      'la prémisse : la couverture contrat US est bien SOUS le seuil',
    ).toBeLessThan(SEUIL_AFFICHAGE_FACETTE);

    const facettes = facettesDuMarche('US');
    expect(facettes).not.toContain('contrat');
    // Le rythme, lui, est massivement renseigné (81,8 %) : il reste exposé.
    expect(facettes).toContain('temps');
    expect(libelleFacette('US', 'temps')).toBe('Job type');
  });

  it('LA SUISSE EXPOSE « PROGRAMME » ET PAS « CONTRAT » — l’apprentissage suisse', () => {
    /*
     * PRÉMISSE — le seul marché dont le programme dépasse le seuil pendant que
     * son contrat le rate. Les deux comparaisons sont affirmées, sinon un
     * registre où la CH n'aurait aucune facette passerait au vert.
     */
    const ch = MARCHES.CH;
    expect(ch.couverture.programme, 'la prémisse : programme CH AU-DESSUS du seuil').toBeGreaterThanOrEqual(
      SEUIL_AFFICHAGE_FACETTE,
    );
    expect(ch.couverture.contrat, 'la prémisse : contrat CH SOUS le seuil').toBeLessThan(
      SEUIL_AFFICHAGE_FACETTE,
    );

    const facettes = facettesDuMarche('CH');
    expect(facettes).toContain('programme');
    expect(facettes).not.toContain('contrat');
  });

  it('LA SUISSE GARDE DEUX LIBELLÉS DISTINCTS même si un seul s’affiche', () => {
    /*
     * PRÉMISSE — Indeed expose en Suisse « Type de contrat » ET « Temps de
     * travail » comme deux filtres. Le libellé décrit le MARCHÉ, le seuil décide
     * de l'AFFICHAGE : les deux sont séparés exprès, pour n'avoir rien à
     * traduire le jour où la couverture monte.
     */
    expect(libelleFacette('CH', 'contrat')).toBe('Type de contrat');
    expect(libelleFacette('CH', 'temps')).toBe('Temps de travail');
    expect(libelleFacette('CH', 'contrat')).not.toBe(libelleFacette('CH', 'temps'));
    // Et pourtant le contrat ne s'affiche pas : porter un libellé ne suffit pas.
    expect(facettesDuMarche('CH')).not.toContain('contrat');
  });

  it('L’AUSTRALIE N’EXPOSE PAS LE SAISONNIER — 17 %, sous le seuil malgré son vocabulaire', () => {
    /*
     * PRÉMISSE — le cas limite. « seasonal » 19 % et « casual » 18 % des
     * descriptions australiennes : l'intuition métier dit d'exposer, la mesure
     * dit non. Le témoin affirme que le taux est bien dans la zone limite
     * (entre 15 % et le seuil), sinon il ne teste plus le cas difficile.
     */
    const au = MARCHES.AU;
    expect(au.couverture.saisonnier, 'la prémisse : AU est dans la zone limite haute').toBeGreaterThan(0.15);
    expect(au.couverture.saisonnier, 'la prémisse : mais bien SOUS le seuil').toBeLessThan(
      SEUIL_AFFICHAGE_FACETTE,
    );

    expect(facettesDuMarche('AU')).not.toContain('saisonnier');
  });

  it('AUCUN MARCHÉ N’EXPOSE LE SAISONNIER — et la DEUXIÈME condition le garantit', () => {
    /*
     * Ce témoin garde une chose PRÉCISE, et il faut la nommer pour ne pas se
     * mentir : il ne tient pas au seuil, il tient à la SECONDE condition de
     * `facettesDuMarche` — aucun marché ne porte de libellé natif « saisonnier ».
     * Baisser le seuil ne le fait donc PAS rougir, et c'est exactement ce qu'on
     * veut vérifier : les deux conditions sont cumulatives, pas redondantes.
     *
     * PRÉMISSE — le maximum mesuré est celui de l'Australie (17 %), et AUCUN
     * marché ne porte de libellé pour cette dimension. Si l'un des deux
     * changeait, ce témoin doit rougir : exposer une facette est une décision,
     * pas un ajout silencieux au registre.
     */
    const maximum = Math.max(...CODES_MARCHE.map((code) => MARCHES[code].couverture.saisonnier));
    expect(maximum, 'la prémisse : le maximum mesuré est celui de l’Australie').toBe(
      MARCHES.AU.couverture.saisonnier,
    );
    for (const code of CODES_MARCHE) {
      expect(
        libelleFacette(code, 'saisonnier'),
        `la prémisse : ${code} ne porte aucun libellé « saisonnier »`,
      ).toBeUndefined();
      expect(facettesDuMarche(code), `${code} ne doit pas exposer le saisonnier`).not.toContain('saisonnier');
    }
  });

  it('CA-fr N’A PAS LE LIBELLÉ DE LA FRANCE — le libellé ne se déduit pas de la langue', () => {
    /*
     * PRÉMISSE — les deux marchés doivent bien partager la langue de service,
     * sinon la démonstration s'effondre : deux libellés différents dans deux
     * langues différentes ne prouveraient rien.
     */
    expect(MARCHES.CA.locale.startsWith('fr'), 'la prémisse : le Canada est servi en français').toBe(true);
    expect(MARCHES.FR.locale.startsWith('fr'), 'la prémisse : la France aussi').toBe(true);

    expect(libelleFacette('CA', 'contrat')).toBe('Type de poste');
    expect(libelleFacette('FR', 'contrat')).toBe('Type de contrat');
    expect(libelleFacette('CA', 'contrat')).not.toBe(libelleFacette('FR', 'contrat'));
  });

  it('LA FRANCE EXPOSE TROIS FACETTES — contrat, temps, programme', () => {
    /*
     * PRÉMISSE — le marché le mieux renseigné du registre. Il sert de contre-
     * épreuve aux témoins « ne contient pas » : si le seuil bloquait tout, ils
     * passeraient tous au vert et celui-ci rougirait.
     */
    const fr = MARCHES.FR;
    expect(fr.couverture.contrat, 'la prémisse : contrat FR largement au-dessus du seuil').toBeGreaterThan(
      SEUIL_AFFICHAGE_FACETTE,
    );

    expect(facettesDuMarche('FR')).toEqual(['contrat', 'temps', 'programme']);
    expect(libelleFacette('FR', 'programme')).toBe('Type de programme');
  });

  it('UN CODE MARCHÉ INCONNU NE FAIT PAS PLANTER — liste vide, pas d’exception', () => {
    /*
     * PRÉMISSE — les codes testés doivent bien être ABSENTS du registre, sinon
     * le témoin vérifierait le comportement nominal en croyant tester le cas
     * dégradé. BE et CN sont écartés volontairement : non mesurés.
     */
    for (const inconnu of ['BE', 'CN', 'ZZ', '', '   ', 'FRANCE', 'us-east']) {
      expect(estCodeMarche(inconnu.toUpperCase()), `« ${inconnu} » doit être hors registre`).toBe(false);
      expect(() => facettesDuMarche(inconnu)).not.toThrow();
      expect(facettesDuMarche(inconnu)).toEqual([]);
      expect(marche(inconnu)).toBeUndefined();
      expect(libelleFacette(inconnu, 'contrat')).toBeUndefined();
    }
  });

  it('UN CODE CONNU EST TOLÉRANT À LA CASSE ET AUX ESPACES, sans être permissif', () => {
    // PRÉMISSE : la forme canonique doit déjà fonctionner, sinon rien ne prouve rien.
    expect(facettesDuMarche('FR').length).toBeGreaterThan(0);
    expect(facettesDuMarche(' fr ')).toEqual(facettesDuMarche('FR'));
    // Mais on ne devine pas un marché à partir d'autre chose qu'un code pays.
    expect(facettesDuMarche('fr-FR')).toEqual([]);
  });

  it('INVARIANT : toute facette exposée porte un libellé natif non vide', () => {
    /*
     * PRÉMISSE — il doit exister au moins une facette exposée dans tout le
     * registre, sinon cette boucle ne s'exécute jamais et le témoin est vert
     * sans avoir rien vérifié.
     */
    const exposees = CODES_MARCHE.flatMap((code) =>
      facettesDuMarche(code).map((d) => [code, d] as [CodeMarche, DimensionFacette]),
    );
    expect(exposees.length, 'la prémisse : le registre expose bien des facettes').toBeGreaterThan(0);

    for (const [code, dimension] of exposees) {
      const libelle = libelleFacette(code, dimension);
      expect(libelle, `${code}/${dimension} doit porter un libellé natif`).toBeTruthy();
      expect(libelle?.trim()).toBe(libelle);
    }
  });

  it('INVARIANT : le registre est cohérent — un enregistrement complet par code', () => {
    /*
     * PRÉMISSE — dix marchés mesurés, pas neuf ni onze. BE et CN n'entrent pas
     * tant qu'aucune mesure ne les couvre.
     */
    expect(CODES_MARCHE.length, 'la prémisse : dix marchés mesurés').toBe(10);

    for (const code of CODES_MARCHE) {
      const m = MARCHES[code];
      expect(m.code, `${code} : le code interne doit correspondre à la clé`).toBe(code);
      expect(m.offresMesurees, `${code} : un volume mesuré strictement positif`).toBeGreaterThan(0);
      expect(m.locale, `${code} : une locale de service`).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      for (const dimension of DIMENSIONS_FACETTE) {
        const taux = m.couverture[dimension];
        expect(taux, `${code}/${dimension} : une proportion, pas un pourcentage`).toBeGreaterThanOrEqual(0);
        expect(taux, `${code}/${dimension} : une proportion, pas un pourcentage`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('AUCUN appel ne lève d’exception, quel que soit le TYPE reçu', () => {
    /*
     * TROU DE COUVERTURE TROUVÉ PAR L'AUDIT DÉFENSIF du 15/09/2026.
     *
     * Le contrat documenté promet « une liste vide, jamais une exception »,
     * parce que ce registre est lu sur un CHEMIN DE RENDU. Le témoin
     * précédent ne couvrait que des CHAÎNES malformées ('', 'ZZ', 'FRANCE') :
     * la branche qui plantait n'était testée nulle part.
     *
     * Mesuré : `undefined`, `null`, un nombre, un objet et un tableau
     * levaient tous sur `code.trim()`. Un paramètre d'URL absent arrive
     * `undefined` — la page entière tombait.
     *
     * PRÉMISSE — un code VALIDE rend bien des facettes, sinon ce témoin
     * passerait au vert sur une fonction qui ne rend jamais rien.
     */
    expect(facettesDuMarche('FR').length, 'la prémisse : FR expose des facettes').toBeGreaterThan(0);

    for (const entree of [undefined, null, 123, {}, ['FR'], true, Symbol('FR')]) {
      expect(() => facettesDuMarche(entree as never), `facettesDuMarche(${String(entree)})`).not.toThrow();
      expect(() => marche(entree as never), `marche(${String(entree)})`).not.toThrow();
      expect(facettesDuMarche(entree as never)).toEqual([]);
      expect(marche(entree as never)).toBeUndefined();
    }
  });

  it('les taux gravés correspondent à la mesure du 15/09/2026', () => {
    /*
     * L'audit a trouvé le taux SAISONNIER allemand à 0,2 % alors que la
     * production en portait 4,77 % — un facteur 24. Cause : 140 offres
     * Pandora « Seasonal Sales Associate » publiées début septembre, après
     * la mesure initiale.
     *
     * Ce témoin ne peut pas interroger la base (module de données pur), mais
     * il grave les valeurs vérifiées afin qu'une correction silencieuse soit
     * impossible : modifier un taux sans mettre à jour ce témoin le fait
     * rougir, et oblige à re-mesurer.
     */
    expect(marche('DE')?.couverture.saisonnier, 'DE saisonnier, re-mesuré').toBeCloseTo(0.048, 3);
    expect(marche('AU')?.couverture.saisonnier, 'AU saisonnier').toBeCloseTo(0.17, 3);
    expect(marche('CA')?.couverture.saisonnier, 'CA saisonnier').toBeCloseTo(0.114, 3);
    expect(marche('US')?.couverture.contrat, 'US contrat — la décision structurante').toBeCloseTo(0.192, 3);
  });
});
