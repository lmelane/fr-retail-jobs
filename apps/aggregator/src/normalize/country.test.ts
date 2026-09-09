import { describe, expect, it } from 'vitest';
import { countryFromLocation, normalizeCountry } from './country.js';

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

  /**
   * MESURÉ EN PROD (2026-09-08) : 20 offres stockées sous le pays « UK ».
   * `UK` n'est PAS un code ISO 3166-1 — c'est un code « exceptionnellement
   * réservé » qu'Intl expose, et la liste ISO l'acceptait tel quel, court-
   * circuitant la table de libellés qui le mappe pourtant sur `GB`.
   * Deux codes pour un seul pays = un filtre Pays qui ment.
   */
  it('« UK » est le Royaume-Uni, donc GB', () => {
    expect(normalizeCountry('UK')).toBe('GB');
    expect(normalizeCountry('uk')).toBe('GB');
    expect(normalizeCountry('GB')).toBe('GB');
  });

  /**
   * `NH` = Nouvelles-Hébrides, pays DISPARU en 1980 (devenu Vanuatu). Intl le
   * connaît encore ; aucune offre de 2026 n'y est publiée. Mesuré : 3 offres
   * à Salem et Lebanon, dans le New Hampshire américain.
   */
  it('refuse les codes de pays disparus', () => {
    expect(normalizeCountry('NH')).toBeUndefined();
    expect(normalizeCountry('SU')).toBeUndefined();
    expect(normalizeCountry('YU')).toBeUndefined();
    expect(normalizeCountry('DD')).toBeUndefined();
    expect(normalizeCountry('AN')).toBeUndefined();
  });

  it('préfère undefined à un pays douteux', () => {
    expect(normalizeCountry('undefined')).toBeUndefined();
    expect(normalizeCountry('')).toBeUndefined();
    expect(normalizeCountry(null)).toBeUndefined();
    expect(normalizeCountry('XX')).toBeUndefined();
    expect(normalizeCountry('Remote')).toBeUndefined();
  });
});

describe('countryFromLocation', () => {
  it('lit le pays au bout du lieu, dans toute langue', () => {
    expect(countryFromLocation('Columbus,US-OH,United States')).toBe('US');
    expect(countryFromLocation('London, England, gb')).toBe('GB');
    expect(countryFromLocation('Paris, Île-de-France, France')).toBe('FR');
    expect(countryFromLocation('Genève (Suisse)')).toBe('CH');
  });

  it('accepte un code seul et un préfixe « US-OH »', () => {
    expect(countryFromLocation('CH')).toBe('CH');
    expect(countryFromLocation('Columbus, US-OH')).toBe('US');
  });

  it('ne devine jamais', () => {
    expect(countryFromLocation('Remote')).toBeUndefined();
    expect(countryFromLocation('Boutique Champs-Élysées')).toBeUndefined();
    expect(countryFromLocation('')).toBeUndefined();
  });

  it('la liste ISO est complète (Lettonie, Serbie, Kosovo), sans les régions Intl', () => {
    expect(normalizeCountry('LV')).toBe('LV');
    expect(normalizeCountry('RS')).toBe('RS');
    expect(normalizeCountry('XK')).toBe('XK');
    expect(normalizeCountry('EU')).toBeUndefined();
  });
});

describe('normalizeCountry — formes officielles longues (lot 2)', () => {
  it('lit « X, Republic of », « X, The » et les libellés Intl', () => {
    expect(normalizeCountry('Korea, Republic of')).toBe('KR');
    expect(normalizeCountry('Netherlands, The')).toBe('NL');
    expect(normalizeCountry('Russian Federation')).toBe('RU');
    expect(normalizeCountry("Lao People's Democratic Republic")).toBe('LA');
    expect(normalizeCountry('Tanzania, United Republic of')).toBe('TZ');
    expect(normalizeCountry('Corée du Sud')).toBe('KR');
  });
});


describe('versioned worldwide country labels', () => {
  it.each(['Frankrig', 'Frankrike', 'Fransa', 'フランス', 'Франция'])('resolves the exact CLDR name %s without an adapter-specific alias', raw => {
    expect(normalizeCountry(raw)).toBe('FR');
  });
  it('keeps an ambiguous localized label unresolved and never treats a city as a country', () => {
    expect(normalizeCountry('Kongo')).toBeUndefined();
    expect(normalizeCountry('Paris')).toBeUndefined();
    expect(normalizeCountry('San Francisco')).toBeUndefined();
  });
});
