import { describe, expect, it } from 'vitest';
import { normalizeCountry } from './country.js';

describe('normalizeCountry', () => {
  /**
   * Mesuré en prod le 2026-09-05 : 256 valeurs distinctes pour ~90 pays réels.
   * La France s'écrivait FR (6397), France (4321), fr (1177), FRANCE (73) —
   * quatre lignes dans le filtre, aucune ne montrant plus du tiers des offres.
   */
  it.each(['FR', 'fr', 'France', 'FRANCE', 'france', 'Frankrijk', 'Frankreich'])(
    '« %s » se ramène à FR',
    (raw) => expect(normalizeCountry(raw)).toBe('FR'),
  );

  it.each(['US', 'us', 'United States', 'United States of America', "États-Unis d'Amérique", 'USA'])(
    '« %s » se ramène à US',
    (raw) => expect(normalizeCountry(raw)).toBe('US'),
  );

  it.each(['DE', 'Allemagne', 'Deutschland', 'Germany', 'Duitsland'])(
    '« %s » se ramène à DE',
    (raw) => expect(normalizeCountry(raw)).toBe('DE'),
  );

  it('rattache les libellés Chine / régions administratives', () => {
    expect(normalizeCountry('Chinese Mainland')).toBe('CN');
    expect(normalizeCountry('Mainland China')).toBe('CN');
    expect(normalizeCountry('Hong Kong S.A.R.')).toBe('HK');
    expect(normalizeCountry('Macao, RAS Chine')).toBe('MO');
  });

  it("rattache l'outre-mer français à FR, ce qu'attend le candidat", () => {
    expect(normalizeCountry('French Overseas Departments and Territories')).toBe('FR');
  });

  it('tolère les accents manquants', () => {
    expect(normalizeCountry('Bresil')).toBe('BR');
    expect(normalizeCountry('Coree, Republique de')).toBe('KR');
  });

  it('préfère undefined à un pays douteux', () => {
    expect(normalizeCountry('undefined')).toBeUndefined();
    expect(normalizeCountry('')).toBeUndefined();
    expect(normalizeCountry(null)).toBeUndefined();
    expect(normalizeCountry('XX')).toBeUndefined();
    expect(normalizeCountry('Remote')).toBeUndefined();
  });
});
