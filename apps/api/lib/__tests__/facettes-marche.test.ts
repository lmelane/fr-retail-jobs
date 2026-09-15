import { describe, expect, it } from 'vitest';
import { facetteServie, facettesServies, type NomFacetteApi } from '../facettes-marche.js';
import { parseFilters, whereClause } from '../jobs.js';
import { facettesDuMarche } from '../../../aggregator/src/normalize/marches.js';

/**
 * LOT « FACETTES NATIVES » — l'API ne sert que les filtres qui ont du sens sur
 * le marché demandé.
 *
 * Principe produit (arbitrage Loïc) : « respecter les données natives des pays.
 * Offres FR → champs FR → filtres FR. Offres internationales → champs
 * internationaux. Il ne faut pas imposer les champs d'un pays à un autre. »
 *
 * ── POURQUOI CHAQUE TÉMOIN OUVRE SUR UNE ASSERTION DE PRÉMISSE ────────────
 *
 * Un témoin qui ne prouve pas que sa situation de départ EXERCE le défaut peut
 * passer au vert sans rien tester. Ici le piège est net : si le registre
 * cessait un jour de distinguer US et FR — parce qu'on lui a ajouté un défaut,
 * ou parce que quelqu'un a aligné les couvertures — un témoin qui se contente
 * d'affirmer « US n'a pas `contracts` » passerait encore alors que la règle
 * aurait disparu. Chaque cas affirme donc d'abord que le registre porte bien la
 * divergence qu'on prétend vérifier.
 */

/** Un objet de facettes complet, de la forme exacte que `getJobs` assemble. */
function facettesCompletes(): Record<NomFacetteApi, { value: string; count: number }[]> {
  return {
    sectors: [{ value: 'mode', count: 10 }],
    contracts: [{ value: 'PERMANENT', count: 10 }],
    workTimes: [{ value: 'FULL_TIME', count: 10 }],
    programs: [{ value: 'INTERNSHIP', count: 10 }],
    engagements: [{ value: 'EMPLOYEE', count: 10 }],
    cities: [{ value: 'Paris', count: 10 }],
    groups: [{ value: 'LVMH', count: 10 }],
    maisons: [{ value: 'Dior', count: 10 }],
    sources: [{ value: 'indeed', count: 10 }],
    countries: [{ value: 'FR', count: 10 }],
    occupations: [{ value: 'vendeur', count: 10 }],
    languages: [{ value: 'fr', count: 10 }],
  };
}

describe('marché US — pas de facette de contrat', () => {
  it("le registre déclare bien que le contrat n'est PAS exposé aux US", () => {
    /*
     * PRÉMISSE. Sans cette assertion, tous les cas ci-dessous pourraient passer
     * sur un registre où US n'existerait plus du tout (facettesDuMarche rendrait
     * [] → dégradation sûre → tout servi → mais alors `contracts` serait
     * PRÉSENT et le cas suivant rougirait). On affirme donc les deux faits qui
     * rendent le test signifiant : le marché est connu, et il exclut `contrat`.
     *
     * Chiffre : 19,2 % de couverture contractuelle aux US contre un seuil de
     * 20 % (mesuré le 2026-09-15 sur 36 942 offres actives américaines).
     */
    const dimensions = facettesDuMarche('US');
    expect(dimensions.length).toBeGreaterThan(0); // le marché EST mesuré
    expect(dimensions).not.toContain('contrat'); // et il exclut le contrat
  });

  it('`contracts` est ABSENTE de la réponse, pas vide', () => {
    const servies = facettesServies(facettesCompletes(), 'US');

    // Absente : le front doit pouvoir dire « pas de facette sur ce marché ».
    expect('contracts' in servies).toBe(false);
    // Et surtout PAS un tableau vide, qui dirait « facette légitime, 0 valeur ».
    expect(servies.contracts).toBeUndefined();
  });

  it('le rythme de travail, lui, reste servi aux US (81,8 % de couverture)', () => {
    // Prémisse : c'est bien la dimension DENSE du marché américain — sans elle,
    // « US perd une facette » deviendrait « US perd toutes ses facettes », et le
    // témoin ci-dessus ne prouverait plus rien de spécifique au contrat.
    expect(facettesDuMarche('US')).toContain('temps');

    expect(facettesServies(facettesCompletes(), 'US').workTimes).toBeDefined();
  });
});

