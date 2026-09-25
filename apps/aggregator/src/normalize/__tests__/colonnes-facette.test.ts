import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DIMENSIONS_EMPLOI_MESURABLES,
  EXPRESSION_AFFICHEE,
  EXPRESSION_FACETTE,
  POPULATION_MESUREE,
  sqlCouverture,
  sqlDiversite,
  type DimensionMesurable,
} from '@catwalks/db/colonnes-facette';

/**
 * LES OUTILS DE MESURE LISENT LA MÊME COLONNE QUE LA FACETTE SERVIE.
 *
 * ── LE DÉFAUT QUE CES TÉMOINS GARDENT, ET SON COÛT RÉEL ───────────────────────────────────────
 *
 * Le 15/09/2026 le registre a été corrigé : la facette « métier » agrège `occupationCode`, pas
 * `jobFunction` — 42 points d'écart en moyenne. Les deux sondes de décision, elles, sont restées
 * sur `jobFunction` jusqu'au 17/09. Elles ont servi à ouvrir 29 marchés.
 *
 * Conséquence chiffrée, mesurée en production le 17/09 : la Pologne annoncée « métier exposable »
 * tombe à 20,2 % sur la colonne servie, le Danemark à 17,6 %, la Thaïlande à 16,7 % — sous le
 * seuil. La décision a été prise sur un chiffre qui décrivait une autre colonne.
 *
 * ── LA MÉTHODE, ET POURQUOI ELLE LIT DU TEXTE ─────────────────────────────────────────────────
 *
 * Ces témoins lisent le SOURCE de `job-search-query.ts` et des sondes, pas des constantes. C'est
 * inhabituel et c'est le seul moyen : le SQL de la facette est un template Prisma construit à
 * l'exécution contre une vraie base. Un témoin qui comparerait deux constantes entre elles
 * passerait au vert pendant que le SQL réel agrège autre chose — exactement le défaut qu'on ferme.
 *
 * Ils rougissent donc si quelqu'un change la colonne d'un côté sans l'autre. C'est leur travail.
 */

const RACINE = new URL('../../../../../', import.meta.url).pathname;
const lire = (chemin: string) => readFileSync(RACINE + chemin, 'utf8');

const REQUETE_FACETTES = lire('apps/api/lib/job-search-query.ts');
const SONDE_QUALIFICATION = lire('audits/mesures-d435-d436/qualification-marche-2026-09-17.mjs');
const SONDE_ROUTABLES = lire('audits/mesures-d435-d436/marches-routables-2026-09-17.mts');
const GARDE_COUVERTURE = lire('apps/aggregator/scripts/ops/verif-couverture-registre.mts');

/** Le bloc `jsonb_build_object(...)` qui construit les facettes servies, isolé du reste du SQL. */
const BLOC_FACETTES = (() => {
  const debut = REQUETE_FACETTES.indexOf("'pays', ${facette(");
  expect(debut, 'le bloc de construction des facettes est introuvable : la requête a changé de forme').toBeGreaterThan(0);
  return REQUETE_FACETTES.slice(debut, REQUETE_FACETTES.indexOf(') AS facettes', debut));
})();

