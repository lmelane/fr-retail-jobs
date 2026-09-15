import { describe, it, expect } from 'vitest';
import {
  CODES_MARCHE,
  DIMENSIONS_FACETTE,
  MARCHES,
  PLANCHER_FACETTE_DENSE,
  SEUIL_AFFICHAGE_FACETTE,
  SEUIL_FACETTE_DENSE,
  estCodeMarche,
  facettesDuMarche,
  libelleFacette,
  marche,
  type CodeMarche,
  type DimensionFacette,
} from '@catwalks/db/marches';

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
 *  · le Canada francophone n'a PAS le libellé de la France ;
 *  · la séniorité n'est PLUS une dimension de facette (retirée le 15/09/2026) :
 *    99,97 % de la donnée est déduite par regex sur l'intitulé, et elle
 *    contredit le niveau déclaré par la source dans 80 % des cas confrontables ;
 *  · AUCUN marché n'a de facette dense, une fois le métier mesuré sur la
 *    colonne réellement servie (`occupationCode`) et non sur `jobFunction`.
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
    expect(DIMENSIONS_FACETTE).toEqual([
      'contrat',
      'temps',
      'programme',
      'saisonnier',
      'metier',
    ]);
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

  it('LA FRANCE EXPOSE LES QUATRE FACETTES — contrat, temps, programme, métier', () => {
    /*
     * PRÉMISSE — le marché le mieux renseigné du registre. Il sert de contre-
     * épreuve aux témoins « ne contient pas » : si le seuil bloquait tout, ils
     * passeraient tous au vert et celui-ci rougirait.
     */
    const fr = MARCHES.FR;
    expect(fr.couverture.contrat, 'la prémisse : contrat FR largement au-dessus du seuil').toBeGreaterThan(
      SEUIL_AFFICHAGE_FACETTE,
    );

    expect(facettesDuMarche('FR')).toEqual([
      'contrat',
      'temps',
      'programme',
      'metier',
    ]);
    expect(libelleFacette('FR', 'programme')).toBe('Type de programme');
  });

  it('UN CODE MARCHÉ INCONNU NE FAIT PAS PLANTER — liste vide, pas d’exception', () => {
    /*
     * PRÉMISSE — les codes testés doivent bien être ABSENTS du registre, sinon
     * le témoin vérifierait le comportement nominal en croyant tester le cas
     * dégradé.
     *
     * BE A ÉTÉ RETIRÉ DE CETTE LISTE le 2026-09-15 : la Belgique a été mesurée
     * (671 offres, quatre facettes au-dessus du seuil) et elle est entrée au
     * registre. Ce témoin avait d'ailleurs ROUGI sur ce point précis, ce qui
     * est exactement ce qu'on lui demande — l'entrée d'un marché est une
     * décision, elle ne doit jamais pouvoir passer inaperçue.
     *
     * CN A ÉTÉ RETIRÉ À SON TOUR le 2026-09-15, pour la même raison et par le
     * même mécanisme : la Chine est entrée au registre (1 224 offres), et ce
     * témoin a de nouveau ROUGI sur ce point précis. C'est la deuxième fois
     * qu'il attrape une ouverture de marché — exactement ce qu'on lui demande.
     *
     * IL FAUT DONC UN AUTRE CODE RÉEL, ET PAS SEULEMENT DES CHAÎNES ABSURDES.
     * `JP` le remplace : présent au catalogue, jamais mesuré, jamais ouvert.
     * Sans lui, le cas dégradé ne serait plus exercé que par `ZZ` et des
     * chaînes malformées — or le cas NORMAL en production est un code pays
     * parfaitement valide qui n'est simplement pas un marché (le catalogue
     * couvre 119 pays, le registre en sert 12).
     */
    for (const inconnu of ['JP', 'ZZ', '', '   ', 'FRANCE', 'us-east']) {
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
     * PRÉMISSE — DOUZE marchés mesurés depuis l'entrée de la Chine le
     * 2026-09-15 (onze après la Belgique, douze avec CN), pas onze ni treize.
     *
     * Ce nombre est gravé À DESSEIN plutôt que dérivé de `CODES_MARCHE` : un
     * `expect(CODES_MARCHE.length).toBe(CODES_MARCHE.length)` serait toujours
     * vrai. C'est le seul endroit du témoin où l'ouverture d'un marché ne peut
     * pas passer inaperçue.
     */
    expect(CODES_MARCHE.length, 'la prémisse : douze marchés mesurés').toBe(12);

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

    /*
     * LE MÉTIER — tous les marchés, à cinq décimales. La table est balayée par
     * `CODES_MARCHE`, donc un marché ajouté sans son taux casse ici : c'est
     * voulu.
     *
     * ⚠️ CES TAUX ONT ÉTÉ RE-MESURÉS LE 15/09/2026 SUR `occupationCode`, la
     * colonne que la facette sert réellement. Les valeurs précédentes
     * (0.96836 US, 0.77705 CH, 0.88807 CN…) étaient celles de `jobFunction`,
     * qui n'est agrégée en facette nulle part — un écart de 42 points en
     * moyenne. Le témoin de chaîne ci-dessous existe pour que ce défaut-là ne
     * puisse plus revenir.
     *
     * Pas de compte gravé dans cette phrase : un nombre recopié ici se périme
     * au marché suivant, et c'est exactement le défaut que ce témoin existe
     * pour empêcher ailleurs.
     */
    const tauxMesures: Readonly<Record<CodeMarche, number>> = {
      US: 0.53949,
      FR: 0.48767,
      GB: 0.4118,
      CA: 0.36529,
      DE: 0.49513,
      IT: 0.52395,
      ES: 0.56987,
      NL: 0.38724,
      AU: 0.37358,
      CH: 0.25656,
      BE: 0.45902,
      CN: 0.33088,
    };
    for (const code of CODES_MARCHE) {
      expect(marche(code)?.couverture.metier, `${code} métier`).toBeCloseTo(tauxMesures[code], 5);
    }

    /*
     * PRÉMISSE DU DÉFAUT — les taux gravés ne doivent PAS être ceux de
     * `jobFunction`. Sans cette assertion, recopier par erreur l'ancienne table
     * repasserait au vert : les deux jeux de chiffres sont des nombres
     * parfaitement valides, et seul leur ORDRE DE GRANDEUR les distingue.
     *
     * `jobFunction` couvrait 77,7 % à 96,8 % ; `occupationCode` couvre 25,7 % à
     * 57,0 %. Aucun taux métier ne peut donc dépasser 60 % sans qu'on ait
     * re-mesuré la mauvaise colonne.
     */
    for (const code of CODES_MARCHE) {
      expect(
        marche(code)?.couverture.metier,
        `${code} : un taux métier > 60 % trahit une mesure sur jobFunction`,
      ).toBeLessThan(0.6);
    }
  });

  it('LE MÉTIER EST EXPOSÉ PARTOUT — mais de justesse en CH et en CN', () => {
    /*
     * PRÉMISSE — la dimension doit exister dans le registre, sinon la boucle
     * lirait `undefined >= 0.2` (faux) et le témoin rougirait pour la mauvaise
     * raison, ou pire, un `toContain` inversé passerait au vert.
     *
     * L'audit avait conclu que « le marché US ne garde qu'UNE facette » : c'est
     * ce témoin qui l'aurait démenti. Sur la colonne réellement servie
     * (`occupationCode`), le métier couvre 25,7 % (CH) à 57,0 % (ES) — dans
     * TOUS les cas au-dessus du seuil, donc exposé partout, sans exception,
     * mais à cinq points de la sortie pour la Suisse.
     */
    expect(DIMENSIONS_FACETTE, 'la prémisse : « metier » est bien une dimension').toContain('metier');

    for (const code of CODES_MARCHE) {
      const taux = MARCHES[code].couverture.metier;
      expect(taux, `la prémisse : ${code} métier est au-dessus du seuil`).toBeGreaterThanOrEqual(
        SEUIL_AFFICHAGE_FACETTE,
      );
      expect(facettesDuMarche(code), `${code} doit exposer le métier`).toContain('metier');
      expect(libelleFacette(code, 'metier'), `${code} porte un libellé métier natif`).toBeTruthy();
    }
  });

  it('LES US EXPOSENT DEUX FACETTES, pas une et pas trois — rythme et métier', () => {
    /*
     * PRÉMISSE — la conclusion fausse de l'audit portait sur le marché le plus
     * gros, et elle venait d'un registre qui ignorait sa dimension la mieux
     * remplie.
     *
     * ⚠️ CE TÉMOIN A DIT « TROIS FACETTES » jusqu'au 15/09/2026, et il affirmait
     * que « métier US est la plus dense » — plus dense que le rythme. Les deux
     * sont tombés avec la re-mesure : le métier servi couvre 53,9 % (contre
     * 96,8 % sur `jobFunction`), donc MOINS que le rythme (81,8 %), et la
     * séniorité a quitté le registre. Le témoin affirme donc désormais
     * l'inverse de ce qu'il affirmait, parce que la mesure l'a renversé.
     */
    const us = MARCHES.US;
    expect(us.couverture.metier, 'la prémisse : métier US passe le seuil').toBeGreaterThanOrEqual(
      SEUIL_AFFICHAGE_FACETTE,
    );
    expect(
      us.couverture.metier,
      'la prémisse : le métier servi est MOINS dense que le rythme',
    ).toBeLessThan(us.couverture.temps);

    expect(facettesDuMarche('US')).toEqual(['temps', 'metier']);
    expect(libelleFacette('US', 'metier')).toBe('Job category');
    // Et le contrat reste dehors : ajouter une dimension n'en réhabilite aucune.
    expect(facettesDuMarche('US')).not.toContain('contrat');
  });

  it('AUCUNE DIMENSION `seniorite` — la donnée est déduite, pas sourcée', () => {
    /*
     * ── LE DÉFAUT QUE CE TÉMOIN CHERCHE ───────────────────────────────────
     *
     * Que quelqu'un RÉINTRODUISE la séniorité au registre, par symétrie avec
     * les autres dimensions ou parce que « les taux la passaient sur sept
     * marchés ». Le geste paraîtrait une réparation : la colonne existe, le
     * moteur la remplit, douze libellés natifs avaient été relevés.
     *
     * Il servirait au candidat une PROMESSE que la donnée ne peut pas tenir.
     * Mesuré en production le 15/09/2026 :
     *
     *  · 22 625 offres sur 22 631 tirent leur séniorité d'un regex sur
     *    l'intitulé (`seniorityConfidence = 'TITLE_HEURISTIC'`), contre 6 d'une
     *    mention littérale — 99,97 % de déduit ;
     *  · sur les 1 861 offres où la source DÉCLARE un niveau et où le regex en
     *    produit un aussi, les deux se contredisent 1 489 fois, soit 80,0 %.
     *
     * « Lead Cashier » (462 offres) et « Master Stylist » (1 363) ressortent
     * SENIOR ; « Team Lead (Part time) », déclaré `Entry Level` à la source,
     * ressort MANAGER.
     *
     * PRÉMISSE — le registre doit savoir exprimer une PRÉSENCE, sinon « ne
     * contient pas seniorite » passerait au vert sur une liste vide ou
     * renommée. C'est le même mécanisme que le témoin `casual`.
     */
    expect(DIMENSIONS_FACETTE.length, 'la prémisse : le registre porte bien des dimensions').toBe(5);
    expect(DIMENSIONS_FACETTE, 'la prémisse : le métier, lui, EST une dimension').toContain('metier');

    expect(DIMENSIONS_FACETTE as readonly string[]).not.toContain('seniorite');

    /*
     * Et aucun marché ne conserve de libellé de séniorité : un libellé orphelin
     * serait la trace d'un retrait à moitié fait, et la porte de rentrée la
     * plus probable.
     */
    for (const code of CODES_MARCHE) {
      const libelles = Object.keys(MARCHES[code].libelles);
      expect(libelles, `${code} ne doit porter aucun libellé de séniorité`).not.toContain('seniorite');
      expect(
        Object.values(MARCHES[code].libelles).some((l) =>
          /expérience|experience|Erfahrung|esperienza|经验|Ervaring/i.test(l),
        ),
        `${code} ne doit porter aucun libellé « niveau d'expérience »`,
      ).toBe(false);
    }

    /*
     * CE QUI LA FERAIT REVENIR : une séniorité SOURCÉE (`experienceYears`
     * déclaré par les adaptateurs ATS), au-dessus du seuil, et par décision.
     * Ce témoin devra alors être réécrit — délibérément, pas supprimé en
     * passant pour faire compiler autre chose.
     */
  });

  it('CONSTAT MESURÉ : AUCUN marché n’a de facette dense — l’ancien garde-fou ne gardait rien', () => {
    /*
     * ── CE TÉMOIN A CHANGÉ DE NATURE LE 15/09/2026, ET IL FAUT LE DIRE ────
     *
     * Il affirmait un INVARIANT : « chaque marché expose au moins une facette
     * dense », gardé au plancher de 77 %. Il était VERT — et il ne gardait
     * rien, parce que la densité qui le satisfaisait était celle de
     * `jobFunction` (77,7 % à 96,8 %), une colonne qu'aucune facette ne sert.
     *
     * ── CE QUI EST VRAI, MESURÉ, ET CE QUI NE L'EST PAS ──────────────────
     *
     * Quatre marchés atteignent encore le plancher de 77 %, mais AUCUN ne le
     * doit au métier : c'est le RYTHME qui les y porte (US 81,8 %, BE 81,4 %,
     * CA 79,5 %, NL 78,2 %) — une facette à deux valeurs, qui affine à la marge
     * et ne porte pas le besoin du candidat.
     *
     * Ce témoin a d'ailleurs ROUGI sur ce point en étant écrit : j'avais gravé
     * « aucun marché n'atteint le plancher », déduit du seul métier. C'était
     * faux, et c'est le comptage réel qui l'a montré — exactement le défaut que
     * ce fichier existe pour attraper.
     *
     * CE QUI EST VRAI : sur la colonne réellement servie, le métier ne dépasse
     * 57,0 % (ES) nulle part, et tombe à 25,7 % (CH) et 33,1 % (CN). AUCUN
     * marché n'a de facette MÉTIER dense — c'est-à-dire que la seule facette
     * qui porte l'intention du candidat (« je cherche un poste de vendeur »)
     * est creuse partout.
     *
     * L'invariant d'origine est donc FAUX, et le témoin grave désormais le
     * CONSTAT au lieu de l'affirmation — parce que baisser le plancher à 33 %
     * pour le refaire passer serait modifier la règle pour la faire
     * correspondre au code, ce que le CLAUDE.md interdit explicitement.
     *
     * ⚠️ CE QUI RESTE À ARBITRER PAR LE CEO : ce que devient un catalogue dont
     * la facette métier laisse 43 à 74 % de « Métier à préciser ».
     *
     * PRÉMISSE — les constantes doivent exister et rester ordonnées, sinon ce
     * témoin comparerait à rien.
     */
    expect(SEUIL_FACETTE_DENSE, 'la prémisse : la cible vaut toujours 90 %').toBe(0.9);
    expect(PLANCHER_FACETTE_DENSE, 'la prémisse : le plancher vaut toujours 77 %').toBe(0.77);
    expect(PLANCHER_FACETTE_DENSE).toBeLessThan(SEUIL_FACETTE_DENSE);

    const meilleureParMarche = CODES_MARCHE.map(
      (code) =>
        [code, Math.max(...facettesDuMarche(code).map((d) => MARCHES[code].couverture[d]))] as const,
    );
    // La prémisse : chaque marché expose bien au moins une facette, sinon
    // `Math.max()` de rien rendrait -Infinity et le constat serait vide de sens.
    for (const [code, meilleure] of meilleureParMarche) {
      expect(meilleure, `la prémisse : ${code} expose au moins une facette`).toBeGreaterThanOrEqual(
        SEUIL_AFFICHAGE_FACETTE,
      );
    }

    /*
     * LE CONSTAT CENTRAL : aucun marché n'a de facette MÉTIER dense. C'est la
     * facette qui porte l'intention du candidat, et elle est creuse partout.
     */
    const metierDense = CODES_MARCHE.filter(
      (code) => MARCHES[code].couverture.metier >= PLANCHER_FACETTE_DENSE,
    );
    expect(
      metierDense,
      'AUCUN marché ne doit avoir de facette métier dense — si l’un y arrive, la classification s’est améliorée (bonne nouvelle à arbitrer) ou un taux a été re-mesuré sur `jobFunction`',
    ).toEqual([]);

    /*
     * ET LES QUATRE MARCHÉS QUI ATTEIGNENT ENCORE LE PLANCHER LE DOIVENT AU
     * RYTHME, PAS AU MÉTIER. La liste est gravée : elle rougit si un cinquième
     * marché y entre, ou si l'un d'eux en sort — les deux sont des faits
     * produit qui méritent d'être vus.
     */
    const auPlancher = meilleureParMarche.filter(([, m]) => m >= PLANCHER_FACETTE_DENSE).map(([c]) => c);
    expect([...auPlancher].sort(), 'US, BE, CA, NL — et par le rythme seul').toEqual([
      'BE',
      'CA',
      'NL',
      'US',
    ]);
    for (const code of auPlancher) {
      expect(
        MARCHES[code].couverture.temps,
        `${code} : c'est bien le rythme qui porte le plancher, pas le métier`,
      ).toBeGreaterThan(MARCHES[code].couverture.metier);
    }

    /*
     * ET LE CAS EXTRÊME EST NOMMÉ : la Chine, dont l'unique facette est la plus
     * creuse de tout le registre. Le graver empêche qu'un marché encore pire
     * entre sans que rien ne rougisse.
     */
    const pire = meilleureParMarche.reduce((a, b) => (b[1] < a[1] ? b : a));
    expect(pire[0], 'le marché le plus creux reste la Chine').toBe('CN');
    expect(pire[1], 'et son unique facette est le métier, à 33,1 %').toBeCloseTo(0.33088, 5);
  });

  it('LA CHINE N’EXPOSE NI CONTRAT NI RYTHME — un filtre qui ne filtre rien est pire qu’absent', () => {
    /*
     * ── LE DÉFAUT QUE CE TÉMOIN CHERCHE ───────────────────────────────────
     *
     * Que quelqu'un « répare » la Chine en lui ajoutant les libellés qui
     * manquent, par symétrie avec les onze autres marchés. Le geste paraîtrait
     * évident — le rythme chinois couvre 81,9 %, très au-dessus du seuil — et
     * il servirait au candidat un filtre dont 99,7 % des valeurs renseignées
     * sont identiques : il coche « 全职 », le catalogue ne bouge pas.
     *
     * ── POURQUOI LE SEUIL NE SUFFIT PAS ICI, ET NULLE PART AILLEURS ───────
     *
     * Mesuré le 2026-09-15 : sur les 498 offres chinoises portant les DEUX
     * dimensions, 99,6 % tombent dans une seule case (PERMANENT × FULL_TIME) ;
     * la contre-épreuve française rend 54,4 % sur 5 032 offres. En Chine, les
     * deux colonnes ne portent qu'UNE information — ce que le relevé des sites
     * d'emploi chinois disait déjà par un autre chemin : ils servent une
     * facette unique, `工作性质`, et aucune facette « type de contrat ».
     *
     * PRÉMISSE — les taux doivent bien être AU-DESSUS du seuil d'affichage,
     * sinon ce témoin ne prouverait rien : ce serait le seuil qui écarterait
     * les facettes, et le mécanisme du libellé ne serait pas exercé du tout.
     */
    expect(MARCHES.CN.couverture.temps, 'la prémisse : le rythme passe le seuil').toBeGreaterThan(
      SEUIL_AFFICHAGE_FACETTE,
    );
    expect(MARCHES.CN.couverture.contrat, 'la prémisse : le contrat aussi').toBeGreaterThan(
      SEUIL_AFFICHAGE_FACETTE,
    );

    /* Et pourtant elles ne sont pas servies — parce qu'aucun libellé natif. */
    expect(facettesDuMarche('CN'), 'la Chine n’expose PAS le rythme').not.toContain('temps');
    expect(facettesDuMarche('CN'), 'la Chine n’expose PAS le contrat').not.toContain('contrat');
    expect(libelleFacette('CN', 'temps'), 'aucun libellé de rythme relevé').toBeUndefined();
    expect(libelleFacette('CN', 'contrat'), 'aucun libellé de contrat relevé').toBeUndefined();

    /*
     * CONTRE-ÉPREUVE — le mécanisme n'a pas fermé le marché par accident. La
     * Chine expose bien sa facette utile, avec son libellé natif relevé sur la
     * barre de filtres de zhaopin.com.
     *
     * Elle en exposait DEUX jusqu'au 15/09/2026 ; la séniorité (`经验`) est
     * partie avec la dimension, pour une raison qui n'a rien de chinois — la
     * donnée est déduite à 99,97 %. La Chine est donc désormais le seul marché
     * du registre à n'avoir qu'UNE facette.
     */
    expect(facettesDuMarche('CN'), 'mais elle expose le métier').toEqual(['metier']);
    expect(libelleFacette('CN', 'metier')).toBe('职位类别');

    /*
     * CONTRE-ÉPREUVE DU MÉCANISME LUI-MÊME : ailleurs, un taux au-dessus du
     * seuil AVEC un libellé produit bien une facette. Sans cette ligne, un
     * `facettesDuMarche` cassé qui ne rendrait jamais `temps` ferait passer ce
     * témoin au vert pour la mauvaise raison.
     */
    expect(facettesDuMarche('FR'), 'la France, elle, expose bien le rythme').toContain('temps');
  });

  it('LA BELGIQUE EXPOSE SES QUATRE FACETTES — à égalité avec la France, et elle seule', () => {
    /*
     * CE QUE CE TÉMOIN EMPÊCHE : que la Belgique ressorte du registre aussi
     * discrètement qu'elle y est restée absente. Elle a été écartée des mois
     * sur « aucun taux disponible » — un motif devenu faux sans que rien ne le
     * signale, pendant que 671 offres restaient inaccessibles par marché.
     *
     * PRÉMISSE — les QUATRE dimensions exposables doivent être AU-DESSUS du
     * seuil, une par une. Sans ces quatre assertions, un registre où la
     * Belgique aurait des taux effondrés rendrait « moins de quatre facettes »
     * et le `toEqual` final rougirait pour une raison qu'on attribuerait au
     * code de filtrage au lieu des données.
     *
     * Elle en exposait CINQ avant le 15/09/2026 : la séniorité est partie avec
     * la dimension, et le métier belge est passé de 90,5 % (`jobFunction`) à
     * 45,9 % (`occupationCode`) — toujours au-dessus du seuil.
     */
    const be = MARCHES.BE;
    expect(be.offresMesurees, 'la prémisse : la Belgique est bien mesurée').toBe(671);
    for (const dimension of ['contrat', 'temps', 'programme', 'metier'] as const) {
      expect(
        be.couverture[dimension],
        `la prémisse : BE/${dimension} passe le seuil`,
      ).toBeGreaterThanOrEqual(SEUIL_AFFICHAGE_FACETTE);
    }

    expect(facettesDuMarche('BE')).toEqual(['contrat', 'temps', 'programme', 'metier']);

    /*
     * CONTRE-ÉPREUVE, et elle corrige une erreur que j'ai commise en écrivant
     * ce lot : j'avais gravé « le SEUL marché à cinq facettes ». Le comptage
     * réel dit que la France en expose autant. Le témoin affirme donc le fait
     * VÉRIFIÉ — BE et FR sont les deux seuls au maximum — au lieu de la formule
     * flatteuse qui ne résistait pas au comptage.
     */
    const maxFacettes = CODES_MARCHE.filter((code) => facettesDuMarche(code).length === 4);
    expect([...maxFacettes].sort(), 'BE et FR, et eux seuls, exposent quatre facettes').toEqual(['BE', 'FR']);

    /*
     * Le saisonnier reste dehors À 2,7 %, sur le marché le mieux couvert : la
     * règle ne se relâche pas parce que le reste du marché est bon.
     */
    expect(be.couverture.saisonnier, 'la prémisse : le saisonnier belge est très bas').toBeLessThan(
      SEUIL_AFFICHAGE_FACETTE,
    );
    expect(facettesDuMarche('BE')).not.toContain('saisonnier');
  });

  it('LES LIBELLÉS BELGES SONT BILINGUES — le néerlandais devance le français', () => {
    /*
     * LE DÉFAUT QUE CE TÉMOIN CHERCHE : servir la Belgique avec les seuls
     * libellés français, « puisque c'est un pays francophone ». Mesuré le
     * 2026-09-15 : 163 offres néerlandophones contre 144 francophones. La
     * supposition est non seulement fausse, elle est INVERSÉE.
     *
     * C'est le même piège que CA-fr, sur l'autre axe : là-bas on déduisait le
     * libellé de la langue, ici on déduirait la langue du pays.
     *
     * PRÉMISSE — la Belgique doit porter des libellés pour être testée, et ils
     * doivent DIFFÉRER de ceux de la France : deux libellés identiques
     * prouveraient que la déduction a eu lieu.
     */
    for (const dimension of ['contrat', 'temps', 'programme', 'metier'] as const) {
      const belge = libelleFacette('BE', dimension);
      expect(belge, `la prémisse : BE porte un libellé pour ${dimension}`).toBeTruthy();
      expect(belge, `BE/${dimension} ne doit pas recopier la France`).not.toBe(
        libelleFacette('FR', dimension),
      );
      // Les DEUX langues sont présentes : « fr · nl », jamais une seule.
      expect(belge, `BE/${dimension} doit porter les deux langues`).toContain(' · ');
    }

    expect(libelleFacette('BE', 'contrat')).toBe('Type de contrat · Contracttype');
    // Le néerlandais belge rejoint le vocabulaire néerlandais des Pays-Bas sur
    // le rythme — « Dienstverband » — sans pour autant fusionner les marchés.
    expect(libelleFacette('BE', 'temps')).toContain('Dienstverband');
  });

  it('AUCUNE DIMENSION `casual` — le vocabulaire australien reste du saisonnier', () => {
    /*
     * PRÉMISSE — ce témoin garde une ABSENCE, donc il doit prouver que le
     * registre sait exprimer une présence : si `DIMENSIONS_FACETTE` était vide
     * ou renommée, « ne contient pas casual » passerait au vert sans rien dire.
     *
     * Mesuré le 2026-09-15 : 220 offres australiennes citent « casual », dont
     * 121 (55 %) déjà `isSeasonal`. Le résiduel non couvert est de 99 offres,
     * soit 8 % du marché australien — très loin du seuil de 20 %, et porté par
     * aucun champ structuré. Voir le bloc nommé dans `marches.ts`.
     *
     * Si ce résiduel montait un jour, la réponse serait d'améliorer la
     * détection du saisonnier, pas d'ajouter une dimension. Ce témoin rougit si
     * quelqu'un prend l'autre chemin.
     */
    expect(DIMENSIONS_FACETTE.length, 'la prémisse : le registre porte bien des dimensions').toBe(5);
    expect(DIMENSIONS_FACETTE, 'la prémisse : le saisonnier EXISTE comme dimension').toContain('saisonnier');

    expect(DIMENSIONS_FACETTE as readonly string[]).not.toContain('casual');
    for (const code of CODES_MARCHE) {
      expect(
        Object.values(MARCHES[code].libelles).some((l) => /casual/i.test(l)),
        `${code} ne doit porter aucun libellé « casual »`,
      ).toBe(false);
    }

    // 99 offres sur 1 234, soit 8,0 % : sous le seuil, donc rien à exposer.
    expect(99 / MARCHES.AU.offresMesurees).toBeLessThan(SEUIL_AFFICHAGE_FACETTE);
  });
});