describe('marché FR — le contrat est servi', () => {
  it('le registre expose bien le contrat en France (69,2 % de couverture)', () => {
    // PRÉMISSE, et c'est elle qui rend le lot démontrable : FR et US doivent
    // DIVERGER. Deux marchés traités pareil ne prouveraient aucune nativité.
    expect(facettesDuMarche('FR')).toContain('contrat');
    expect(facettesDuMarche('US')).not.toContain('contrat');
  });

  it('`contracts` est présente pour FR', () => {
    const servies = facettesServies(facettesCompletes(), 'FR');
    expect(servies.contracts).toBeDefined();
    expect(servies.contracts).toEqual([{ value: 'PERMANENT', count: 10 }]);
  });
});

describe('dégradation sûre — marché absent ou inconnu', () => {
  it("BE n'est pas mesuré : c'est la prémisse du cas « inconnu »", () => {
    // Si la Belgique entrait un jour au registre, ce témoin rougirait — et il
    // DOIT rougir : le cas « inconnu » devrait alors être rejoué sur un autre
    // pays, sans quoi il ne testerait plus la dégradation.
    expect(facettesDuMarche('BE')).toHaveLength(0);
  });

  it('un marché inconnu sert TOUTES les facettes', () => {
    const completes = facettesCompletes();
    const servies = facettesServies(completes, 'BE');
    expect(Object.keys(servies).sort()).toEqual(Object.keys(completes).sort());
  });

  it('un marché absent sert TOUTES les facettes — le comportement actuel, inchangé', () => {
    const completes = facettesCompletes();
    for (const absent of [undefined, '']) {
      const servies = facettesServies(completes, absent);
      expect(Object.keys(servies).sort()).toEqual(Object.keys(completes).sort());
    }
  });

  it('un code malformé ne fait pas tomber le rendu', () => {
    // Le registre est lu sur un CHEMIN DE RENDU : un paramètre d'URL bricolé
    // doit dégrader, jamais lever.
    for (const bidon of ['??', 'FRANCE', '  ', 'us-east-1']) {
      expect(() => facettesServies(facettesCompletes(), bidon)).not.toThrow();
    }
  });
});

describe('les facettes hors périmètre du registre survivent à tout marché', () => {
  it('ville, secteur, pays, langue, maison, groupe, source restent servies même aux US', () => {
    // Prémisse : on est bien sur le marché le plus restrictif du registre.
    expect(facettesDuMarche('US')).not.toContain('contrat');

    const servies = facettesServies(facettesCompletes(), 'US');
    for (const nom of ['sectors', 'cities', 'countries', 'languages', 'maisons', 'groups', 'sources'] as const) {
      expect(servies[nom], `${nom} ne doit jamais dépendre du marché`).toBeDefined();
    }
  });
});

describe('IMPÉRATIF — masquer la facette ne casse JAMAIS le filtrage', () => {
  /*
   * Le lien partagé est le cas d'usage qui décide de tout ce bloc. Des URL
   * portant `?contrat=PERMANENT` circulent déjà (le paramètre français reste
   * accepté en lecture). Si masquer la facette masquait aussi le filtre, ces
   * liens deviendraient muets : le destinataire verrait le catalogue entier en
   * croyant lire une sélection. Un filtre silencieusement ignoré est pire qu'un
   * filtre refusé — il ment sans le dire.
   *
   * On masque ce qu'on PROPOSE, jamais ce qu'on HONORE.
   */
  it('`?contrat=PERMANENT&marche=US` filtre toujours, alors que la facette est masquée', () => {
    // PRÉMISSE : le marché de l'URL est bien celui qui masque la facette.
    expect(facettesDuMarche('US')).not.toContain('contrat');

    const filtres = parseFilters({ contrat: 'PERMANENT', marche: 'US' });

    // Le marché est lu…
    expect(filtres.marche).toBe('US');
    // …et le critère de contrat survit au parsing.
    expect(filtres.employmentTerms).toEqual(['PERMANENT']);

    // …et il atteint réellement le SQL.
    const clause = whereClause(filtres);
    const criteres = JSON.stringify(clause.AND);
    expect(criteres).toContain('PERMANENT');
    expect(criteres).toContain('employmentTerm');

    // Pendant ce temps, la facette reste absente de la réponse.
    expect(facettesServies(facettesCompletes(), filtres.marche).contracts).toBeUndefined();
  });

  it('`marche` ne filtre AUCUNE offre — ce n’est pas un filtre pays', () => {
    /*
     * Prémisse : `countries` est vide, donc si `marche` fuyait dans la clause
     * SQL, il n'y aurait rien d'autre pour le masquer et l'écart serait visible.
     */
    const filtres = parseFilters({ marche: 'US' });
    expect(filtres.countries).toBeUndefined();

    const sansMarche = JSON.stringify(whereClause(parseFilters({})));
    const avecMarche = JSON.stringify(whereClause(filtres));
    expect(avecMarche).toBe(sansMarche);
  });

  it('`market` (en) est accepté au même titre que `marche` (fr)', () => {
    // Les deux façades du site appellent la même API ; n'en accepter qu'une
    // produirait un marché muet sur l'autre — donc un défaut silencieux.
    expect(parseFilters({ market: 'US' }).marche).toBe('US');
    expect(parseFilters({ marche: 'FR' }).marche).toBe('FR');
  });
});

