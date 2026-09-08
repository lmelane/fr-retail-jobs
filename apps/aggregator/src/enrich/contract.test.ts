import { describe, expect, it } from 'vitest';
import { enrichContract, CONTRACT_NORMALIZER_VERSION } from './contract.js';
import { CONFIDENCE, isWritable, outranks } from './types.js';

/**
 * Le vertical CONTRAT — la référence architecturale du moteur.
 *
 * Chaque test nomme la règle qu'il protège. Les cas viennent du payload RÉEL
 * mesuré en base le 2026-09-08 (Mango, Pandora, Ulta, Tapestry), pas d'exemples
 * inventés : c'est ce qui prouve que le gain annoncé est atteignable sans
 * re-scraper.
 */
describe('enrichContract', () => {
  describe('RAW_FIELD — la source le dit explicitement', () => {
    it('lit le champ dédié et le marque CERTAIN', () => {
      const r = enrichContract({ contract: 'CDI' });
      expect(r?.normalized).toBe('CDI');
      expect(r?.method).toBe('RAW_FIELD');
      expect(r?.confidence).toBe(CONFIDENCE.CERTAIN);
      expect(r?.normalizerVersion).toBe(CONTRACT_NORMALIZER_VERSION);
    });

    it('mappe les libellés anglophones vers le vocabulaire canonique', () => {
      expect(enrichContract({ contract: 'Permanent' })?.normalized).toBe('CDI');
      expect(enrichContract({ contract: 'Regular' })?.normalized).toBe('CDI');
      expect(enrichContract({ contract: 'Fixed-term' })?.normalized).toBe('CDD');
      expect(enrichContract({ contract: 'Temporary' })?.normalized).toBe('CDD');
      expect(enrichContract({ contract: 'Internship' })?.normalized).toBe('STAGE');
      expect(enrichContract({ contract: 'Apprenticeship' })?.normalized).toBe('ALTERNANCE');
    });

    /**
     * RÈGLE 6 — `raw` porte la valeur ayant servi à la décision, jamais le
     * payload entier, et `sourcePath` dit où elle a été lue.
     */
    it('conserve la valeur brute et son chemin, pas une copie du payload', () => {
      const r = enrichContract({ raw: { bulletFields: ['BARCELONA', 'Barcelona', 'Permanent'] } });
      expect(r?.raw).toBe('Permanent');
      expect(r?.sourcePath).toBe('bulletFields[2]');
      expect(JSON.stringify(r)).not.toContain('BARCELONA');
    });
  });

  /**
   * LE CAS MANGO, mesuré en base : `bulletFields: [..., "Permanent"]`. La valeur
   * était là, déjà mappée par le normaliseur, et n'était simplement jamais lue.
   */
  describe('SOURCE_METADATA — la valeur est dans le payload, hors champ dédié', () => {
    it('trouve le contrat dans bulletFields (Mango, Tapestry — Workday)', () => {
      const r = enrichContract({ raw: { bulletFields: ['BARCELONA', 'Barcelona', 'Permanent'] } });
      expect(r?.normalized).toBe('CDI');
      expect(r?.method).toBe('SOURCE_METADATA');
      expect(r?.confidence).toBe(CONFIDENCE.CERTAIN);
    });

    it('trouve le contrat dans les tags numérotés (Foot Locker, Ulta — Phenom/Jibe)', () => {
      const r = enrichContract({ raw: { tags1: ['Part Time'], tags2: ['Regular'] } });
      expect(r?.normalized).toBe('CDI');
      expect(r?.method).toBe('SOURCE_METADATA');
    });

    /**
     * « Part Time » est un TEMPS DE TRAVAIL, pas un contrat. Le confondre
     * remplirait la colonne contrat avec une valeur fausse — exactement ce que
     * la règle 8 interdit.
     */
    it('ne prend JAMAIS un temps de travail pour un contrat', () => {
      expect(enrichContract({ raw: { tags1: ['Part Time'] } })).toBeUndefined();
      expect(enrichContract({ contract: 'Full-time' })).toBeUndefined();
    });

    it('ignore les métadonnées qui ne nomment aucun terme d’emploi', () => {
      expect(
        enrichContract({ raw: { tags4: ['ST2075 Napverville IL'], category: [' Retail Associates'] } }),
      ).toBeUndefined();
    });
  });

  describe('TITLE — l’intitulé le dit', () => {
    it('lit le contrat dans le titre quand le champ est vide', () => {
      const r = enrichContract({ title: 'CDI 18H - Vendeur Prêt-à-porter' });
      expect(r?.normalized).toBe('CDI');
      expect(r?.method).toBe('TITLE');
      expect(r?.confidence).toBe(CONFIDENCE.VERY_LIKELY);
    });

    /** Le cas Pandora, mesuré : « Sales Associate (m/f/d) - Full-time ». */
    it('ne déduit pas un contrat d’un temps de travail dans le titre', () => {
      expect(enrichContract({ title: 'Sales Associate (m/f/d) - Full-time' })).toBeUndefined();
    });
  });

  describe('DESCRIPTION — le texte le dit', () => {
    it('lit un token non ambigu où qu’il soit dans le texte', () => {
      const r = enrichContract({ description: 'Nous proposons un contrat en CDI de 35h. '.repeat(30) });
      expect(r?.normalized).toBe('CDI');
      expect(r?.method).toBe('DESCRIPTION');
      expect(r?.confidence).toBe(CONFIDENCE.VERY_LIKELY);
    });

    /**
     * « après un stage réussi » ne fait pas de l'offre un stage : les mots
     * ambigus ne comptent qu'en tête, là où une annonce déclare sa nature.
     */
    it('ne conclut pas STAGE sur une mention incidente en fin de texte', () => {
      const text = `${'Vous rejoignez une équipe dynamique. '.repeat(40)} Possible après un stage réussi.`;
      expect(enrichContract({ description: text })?.normalized).not.toBe('STAGE');
    });

    it('respecte une négation explicite', () => {
      expect(enrichContract({ description: "Ce poste n'est pas un CDI." })?.normalized).not.toBe('CDI');
    });
  });

  /**
   * RÈGLE 4 — la priorité des preuves est déterministe. Une heuristique ne doit
   * jamais écraser une donnée explicite fiable.
   */
  describe('priorité des preuves', () => {
    it('le champ dédié bat le titre et la description', () => {
      const r = enrichContract({
        contract: 'Permanent',
        title: 'Stage - Assistant commercial',
        description: 'Un CDD de 6 mois.',
      });
      expect(r?.normalized).toBe('CDI');
      expect(r?.method).toBe('RAW_FIELD');
    });

    it('les métadonnées de la source battent le titre', () => {
      const r = enrichContract({
        raw: { bulletFields: ['Permanent'] },
        title: 'Stage - Assistant commercial',
      });
      expect(r?.method).toBe('SOURCE_METADATA');
      expect(r?.normalized).toBe('CDI');
    });

    it('le titre bat la description', () => {
      const r = enrichContract({ title: 'CDI - Vendeur', description: 'Un stage est possible.' });
      expect(r?.method).toBe('TITLE');
    });

    it('l’ordre des méthodes est celui de la règle 4', () => {
      expect(outranks('RAW_FIELD', 'SOURCE_METADATA')).toBe(true);
      expect(outranks('SOURCE_METADATA', 'TITLE')).toBe(true);
      expect(outranks('TITLE', 'DESCRIPTION')).toBe(true);
      expect(outranks('DESCRIPTION', 'CROSS_FIELD')).toBe(true);
      // MANUAL gagne contre tout (règle 5).
      expect(outranks('MANUAL', 'RAW_FIELD')).toBe(true);
      expect(outranks('RAW_FIELD', 'MANUAL')).toBe(false);
    });
  });

  /** RÈGLE 8 — mieux vaut null qu'une mauvaise donnée. */
  describe('seuil d’écriture', () => {
    it('ne rend rien quand aucune preuve n’existe', () => {
      expect(enrichContract({ title: 'Vendeur', description: 'Une belle Maison.' })).toBeUndefined();
    });

    it('toute trace produite est au-dessus du seuil d’écriture', () => {
      const r = enrichContract({ contract: 'CDI' });
      expect(r && isWritable(r)).toBe(true);
    });
  });

  /** RÈGLE 2 — déterminisme : mêmes entrées, même sortie. */
  it('est déterministe', () => {
    const input = { raw: { bulletFields: ['Permanent'] }, title: 'Vendeur' };
    expect(enrichContract(input)).toEqual(enrichContract(input));
  });
});
