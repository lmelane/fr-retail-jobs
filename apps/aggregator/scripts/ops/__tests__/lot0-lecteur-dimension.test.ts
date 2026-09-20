import { describe, expect, it } from 'vitest';
import { lireValeur, nommeLaDimension, verdictDimension } from '../lot0-lecteur-dimension.js';
import { etatSignal, verdictOffre } from '../lot0-lecteurs.js';

/**
 * TÉMOINS DU LECTEUR PAR DIMENSION.
 *
 * Chaque cas couvre la chaîne complète demandée : source/variante → chemin → valeur RAW →
 * dimension → résultat attendu. Un lecteur générique éprouvé sur des valeurs inventées ne prouve
 * rien sur les déclarations de chemins réelles ; les valeurs ci-dessous sont celles mesurées dans
 * les sorties d'audit (`backups/`), avec leur source d'origine.
 */
describe('lecteur par dimension — ce que la valeur NOMME', () => {
  describe('le défaut structurel de l\'ancien lecteur', () => {
    it('« Full Time » ne nomme PAS un terme de contrat', () => {
      /*
       * LE FAUX POSITIF EXACT. JIBE `tags1: ["Full Time"]` (10 032 offres). Déclaré pour la
       * dimension `contrat`, l'ancien lecteur rendait SIGNAL_VALIDE puis PERTE_CONFIRMEE dès que
       * `employmentTerm` était vide — alors que cette valeur ne dit rien d'un terme.
       */
      expect(nommeLaDimension('Full Time', 'contrat')).toBe(false);
      expect(nommeLaDimension('Full Time', 'temps')).toBe(true);

      // PRÉMISSE — sans elle ce témoin ne prouverait pas qu'il exerce le défaut :
      // l'ANCIEN lecteur classait bien cette valeur en perte sur `contrat`.
      const ancien = etatSignal({ tags1: ['Full Time'] }, ['tags1'], 'contrat');
      expect(ancien).toBe('SIGNAL_VALIDE');
      expect(verdictOffre(ancien, false)).toBe('PERTE_CONFIRMEE');

      /*
       * Le nouveau lecteur ne voit aucune perte — et il DIT POURQUOI : la valeur est lue, mais
       * elle nomme une autre dimension. C'est un chemin mal déclaré par l'audit, pas un trou du
       * produit, et les deux ne se corrigent pas au même endroit.
       */
      expect(verdictDimension(['Full Time'], 'contrat', null)).toBe('NOMME_AUTRE_DIMENSION');
      expect(lireValeur('Full Time').temps).toBe('FULL_TIME');
    });

    it('« CDD » nomme bien un terme : la perte y est RÉELLE', () => {
      // Le témoin symétrique : le correctif ne doit pas effacer les vraies pertes.
      expect(nommeLaDimension('CDD', 'contrat')).toBe(true);
      expect(verdictDimension(['CDD'], 'contrat', null)).toBe('PERTE_CONFIRMEE');
    });
  });

  describe('une valeur peut nommer PLUSIEURS dimensions à la fois', () => {
    it('« PT Temp/Seasonal » (Lever, 89 offres) en nomme TROIS — depuis L2', () => {
      /*
       * HISTORIQUE DE CE TÉMOIN — il a fait exactement ce qu'on lui demandait.
       *
       * Écrit le 2026-09-20, il gravait un DÉFAUT mesuré par exécution : le décodeur ne rendait
       * que deux dimensions, l'abréviation `PT` n'étant attrapée par aucun motif. Le lot L2 a
       * corrigé ce défaut ; le témoin est alors passé au ROUGE, ce qui est le signal voulu — un
       * témoin qui grave un défaut doit rougir quand le défaut disparaît, sinon il le pérennise.
       *
       * Il vérifie désormais le comportement corrigé, et la BORNE de la correction : `PT` isolé
       * ne prouve toujours rien (voir `employment-abreviations-l2.test.ts` pour le détail).
       */
      const lu = lireValeur('PT Temp/Seasonal');
      expect(lu.temps).toBe('PART_TIME');
      expect(lu.contrat).toBe('FIXED_TERM');
      expect(lu.saisonnier).toBe('true');

      // La borne : hors code composite, l'abréviation seule reste ignorée.
      expect(lireValeur('Part Time').temps).toBe('PART_TIME');
      expect(lireValeur('PT').temps).toBeUndefined();
    });

    it('« Non-guaranteed hours » n\'est décodé par aucun motif — défaut produit', () => {
      /*
       * Mesuré : 667 offres (US 523, CA 139, AU 5). C'est un contrat à zéro heure, et la forme
       * `Zero hour` EST décodée (`TEMPORARY`) — donc le vocabulaire existe, seule cette
       * formulation manque. L'ancien lecteur ne pouvait pas voir ce défaut : le champ portait
       * une valeur, donc il comptait comme signal.
       */
      expect(Object.keys(lireValeur('Non-guaranteed hours'))).toHaveLength(0);
      expect(lireValeur('Zero hour').contrat).toBe('TEMPORARY');
    });

    it('« parttime_fixed_term » (Recruitee, NL) en nomme deux', () => {
      const lu = lireValeur('parttime_fixed_term');
      expect(lu.temps).toBe('PART_TIME');
      expect(lu.contrat).toBe('FIXED_TERM');
    });

    it('la saisonnalité est INDÉPENDANTE de la durée', () => {
      // Décision du 2026-09-08 : 2 359 offres Sephora sont CDD ET saisonnières — les deux sont vraies.
      const lu = lireValeur('PT Temp/Seasonal');
      expect(lu.saisonnier).toBe('true');
      expect(lu.contrat).toBe('FIXED_TERM');
    });
  });

  describe('la valeur canonique est comparée, pas seulement son remplissage', () => {
    it('distingue un canonique CONFORME d\'un canonique DIVERGENT', () => {
      /*
       * L'ancien lecteur ne regardait que « rempli / vide ». Une colonne remplie avec AUTRE CHOSE
       * que ce que dit la source passait pour saine — c'est le pire des deux défauts, puisqu'il
       * est invisible.
       */
      expect(verdictDimension(['CDD'], 'contrat', 'FIXED_TERM')).toBe('CANONISE_CONFORME');
      expect(verdictDimension(['CDD'], 'contrat', 'PERMANENT')).toBe('CANONISE_DIVERGENT');
    });

    it('signale un canonique rempli qu\'aucune valeur source ne nomme', () => {
      expect(verdictDimension(['Full Time'], 'contrat', 'PERMANENT')).toBe('CANONISE_SANS_SOURCE');
    });
  });

  describe('les valeurs refusées par le produit le restent', () => {
    it('« Contract » seul ne nomme aucun terme', () => {
      // Refus délibéré : en anglais d'entreprise, il désigne aussi bien un CDD qu'une prestation.
      expect(nommeLaDimension('Contract', 'contrat')).toBe(false);
    });

    it('« Internship » nomme un programme, jamais une durée', () => {
      const lu = lireValeur('Internship');
      expect(lu.programme).toBe('INTERNSHIP');
      expect(lu.contrat).toBeUndefined();
    });
  });

  describe('absence, non-reconnaissance et contradiction sont DISTINCTES', () => {
    it('une valeur présente mais non reconnue n\'est PAS « rien à canoniser »', () => {
      /*
       * LE DÉFAUT CORRIGÉ. `"Non-guaranteed hours"` (667 offres, valeur réelle de `contract` dans
       * la fixture Sephora `l2-lvmh-hit.json:13`) porte bien une information : aucun décodeur ne
       * sait la lire. La ranger en `RIEN_A_CANONISER` classait un angle mort du produit parmi les
       * cas conformes — et le rendait invisible.
       */
      expect(verdictDimension(['Non-guaranteed hours'], 'contrat', null)).toBe('VALEUR_NON_RECONNUE');

      // PRÉMISSE : la valeur est bien présente et non vide — c'est ce qui la distingue d'une absence.
      expect(Object.keys(lireValeur('Non-guaranteed hours'))).toHaveLength(0);
    });

    it('une absence réelle reste « rien à canoniser »', () => {
      expect(verdictDimension([], 'contrat', null)).toBe('RIEN_A_CANONISER');
      expect(verdictDimension([null, undefined, '', '   '], 'contrat', null)).toBe('RIEN_A_CANONISER');
    });

    it('deux valeurs contradictoires ne deviennent pas conformes', () => {
      /*
       * Le canonique tombe sur l'une des deux — mais rien ne prouve qu'il a ARBITRÉ. Présumer
       * juste un arbitrage non vérifié, c'est exactement l'erreur que cet audit a déjà commise.
       */
      expect(verdictDimension(['CDD', 'CDI'], 'contrat', 'FIXED_TERM')).toBe('SOURCES_CONTRADICTOIRES');
      expect(verdictDimension(['CDD', 'CDI'], 'contrat', 'TEMPORARY')).toBe('CANONISE_DIVERGENT');

      // PRÉMISSE : les deux valeurs nomment bien la même dimension, différemment.
      expect(lireValeur('CDD').contrat).toBe('FIXED_TERM');
      expect(lireValeur('CDI').contrat).toBe('PERMANENT');
    });

    it('la saisonnalité booléenne est comparée sans faux positif de casse', () => {
      /*
       * `isSeasonal` est un BOOLÉEN en base ; le lecteur rend la chaîne `'true'`. Comparer
       * `'true'` à `'TRUE'` rendait un CANONISE_DIVERGENT permanent — un faux positif intégral
       * sur toute la dimension.
       */
      expect(verdictDimension(['Seasonal'], 'saisonnier', true)).toBe('CANONISE_CONFORME');
      expect(verdictDimension(['Seasonal'], 'saisonnier', 'true')).toBe('CANONISE_CONFORME');
      expect(verdictDimension(['Seasonal'], 'saisonnier', 'TRUE')).toBe('CANONISE_CONFORME');
      expect(verdictDimension(['Seasonal'], 'saisonnier', null)).toBe('PERTE_CONFIRMEE');
    });
  });

  describe('les catégories de site ne nomment aucune dimension d\'emploi', () => {
    it('« Field », « Corporate », « Distribution Center » (JIBE tags2) ne nomment rien', () => {
      for (const v of ['Field', 'Corporate', 'Distribution Center'])
        expect(Object.keys(lireValeur(v)), v).toHaveLength(0);
    });
  });
});