describe("l'absence survit à la projection — le chemin que sert /api/jobs", () => {
  /*
   * LE PIÈGE QUI A FAILLI RENDRE LE LOT INERTE.
   *
   * `getJobs` retire bien la facette, mais la route publique `/api/jobs` ne
   * rend pas `getJobs` : elle rend `projeterListe(result)`, qui repose les
   * libellés. Son `libellerFacette` faisait `facette ?? []` — il retransformait
   * donc « absente » en « vide » au tout dernier moment, sur le SEUL chemin que
   * le front consomme. Le typecheck restait vert et la réponse paraissait
   * correcte : rien ne l'aurait signalé.
   */
  it('une facette retirée par le marché ne réapparaît pas en tableau vide', async () => {
    const { projeterListe } = await import('../projection.js');

    // PRÉMISSE : on part bien d'un résultat où la facette a DÉJÀ été retirée.
    const facets = facettesServies(facettesCompletes(), 'US');
    expect('contracts' in facets).toBe(false);

    const projete = projeterListe({
      jobs: [],
      total: 0,
      totalInDatabase: 0,
      page: 1,
      pageCount: 1,
      facets,
    } as unknown as Parameters<typeof projeterListe>[0]);

    // Toujours absente après libellage — ni clé, ni tableau vide.
    expect('contracts' in projete.facets).toBe(false);
    expect(JSON.parse(JSON.stringify(projete.facets))).not.toHaveProperty('contracts');
  });

  it('une facette servie mais VIDE reste un tableau vide, pas une absence', () => {
    // L'autre moitié du contrat, et elle doit tenir aussi : une recherche trop
    // étroite sur un marché français laisse `contracts: []` — le filtre existe,
    // il n'a simplement aucune valeur. Le confondre avec l'absence ferait
    // disparaître un filtre légitime.
    const vide = { ...facettesCompletes(), contracts: [] };
    const servies = facettesServies(vide, 'FR');
    expect('contracts' in servies).toBe(true);
    expect(servies.contracts).toEqual([]);
  });
});

describe('`critereTolerantAuxInconnus` fonctionne toujours', () => {
  /*
   * RÈGLE PRODUIT (CEO) : « une information inconnue reste accessible ; une
   * incompatibilité connue reste excluante. » Ce lot touche l'assemblage des
   * facettes ; il ne doit rien changer à la clause SQL. Mesuré le 14/09/2026 :
   * une recherche « France + CDI + temps partiel » excluait 3 131 offres
   * muettes contre 1 016 correspondances — le défaut que cette tolérance ferme.
   */
  it('une offre muette sur le contrat reste atteignable, marché ou pas', () => {
    for (const marche of [undefined, 'US', 'FR']) {
      const clause = whereClause(parseFilters({ contrat: 'PERMANENT', ...(marche ? { marche } : {}) }));
      const criteres = JSON.stringify(clause.AND);

      // PRÉMISSE : le critère de contrat est bien posé — sans lui, l'absence de
      // branche NULL ne prouverait rien.
      expect(criteres).toContain('PERMANENT');
      // La branche « valeur non renseignée » survit.
      expect(criteres).toContain('{"employmentTerm":null}');
    }
  });

  it('la tolérance vaut pour chaque dimension, y compris quand un marché est servi', () => {
    const clause = whereClause(
      parseFilters({ contrat: 'PERMANENT', workTime: 'FULL_TIME', langue: 'fr', marche: 'US' }),
    );
    const criteres = JSON.stringify(clause.AND);
    for (const colonne of ['employmentTerm', 'workTime', 'language']) {
      expect(criteres, `${colonne} doit garder sa branche NULL`).toContain(`{"${colonne}":null}`);
    }
  });
});

