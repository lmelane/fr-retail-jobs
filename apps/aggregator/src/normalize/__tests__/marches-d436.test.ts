import { describe, it, expect } from 'vitest';
import {
  CODES_MARCHE,
  CODES_MARCHE_LOCALISES,
  DIMENSIONS_FACETTE,
  MARCHES,
  MARCHES_ROUTABLES,
  PLANCHER_FACETTE_DENSE,
  SEUIL_AFFICHAGE_FACETTE,
  SEUIL_FACETTE_DENSE,
  estCodeMarche,
  facettesDuMarche,
  libelleFacetteServi,
  libelleFacette,
  localeServie,
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
    expect(MARCHES.CA.locales.some((l) => l.startsWith('fr')), 'la prémisse : le Canada est aussi servi en français').toBe(true);
    expect(MARCHES.FR.localeParDefaut.startsWith('fr'), 'la prémisse : la France aussi').toBe(true);

    expect(libelleFacette('CA', 'contrat')).toBe('Type de poste');
    expect(libelleFacette('FR', 'contrat')).toBe('Type de contrat');
    expect(libelleFacette('CA', 'contrat')).not.toBe(libelleFacette('FR', 'contrat'));
  });

  it('la France expose le contrat unifié et le temps de travail', () => {
    expect(MARCHES.FR.contratUnifie).toBe(true);
    expect(facettesDuMarche('FR')).toEqual(['contrat', 'temps']);
    expect(libelleFacette('FR', 'contrat')).toBe('Type de contrat');
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
     * Sans lui, le cas dégradé ne serait plus exercé que par `ZZ` et des
     * chaînes malformées — or le cas NORMAL en production est un code pays
     * parfaitement valide qui n'est simplement pas un marché.
     *
     * `JP` A ÉTÉ RETIRÉ À SON TOUR le 2026-09-17, et ce témoin a ROUGI pour la TROISIÈME fois sur
     * une ouverture de marché — après BE, après CN. Le Japon est entré comme marché ROUTABLE
     * (552 offres, quatre facettes exploitables, 52 % de preuves pays), avec les 30 autres.
     *
     * `BG` le remplace, et c'est le bon successeur : la Bulgarie porte 45 offres publiables —
     * réelles, servies par le catalogue, mais SOUS le seuil de 50 qui ouvre un marché routable.
     * Elle exerce donc exactement le cas de production visé : un code pays valide, présent au
     * catalogue, qui n'est pas un marché. Le jour où son volume passe le seuil, ce témoin rougira
     * une quatrième fois — et ce sera encore la bonne réponse.
     */
    for (const inconnu of ['BG', 'ZZ', '', '   ', 'FRANCE', 'us-east']) {
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

  it('INVARIANT : toute facette exposée porte un libellé dans la langue SERVIE', () => {
    /*
     * PRÉMISSE — il doit exister au moins une facette exposée dans tout le
     * registre, sinon cette boucle ne s'exécute jamais et le témoin est vert
     * sans avoir rien vérifié.
     */
    const exposees = CODES_MARCHE.flatMap((code) =>
      facettesDuMarche(code).map((d) => [code, d] as [CodeMarche, DimensionFacette]),
    );
    expect(exposees.length, 'la prémisse : le registre expose bien des facettes').toBeGreaterThan(0);

    /*
     * LE LIBELLÉ SERVI, PAS LE LIBELLÉ NATIF (2026-09-22). Exiger le natif liait les filtres à la
     * traduction, et recouplait donc les deux axes que `NATIVE/FALLBACK` sépare : un marché thaï
     * au corpus sain n'aurait exposé aucun filtre faute de « Type de contrat » en thaï. Un marché
     * en repli sert ses filtres dans la langue qu'il rend AUJOURD'HUI.
     */
    for (const [code, dimension] of exposees) {
      const marche = MARCHES[code];
      const libelle = libelleFacetteServi(marche, dimension);
      expect(libelle, `${code}/${dimension} doit porter un libellé dans la langue servie`).toBeTruthy();
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
     *
     * LES DEUX NOMBRES SONT GRAVÉS SÉPARÉMENT depuis le 2026-09-17, et c'est le point : ouvrir un
     * marché LOCALISÉ et ouvrir un marché ROUTABLE sont deux décisions différentes, au coût et au
     * risque différents. Les additionner en un seul total laisserait passer une traduction
     * supprimée compensée par un pays ouvert.
     */
    expect(CODES_MARCHE_LOCALISES.length, 'la prémisse : douze marchés localisés').toBe(12);
    expect(MARCHES_ROUTABLES.length, 'la prémisse : vingt-neuf marchés routables').toBe(29);
    expect(CODES_MARCHE.length, 'la prémisse : quarante et un marchés au total').toBe(41);

    for (const code of CODES_MARCHE) {
      const m = MARCHES[code];
      expect(m.code, `${code} : le code interne doit correspondre à la clé`).toBe(code);
      expect(m.offresMesurees, `${code} : un volume mesuré strictement positif`).toBeGreaterThan(0);
      expect(m.localeParDefaut, `${code} : une locale de service`).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      expect(m.locales, `${code} : la langue par défaut fait partie des langues servies`).toContain(m.localeParDefaut);
      expect(m.pays, `${code} : un périmètre géographique qui contient son propre code`).toContain(code);
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

  it('la politique belge reste indépendante de la présentation française', () => {
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

/**
 * LES MARCHÉS ROUTABLES — ouvrir un pays sans attendre sa traduction (17/09/2026).
 *
 * Ces témoins gardent des CONSÉQUENCES, pas une forme d'objet. Chacune serait « corrigée » de
 * bonne foi par quelqu'un qui n'a pas la mesure sous les yeux, et chacune a un coût produit
 * précis si elle tombe.
 */
describe('marchés routables — le corpus ouvre le marché, pas la traduction', () => {
  it('les 41 codes sont réellement présents dans la table', () => {
    /*
     * PRÉMISSE DU DÉFAUT — la fusion est écrite avec une assertion `as Record<CodeMarche, Marche>`,
     * qui fait TAIRE le compilateur si un code manque. Sans ce témoin, oublier un pays rendrait
     * `MARCHES.XX` `undefined` au rendu, pas à la compilation.
     */
    expect(CODES_MARCHE.length, 'douze localisés plus vingt-neuf routables').toBe(41);
    for (const code of CODES_MARCHE) {
      expect(MARCHES[code], `MARCHES.${code} absent de la table fusionnée`).toBeDefined();
      expect(marche(code)?.code, `marche('${code}') ne rend pas le bon marché`).toBe(code);
    }
  });

  it('aucun code n’est déclaré deux fois', () => {
    /*
     * Un doublon serait SILENCIEUX : la fusion servirait la version localisée et la ligne
     * routable serait ignorée sans erreur. Le jour où un routable est traduit, il faut le
     * RETIRER de `MARCHES_ROUTABLES`, pas l'ajouter des deux côtés.
     */
    const routables = MARCHES_ROUTABLES.map((m) => m.code);
    const doublons = routables.filter((c) => (CODES_MARCHE_LOCALISES as readonly string[]).includes(c));
    expect(doublons, 'un marché traduit doit sortir de la table des routables').toEqual([]);
    expect(new Set(routables).size, 'un code routable en double').toBe(routables.length);
  });

  it('un marché routable porte sa locale NATIVE, jamais celle du repli', () => {
    /*
     * LA RÈGLE QUE LE CEO A TRANCHÉE, et le mensonge qu'elle empêche : écrire
     * `localeParDefaut: 'en-GB'` sur la Pologne déclarerait que l'anglais britannique EST la
     * langue du marché polonais. Ce mensonge se propagerait au `hreflang`, aux métadonnées et au
     * sélecteur — trois surfaces où il est invisible en revue et visible par le candidat.
     */
    expect(marche('PL')?.localeParDefaut, 'la Pologne est un marché PL').toBe('pl-PL');
    expect(marche('PL')?.localisation).toBe('FALLBACK');
    expect(marche('PL')?.localeDeRepli, 'le repli vit séparément').toBe('en-GB');

    for (const m of MARCHES_ROUTABLES) {
      const registre = marche(m.code);
      expect(registre?.localeParDefaut, `${m.code} doit porter sa locale native`).toBe(m.localeNative);
      expect(registre?.localeParDefaut, `${m.code} ne doit pas porter la locale de repli`).not.toBe('en-GB');
      expect(registre?.localisation, `${m.code} n’est pas encore traduit`).toBe('FALLBACK');
    }
  });

  it('la locale de repli N’ENTRE PAS dans les locales servies', () => {
    /*
     * LE DÉFAUT EXACT, ATTRAPÉ PAR `contrat-marches.test.ts` LE 17/09/2026.
     *
     * La première version de `marcheEnRepli` déclarait `locales: ['pl-PL', 'en-GB']`. C'est
     * `en-GB` servi en Pologne — le même emprunt que D-436 a supprimé en Belgique en le
     * remplaçant par `en-BE`. `locales` dit ce que le marché sert dans SA langue ; le repli est
     * un état transitoire de localisation, pas une langue du marché.
     *
     * PRÉMISSE — le repli doit bien exister quelque part, sinon ce témoin passerait au vert sur
     * un registre qui aurait simplement perdu l'information.
     */
    for (const m of MARCHES_ROUTABLES) {
      const registre = marche(m.code);
      expect(registre?.localeDeRepli, `la prémisse : ${m.code} porte bien un repli`).toBeTruthy();
      expect(registre?.locales, `${m.code} ne sert que sa locale native`).toEqual([m.localeNative]);
      expect(registre?.locales, `${m.code} : le repli n’est pas une locale servie`).not.toContain(
        registre?.localeDeRepli,
      );
    }
  });

  it('un marché localisé n’est jamais marqué en repli', () => {
    for (const code of CODES_MARCHE_LOCALISES) {
      expect(marche(code)?.localisation, `${code} est traduit`).toBe('NATIVE');
      expect(marche(code)?.localeDeRepli, `${code} n’emprunte aucune locale`).toBeUndefined();
    }
  });

  it('INVARIANT : une facette n’est exposée que sur une dimension MESURÉE', () => {
    /*
     * Le principe est durable : ne RIEN exposer plutôt qu'un filtre dont on ignore s'il masque
     * quatre offres sur cinq. Le remplir « pour faire propre » avec les taux d'un marché voisin
     * est le piège que CA-fr a révélé sur les libellés.
     *
     * Ce qui a changé le 2026-09-22, c'est le FAIT, pas la règle : les 41 marchés sont désormais
     * mesurés, routables compris. Le témoin vérifie donc l'implication — couverture nulle ⇒
     * aucune exposition — au lieu de graver « les routables valent zéro », qui n'est plus vrai.
     */
    let controles = 0;
    for (const code of CODES_MARCHE) {
      const m = marche(code);
      if (!m) continue;
      const exposees = new Set(facettesDuMarche(code));
      for (const d of DIMENSIONS_FACETTE) {
        if (m.couverture[d] !== 0) continue;
        controles++;
        expect(exposees.has(d), `${code}.${d} : couverture nulle, donc jamais exposée`).toBe(false);
      }
    }
    /* Sans dimension non mesurée nulle part, la boucle ne prouverait rien. */
    expect(controles, 'la prémisse : au moins une dimension reste non mesurée').toBeGreaterThan(0);
  });

  it('les six pays à code ambigu restent hors du registre', () => {
    /*
     * IN · CO · IL · MO · MA · ID portent 1 015 offres et sont ÉCARTÉS : leur code ISO est aussi
     * une subdivision fédérale des États-Unis, et la part d'offres portant une preuve pays
     * explicite est trop faible pour trancher (3 % pour l'Inde sur 576 offres ; 0 % pour IL, MO
     * et MA). Les ouvrir servirait à un candidat indien des offres de l'Indiana.
     *
     * L'INDE EST LE CAS À CONNAÎTRE : sa locale `en-IN` est validée et son volume la placerait au
     * premier rang des routables. Ce témoin ne dit pas « l'Inde n'est pas un marché » — il dit
     * que la GÉOGRAPHIE bloque, pas la langue. Il rougira le jour où Country Resolution rend ses
     * preuves, et c'est le signal attendu pour l'ouvrir.
     */
    for (const code of ['IN', 'CO', 'IL', 'MO', 'MA', 'ID']) {
      expect(estCodeMarche(code), `${code} : code ambigu, pays non prouvé`).toBe(false);
      expect(marche(code), `${code} ne doit pas être servi comme marché`).toBeUndefined();
    }
  });

  it('LA LOCALE SERVIE EST L’ANGLAIS, PAS LE FRANÇAIS — le défaut qui touchait 29 marchés', () => {
    /*
     * ── LE DÉFAUT EXACT, ET POURQUOI IL ÉTAIT INVISIBLE ──────────────────────────────────────
     *
     * `langueDesLibelles` ne connaît que deux catalogues, `fr` et `en` (`packages/db/presentation.ts`).
     * Recevant `pl-PL`, elle ne trouve pas `pl` et retombe sur SON défaut : `fr`. Un visiteur
     * polonais aurait donc lu « Temps plein », « Stage », « Pologne » — en FRANÇAIS — sur un
     * marché dont le repli décidé est l'anglais. Le même défaut sur les vingt-neuf marchés.
     *
     * Rien n'aurait rougi : le registre portait bien `localeDeRepli`, mais AUCUN code ne le
     * lisait. Une garantie sans appelant n'est pas une garantie.
     *
     * PRÉMISSE — il faut d'abord établir que la locale NATIVE tombe bien dans le piège, sinon ce
     * témoin passerait au vert sur un marché dont la langue est servie de toute façon.
     */
    /*
     * Les deux seuls catalogues de libellés sont `fr` et `en` (`packages/db/presentation.ts`) :
     * la langue d'une locale servie DOIT donc être l'une des deux, sinon la résolution retombe
     * sur son défaut — le français. Le témoin ne recopie pas cette liste, il l'affirme.
     *
     * (`langueDesLibelles` n'est pas importée ici : `presentation.ts` importe un JSON, et le
     * tirer dans le graphe de compilation de l'agrégateur casse son typecheck. La chaîne
     * complète, du registre jusqu'au contrat servi, est gardée côté API par
     * `apps/api/lib/__tests__/libelles-langue-lot8.test.ts`.)
     */
    const langueDe = (locale: string | undefined) => locale?.split('-')[0];
    expect(langueDe('pl-PL'), 'la prémisse : la locale native polonaise porte bien `pl`').toBe('pl');

    for (const m of MARCHES_ROUTABLES) {
      const servie = localeServie(marche(m.code));
      expect(servie, `${m.code} : la locale servie est le repli`).toBe('en-GB');
      expect(
        langueDe(servie),
        `${m.code} : le candidat doit lire l’ANGLAIS, jamais sa locale native sans catalogue`,
      ).toBe('en');
      expect(langueDe(servie), `${m.code} ne doit pas retomber sur le français`).not.toBe('fr');
    }
  });

  it('un marché localisé lit sa propre locale, pas un repli', () => {
    /*
     * La moitié symétrique : `localeServie` ne doit PAS dévier un marché traduit. Sans ce
     * témoin, une implémentation qui renverrait `en-GB` pour tout le monde passerait le témoin
     * précédent et casserait les douze marchés localisés en silence.
     */
    for (const code of CODES_MARCHE_LOCALISES) {
      expect(localeServie(marche(code)), `${code} sert sa propre locale`).toBe(marche(code)?.localeParDefaut);
    }
    expect(localeServie(marche('FR')), 'la France reste sur sa propre locale').toBe('fr-FR');
    expect(localeServie(undefined), 'aucun marché, aucune locale inventée').toBeUndefined();
  });

  it('un marché routable borne son périmètre à son seul pays', () => {
    /*
     * `pays` est ce que le SQL utilise pour borner les offres. Un routable qui en porterait
     * plusieurs servirait des offres d'un pays voisin sous le drapeau du sien.
     */
    for (const m of MARCHES_ROUTABLES) {
      expect(marche(m.code)?.pays, `${m.code} doit borner son seul pays`).toEqual([m.code]);
    }
  });
});