describe('les outils de mesure lisent la colonne que la facette sert', () => {
  it('PRÉMISSE : le bloc de facettes lu est bien celui qui construit la réponse', () => {
    /*
     * Sans cette assertion, une requête renommée ou déplacée ferait chercher les colonnes dans
     * une chaîne vide, et TOUS les témoins ci-dessous passeraient au vert sans rien vérifier.
     */
    expect(BLOC_FACETTES.length, 'le bloc extrait est vide ou tronqué').toBeGreaterThan(200);
    for (const cle of ['pays', 'metier', 'contrat', 'temps', 'programme', 'ville', 'langue']) {
      expect(BLOC_FACETTES, `la facette « ${cle} » a disparu de la requête`).toContain(`'${cle}',`);
    }
  });

  it('CHAQUE dimension déclarée agrège bien cette expression dans le SQL servi', () => {
    /*
     * Le cœur du témoin. `EXPRESSION_FACETTE` prétend décrire ce que la facette agrège : on le
     * VÉRIFIE contre le SQL, dimension par dimension, plutôt que de le croire.
     *
     * `metier` est le cas particulier : la facette l'enveloppe dans un COALESCE d'AFFICHAGE
     * (« Métier à préciser »), que la mesure ne doit PAS reprendre — compter les `unclassified`
     * comme renseignés rendrait 100 % partout.
     */
    /*
     * Deux étapes à chercher, parce que le SQL en a deux : une dimension peut être calculée dans
     * la CTE `base` puis aliasée (`lower(trim(j.city)) AS ville`), et la facette agrège alors
     * l'alias. Chercher l'expression uniquement dans le bloc de facettes ferait rougir `ville`
     * pour une bonne implémentation — un faux positif qui décrédibiliserait le témoin entier.
     */
    const sql = (BLOC_FACETTES + '\n' + REQUETE_FACETTES).replace(/\b[bjd]\./g, '');
    for (const [dimension, expression] of Object.entries(EXPRESSION_FACETTE) as Array<[DimensionMesurable, string]>) {
      const attendu = EXPRESSION_AFFICHEE[dimension] ?? expression;
      expect(sql, `la facette « ${dimension} » n'agrège nulle part ${attendu}`).toContain(attendu);
    }
  });

  it('LE MÉTIER agrège occupationCode et JAMAIS jobFunction — le défaut de 42 points', () => {
    /*
     * PRÉMISSE — les deux colonnes doivent exister et être distinctes, sinon ce témoin ne teste
     * rien. `jobFunction` est encore une colonne réelle du schéma : c'est ce qui rend la
     * confusion possible, et c'est pour ça que le témoin est nécessaire.
     */
    expect(EXPRESSION_FACETTE.metier).toBe('"occupationCode"');
    expect(EXPRESSION_FACETTE.metier).not.toContain('jobFunction');

    const sql = BLOC_FACETTES.replace(/\bb\./g, '');
    expect(sql, 'la facette métier doit lire occupationCode').toContain('"occupationCode"');
    expect(sql, 'jobFunction ne doit jamais apparaître dans une facette').not.toContain('jobFunction');
  });

  it('AUCUNE sonde ne mesure une colonne que la facette n’agrège pas', () => {
    /*
     * LE TÉMOIN QUI AURAIT ATTRAPÉ LE DÉFAUT. Les trois outils de mesure sont balayés : si l'un
     * d'eux nomme `jobFunction` ou `seniority` comme colonne de mesure, il rougit.
     *
     * `seniority` est incluse parce qu'elle a été RETIRÉE des dimensions de facette le 15/09
     * (99,97 % déduite par regex) : la mesurer comme une facette décrirait une facette qui
     * n'existe plus.
     *
     * Les mentions en COMMENTAIRE sont tolérées — les trois fichiers expliquent précisément
     * pourquoi cette colonne est piégeuse, et cette explication doit pouvoir rester.
     */
    const outils = [
      ['qualification-marche-2026-09-17.mjs', SONDE_QUALIFICATION],
      ['marches-routables-2026-09-17.mts', SONDE_ROUTABLES],
      ['verif-couverture-registre.mts', GARDE_COUVERTURE],
    ] as const;

    for (const [nom, source] of outils) {
      const code = source
        .split('\n')
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join('\n');
      for (const interdite of ['jobFunction', 'seniority']) {
        const fautives = code
          .split('\n')
          .filter((l) => l.includes(interdite) && /metier|seniorite|DIMENSIONS|couverture/i.test(l));
        expect(fautives, `${nom} mesure « ${interdite} » comme une dimension de facette : ${fautives.join(' | ')}`).toEqual([]);
      }
    }
  });

  it('LES SONDES déclarent la mesure en passant par la primitive partagée', () => {
    /*
     * Corriger la colonne ne suffit pas : si une sonde redéclare sa propre table de
     * correspondance, elle rediverge au prochain changement. Ce témoin exige qu'elles IMPORTENT
     * la déclaration unique. C'est ce qui transforme un correctif ponctuel en garantie.
     */
    for (const [nom, source] of [
      ['qualification-marche-2026-09-17.mjs', SONDE_QUALIFICATION],
      ['marches-routables-2026-09-17.mts', SONDE_ROUTABLES],
    ] as const) {
      expect(source, `${nom} doit lire colonnes-facette, pas redéclarer ses colonnes`).toContain('colonnes-facette');
    }
  });

  it('LE SQL de mesure exclut la chaîne vide, comme la facette', () => {
    /*
     * `count(colonne)` compte la chaîne vide ; la facette l'exclut (`<> ''`). Mesuré le 17/09 :
     * zéro chaîne vide sur les six dimensions, donc l'écart est nul AUJOURD'HUI.
     *
     * Le témoin garde quand même la règle : le jour où une source écrit une chaîne vide, la
     * mesure et la facette doivent diverger par décision, pas par accident.
     */
    for (const d of DIMENSIONS_EMPLOI_MESURABLES) {
      expect(sqlCouverture(d), `${d} : la mesure doit exclure la chaîne vide`).toContain("<> ''");
      expect(sqlDiversite(d), `${d} : la diversité doit exclure la chaîne vide`).toContain("<> ''");
    }
    expect(BLOC_FACETTES, 'la facette elle-même doit exclure la chaîne vide').toBeTruthy();
    expect(REQUETE_FACETTES, "la requête de facette a cessé d'exclure la chaîne vide").toContain("::text <> ''");
  });

  it('LA POPULATION mesurée : le catalogue agrégé seul, et les offres directes comptées par la facette sont NOMMÉES (D-444)', () => {
    /*
     * La facette est construite sur une UNION `Job` + `DirectOffer`. Jusqu'au 25/09/2026, l'UNION
     * forçait `NULL::text` sur l'`occupationCode` des offres directes et `DirectOffer` était vide :
     * mesurer `Job` seul rendait exactement la population servie. D-444 donne aux offres directes le
     * métier de la taxonomie (`d."occupationCode"`) : la facette les compte désormais.
     *
     * Ce témoin a rougi à ce changement, c'était son travail. La mesure reste celle du catalogue
     * agrégé (sur lui se décide l'exposition d'une facette), et l'écart est déclaré avec sa raison
     * dans `POPULATION_MESUREE` : il rougit si l'UNION et la déclaration divergent de nouveau.
     */
    expect(POPULATION_MESUREE.table).toBe('Job');
    expect(POPULATION_MESUREE.tableExclue).toBe('DirectOffer');
    expect(REQUETE_FACETTES, "l'UNION avec DirectOffer a disparu : la population mesurée est à revoir")
      .toContain('FROM "DirectOffer" d');
    // L'UNION porte le métier des offres directes : l'exclusion de la mesure est un choix nommé, plus une hypothèse vide.
    expect(REQUETE_FACETTES, 'l’UNION ne porte plus le métier des offres directes : revoir POPULATION_MESUREE')
      .toContain('0 AS origine, d."occupationCode"');
    expect(POPULATION_MESUREE.raisonExclusion, 'la raison de l’exclusion doit nommer la décision qui l’a rendue nécessaire').toMatch(/D-444/);
  });

  it('LE SAISONNIER n’est pas mesurable comme les autres — et c’est dit, pas oublié', () => {
    /*
     * `saisonnier` est dans `DIMENSIONS_FACETTE` (marches.ts) mais absent de `EXPRESSION_FACETTE` :
     * il vit dans `isSeasonal`, un booléen, et AUCUN marché ne porte de libellé natif pour lui —
     * donc aucune facette n'est servie. Sans ce témoin, son absence ressemblerait à un oubli et
     * quelqu'un l'ajouterait de bonne foi avec une colonne inventée.
     */
    expect(Object.keys(EXPRESSION_FACETTE)).not.toContain('saisonnier');
    expect(BLOC_FACETTES, 'aucune facette « saisonnier » n’est servie').not.toContain("'saisonnier',");
  });
});