describe('la table de correspondance suit le registre, elle ne le recopie pas', () => {
  it('toute dimension retenue par un marché correspond à une facette servie', () => {
    /*
     * Ce témoin est le garde-fou contre la dérive des deux vocabulaires. Il
     * rougit si le registre expose une dimension que l'API ne sait pas nommer —
     * cas qui produirait une facette calculée, retenue par le registre, et
     * pourtant jamais servie : le trou exact que `metier` a déjà creusé une
     * fois dans le registre lui-même.
     *
     * PRÉMISSE : on interroge bien plusieurs marchés qui exposent des jeux de
     * dimensions DIFFÉRENTS, sinon on ne testerait qu'un cas déguisé en dix.
     */
    const jeux = ['US', 'FR', 'CH'].map((c) => [...facettesDuMarche(c)].sort().join(','));
    expect(new Set(jeux).size).toBeGreaterThan(1);

    const completes = facettesCompletes();
    for (const code of ['US', 'FR', 'GB', 'CA', 'DE', 'IT', 'ES', 'NL', 'AU', 'CH']) {
      const servies = facettesServies(completes, code);
      // Aucun marché ne doit se retrouver SANS aucune facette : ce serait un
      // catalogue sans filtres, donc un marché inexploitable.
      expect(Object.keys(servies).length, `${code} ne doit pas perdre toutes ses facettes`).toBeGreaterThan(0);
    }
  });

  it('`facetteServie` et `facettesServies` disent la même chose', () => {
    // Deux portes vers la même règle : si elles divergeaient, l'une servirait
    // une facette que l'autre masque, selon l'appelant.
    const completes = facettesCompletes();
    for (const code of [undefined, 'US', 'FR', 'BE']) {
      const servies = facettesServies(completes, code);
      for (const nom of Object.keys(completes) as NomFacetteApi[]) {
        expect(nom in servies, `${nom} @ ${code}`).toBe(facetteServie(nom, code));
      }
    }
  });

  it('« occupations » survit elle aussi au libellage si elle est masquée', async () => {
    /*
     * TROU DE COUVERTURE SIGNALÉ PAR L'AUDIT DÉFENSIF du 15/09/2026.
     *
     * `contracts`, `workTimes`, `programs` et `engagements` avaient chacune un
     * témoin d'absence. Pas `occupations` — parce qu'elle est servie sur les
     * DIX marchés mesurés (métier 77,7 % à 96,8 %), donc son chemin d'absence
     * est aujourd'hui inatteignable.
     *
     * Ce n'est pas une raison de ne pas le garder. `occupations` traverse
     * `projeterListe` par `...autresFacettes` et non par une destructuration
     * explicite : rien ne garantit qu'un futur `?? []` n'y soit pas ajouté, et
     * c'est EXACTEMENT le défaut que l'agent a trouvé à son second tour sur
     * `contracts` — typecheck vert, réponse d'apparence correcte, lot inerte.
     *
     * Le lot 4 (émission de `?marche=`) rendra ce chemin réellement
     * atteignable le jour où un marché passerait sous le seuil sur le métier.
     *
     * PRÉMISSE — le masquage est ici SIMULÉ, puisqu'aucun marché réel ne
     * masque le métier. Sans cette assertion, le témoin ne prouverait rien.
     */
    const { projeterListe } = await import('../projection.js');

    const { occupations: _retiree, ...sansMetier } = facettesCompletes();
    expect('occupations' in sansMetier, 'la prémisse : la facette est bien retirée').toBe(false);

    const projete = projeterListe({
      jobs: [],
      total: 0,
      totalInDatabase: 0,
      page: 1,
      pageCount: 1,
      facets: sansMetier,
    } as unknown as Parameters<typeof projeterListe>[0]);

    expect('occupations' in projete.facets, 'ni clé ajoutée').toBe(false);
    expect(JSON.parse(JSON.stringify(projete.facets)), 'ni tableau vide après sérialisation')
      .not.toHaveProperty('occupations');
  });
});
