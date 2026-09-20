import { describe, expect, it } from 'vitest';
import {
  estSignalValide, lireChemin, etatSignal, verdictOffre,
} from '../lot0-lecteurs.js';

/**
 * LES TÉMOINS DES LECTEURS D'AUDIT.
 *
 * Chaque cas ci-dessous reproduit un défaut RÉEL de la première consolidation, avec la valeur
 * exacte mesurée en production. Un lecteur d'audit sans témoin produit des chiffres faux qui
 * deviennent des tickets de correction : c'est ce qui s'est passé, et ces témoins existent pour
 * que ça ne se reproduise pas silencieusement.
 */
describe('lecteurs de l\'audit LOT 0', () => {
  describe('la validité dépend du contrat du champ, jamais du type', () => {
    it('refuse LAT_LNG comme signal de télétravail', () => {
      /*
       * LE DÉFAUT EXACT DE LA PREMIÈRE PASSE. `location_type = "LAT_LNG"` chez JIBE décrit
       * l'encodage de la position, pas un mode de travail. Mesuré sur 10 024 des 10 035 offres
       * JIBE : le compter comme signal inventait un télétravail sur 54 % du marché américain.
       */
      expect(estSignalValide('LAT_LNG', 'teletravail')).toBe(false);
      expect(estSignalValide('lat_lng', 'teletravail')).toBe(false);

      // PRÉMISSE : une chaîne non vide passait le test générique — c'est bien ce cas qu'on couvre.
      expect('LAT_LNG'.trim().length).toBeGreaterThan(0);

      // Et les vraies valeurs de télétravail passent.
      for (const v of ['On-site', 'Hybride', 'Hybrid', 'Sur Site', '现场办公', 'Remote'])
        expect(estSignalValide(v, 'teletravail'), v).toBe(true);
    });

    it('traite « 0 » comme une absence sur le salaire et une valeur ailleurs', () => {
      // `salary_min_value: 0` chez JIBE : mesuré à 0 sur 10 035 offres sur 10 035.
      expect(estSignalValide(0, 'salaire')).toBe(false);
      expect(estSignalValide('0', 'salaire')).toBe(false);
      expect(estSignalValide(45_000, 'salaire')).toBe(true);
      // Le même zéro sur une dimension sans contrat d'absence reste une valeur.
      expect(estSignalValide(0, 'experience')).toBe(true);
    });

    it('accepte `false` SEULEMENT là où il signifie quelque chose', () => {
      /*
       * `remote: false` dit « pas de télétravail » — une information. Le supprimer
       * universellement, comme le faisait la règle générique, effaçait cette réponse.
       */
      expect(estSignalValide(false, 'teletravail', true)).toBe(true);
      expect(estSignalValide(false, 'teletravail', false)).toBe(false);
      expect(estSignalValide(true, 'teletravail', false)).toBe(true);
    });

    it('refuse les fourre-tout par dimension', () => {
      // `{"label": "Other"}` sur 215 offres US, `category: "job"` sur 579 offres CN — mesurés.
      expect(estSignalValide('Other', 'departement')).toBe(false);
      expect(estSignalValide('job', 'departement')).toBe(false);
      expect(estSignalValide('Retail Associates', 'departement')).toBe(true);
      // Mais « Other » sur une dimension qui n'en fait pas un fourre-tout reste une valeur.
      expect(estSignalValide('Other', 'temps')).toBe(true);
    });

    it('refuse un objet dont toutes les valeurs sont nulles', () => {
      // Mesuré sur 1 277 offres françaises : un objet salaire complet, et vide de montant.
      expect(estSignalValide({ max: null, min: null, period: null, currency: null }, 'salaire')).toBe(false);
      expect(estSignalValide({ max: 26, min: 18, currency: 'USD' }, 'salaire')).toBe(true);
      expect(estSignalValide([], 'departement')).toBe(false);
      expect(estSignalValide({}, 'departement')).toBe(false);
    });
  });

  describe('les chemins traversent les objets ET les tableaux', () => {
    it('lit un tableau de chaînes', () => {
      // `tags1: ["Part Time"]` chez JIBE — 99,97 % des offres. Un lecteur limité à la racine
      // scalaire déclarait ce champ « absent » alors qu'il porte le temps de travail.
      expect(lireChemin({ tags1: ['Part Time'] }, 'tags1')).toEqual(['Part Time']);
    });

    it('lit un champ niché dans un tableau d\'objets', () => {
      // `categories: [{name: "Salon Professionals"}]` chez JIBE — 100 %.
      expect(lireChemin({ categories: [{ name: 'Salon Professionals' }, { name: 'Retail' }] }, 'categories.name'))
        .toEqual(['Salon Professionals', 'Retail']);
    });

    it('lit un champ niché dans un objet', () => {
      // `salaryRange.currency` chez Lever.
      expect(lireChemin({ salaryRange: { currency: 'USD', interval: 'per-year' } }, 'salaryRange.interval'))
        .toEqual(['per-year']);
    });

    it('rend une liste vide quand le chemin n\'existe pas', () => {
      expect(lireChemin({ a: 1 }, 'b.c')).toEqual([]);
      expect(lireChemin(null, 'a')).toEqual([]);
    });
  });

  describe('quatre états distincts, dont « non mesuré »', () => {
    it('distingue « je n\'ai pas cherché » de « il n\'y a rien »', () => {
      /*
       * LE DÉFAUT LE PLUS COÛTEUX. Une liste de chemins vide rendait « absent », donc un champ
       * qu'on n'avait pas pensé à chercher devenait un constat d'absence — et c'est ainsi qu'un
       * signal réel (les tags JIBE) a été déclaré inexistant.
       */
      expect(etatSignal({ tags1: ['Full Time'] }, [], 'temps')).toBe('NON_MESURE');
      expect(etatSignal({ autre: 1 }, ['tags1'], 'temps')).toBe('SIGNAL_ABSENT');
    });

    it('distingue une sentinelle d\'une absence', () => {
      expect(etatSignal({ location_type: 'LAT_LNG' }, ['location_type'], 'teletravail')).toBe('SIGNAL_SENTINELLE');
      expect(etatSignal({}, ['location_type'], 'teletravail')).toBe('SIGNAL_ABSENT');
      expect(etatSignal({ workingMode: 'Hybride' }, ['workingMode'], 'teletravail')).toBe('SIGNAL_VALIDE');
    });

    it('retient le premier chemin porteur, sans qu\'une sentinelle masque un champ valide', () => {
      /*
       * Un `coalesce` générique retenait la PREMIÈRE clé non nulle : `location_type: "LAT_LNG"`
       * masquait alors `workingMode: "Hybride"` situé plus loin. On parcourt donc tous les
       * chemins et on retient la validité, pas la position.
       */
      expect(etatSignal({ location_type: 'LAT_LNG', workingMode: 'Hybride' },
        ['location_type', 'workingMode'], 'teletravail')).toBe('SIGNAL_VALIDE');
    });
  });

  describe('la perte se compte offre par offre, jamais par soustraction', () => {
    it('sépare la perte réelle du canonique sans signal', () => {
      /*
       * `signal − canonisé` mélangeait deux anomalies opposées qui s'annulaient : une offre à
       * signal perdu (+1) et une offre canonisée sans signal mesuré (−1) donnaient zéro. Chaque
       * offre porte donc un verdict propre.
       */
      expect(verdictOffre('SIGNAL_VALIDE', false)).toBe('PERTE_CONFIRMEE');
      expect(verdictOffre('SIGNAL_VALIDE', true)).toBe('CANONISE');
      expect(verdictOffre('SIGNAL_ABSENT', true)).toBe('CANONISE_SANS_SIGNAL');
      expect(verdictOffre('SIGNAL_SENTINELLE', false)).toBe('RIEN_A_CANONISER');
      expect(verdictOffre('NON_MESURE', true)).toBe('NON_MESURE');
      expect(verdictOffre('NON_MESURE', false)).toBe('NON_MESURE');
    });

    it('ne compte JAMAIS une sentinelle canonisée comme une perte', () => {
      // JIBE : `location_type` sentinelle + `workplaceType` vide → conforme, pas un défaut.
      expect(verdictOffre('SIGNAL_SENTINELLE', false)).not.toBe('PERTE_CONFIRMEE');
    });

    it('le cas LVMH, de bout en bout', () => {
      // Mesuré : 3 977 offres sur 6 141 portent un `workingMode` exploitable, et
      // `Job.workplaceType` vaut NULL sur les 6 141. Ces 3 977 sont des pertes confirmées.
      const etat = etatSignal({ workingMode: 'On-site' }, ['workingMode', 'workModeFilter'], 'teletravail');
      expect(etat).toBe('SIGNAL_VALIDE');
      expect(verdictOffre(etat, false)).toBe('PERTE_CONFIRMEE');

      // Et les 2 164 restantes, sans valeur exploitable, ne sont PAS des pertes.
      const vide = etatSignal({ workingMode: '' }, ['workingMode', 'workModeFilter'], 'teletravail');
      expect(verdictOffre(vide, false)).toBe('RIEN_A_CANONISER');
    });
  });
});
