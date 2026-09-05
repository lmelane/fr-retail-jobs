import { describe, it, expect } from 'vitest';
import { cityFromLocation, displayCity, normalizeLocationString } from './location.js';

/**
 * Behaviour these tests pin down (BDD): the dedup key rides on `city`, so a
 * parasite city ("ARRONDISSEMENT", "REMOTE -", "RUE DE LA PAIX PARIS") splits one
 * commune into several and inflates the offer count. Each case below is a real
 * misparse observed in the current code, written as the CORRECT expectation.
 */

describe('normalizeLocationString — arrondissements collapse to the parent city', () => {
  it('reads the real city when the arrondissement leads (L-1)', () => {
    // "1er arrondissement" is the FIRST comma segment; the word "arrondissement"
    // must not survive as the city — Paris is the city.
    expect(normalizeLocationString('1er arrondissement, Paris').city).toBe('PARIS');
  });

  it('reads the real city when the arrondissement trails', () => {
    expect(normalizeLocationString('Paris 1er arrondissement').city).toBe('PARIS');
    expect(normalizeLocationString('Marseille 2e arrondissement').city).toBe('MARSEILLE');
    expect(normalizeLocationString('Lyon 3e arrondissement').city).toBe('LYON');
  });

  it('handles the "arr." abbreviation', () => {
    expect(normalizeLocationString('Paris 8e arr.').city).toBe('PARIS');
    expect(normalizeLocationString('2e arr., Paris').city).toBe('PARIS');
  });
});

describe('normalizeLocationString — remote / télétravail is not a place', () => {
  it('produces no parasite city for "Remote - France" (L-2)', () => {
    expect(normalizeLocationString('Remote - France').city).toBeUndefined();
  });

  it('produces no parasite city for other remote tokens', () => {
    expect(normalizeLocationString('Full remote').city).toBeUndefined();
    expect(normalizeLocationString('Télétravail').city).toBeUndefined();
    expect(normalizeLocationString('100% télétravail').city).toBeUndefined();
    expect(normalizeLocationString('Remote').city).toBeUndefined();
  });

  it('keeps the real city when remote is only a prefix on a location', () => {
    // "Remote - Paris" still names Paris: strip the remote token, keep the city.
    expect(normalizeLocationString('Remote - Paris').city).toBe('PARIS');
  });

  it('reads the city from a later segment when the first is only a working mode', () => {
    // "Télétravail partiel, Lyon": the lead segment carries no city, Lyon does.
    expect(normalizeLocationString('Télétravail partiel, Lyon').city).toBe('LYON');
  });
});

describe('normalizeLocationString — a street address is not a city', () => {
  it('extracts the department and never yields a "rue ..." city (L-3)', () => {
    const result = normalizeLocationString('12 rue de la Paix 75002 Paris');
    expect(result.department).toBe('75');
    // The old code returned "RUE DE LA PAIX PARIS"; a street name must never be
    // the city.
    expect(result.city).not.toMatch(/RUE/);
    expect(result.city).toBe('PARIS');
  });

  it('handles avenue / boulevard prefixes the same way', () => {
    const avenue = normalizeLocationString('35 avenue Montaigne 75008 Paris');
    expect(avenue.department).toBe('75');
    expect(avenue.city).toBe('PARIS');

    const boulevard = normalizeLocationString('5 boulevard Haussmann, 75009 Paris');
    expect(boulevard.department).toBe('75');
    expect(boulevard.city).toBe('PARIS');
  });

  it('reads the city from a later segment when the street run has no parent city', () => {
    // "Cours Mirabeau, 13100 Aix-en-Provence": the street segment yields no city,
    // so the town in the next segment must win — never "MIRABEAU".
    const result = normalizeLocationString('Cours Mirabeau, 13100 Aix-en-Provence');
    expect(result.department).toBe('13');
    expect(result.city).toBe('AIX-EN-PROVENCE');
  });
});

describe('normalizeLocationString — non-regression: cases that already worked', () => {
  it('collapses arrondissement suffixes to the parent city', () => {
    expect(normalizeLocationString('Paris 08').city).toBe('PARIS');
    expect(normalizeLocationString('Lyon 3e').city).toBe('LYON');
    expect(normalizeLocationString('PARIS CEDEX 08').city).toBe('PARIS');
  });

  it('captures the department from a full postcode', () => {
    const result = normalizeLocationString('75008 Paris');
    expect(result.city).toBe('PARIS');
    expect(result.department).toBe('75');
  });

  it('takes the city from a comma-joined region string', () => {
    expect(normalizeLocationString('Paris, Ile-de-France').city).toBe('PARIS');
  });

  it('captures the department from a "75 - Paris" prefix', () => {
    const result = normalizeLocationString('75 - Paris');
    expect(result.city).toBe('PARIS');
    expect(result.department).toBe('75');
  });

  it('keeps a plain city untouched and preserves the raw string', () => {
    const result = normalizeLocationString('Bordeaux');
    expect(result.city).toBe('BORDEAUX');
    expect(result.department).toBeUndefined();
    expect(result.raw).toBe('Bordeaux');
  });

  it('returns an empty result for blank input', () => {
    expect(normalizeLocationString('').city).toBeUndefined();
    expect(normalizeLocationString(null).city).toBeUndefined();
    expect(normalizeLocationString(undefined).raw).toBe('');
  });
});

describe('displayCity — la casse du filtre Ville', () => {
  /**
   * Mesuré en prod le 2026-09-05 : « Paris » (1 860 offres) et « PARIS » (326)
   * apparaissaient comme deux villes distinctes dans le filtre.
   */
  it('normalise une ville criée', () => {
    expect(displayCity('PARIS')).toBe('Paris');
    expect(displayCity('NEW YORK')).toBe('New York');
  });

  it('garde les particules en minuscules', () => {
    expect(displayCity('NEUILLY-SUR-SEINE')).toBe('Neuilly-sur-Seine');
    expect(displayCity('AIX-EN-PROVENCE')).toBe('Aix-en-Provence');
  });

  it('ne touche pas à une casse mixte déjà correcte', () => {
    expect(displayCity('Neuilly-sur-Seine')).toBe('Neuilly-sur-Seine');
    expect(displayCity("L'Haÿ-les-Roses")).toBe("L'Haÿ-les-Roses");
  });

  it('rend undefined sur du vide', () => {
    expect(displayCity('')).toBeUndefined();
    expect(displayCity(null)).toBeUndefined();
  });
});

describe('cityFromLocation — la ville que porte un libellé libre', () => {
  /**
   * Mesuré en prod le 2026-09-05 : 30 716 offres actives (61 %) sans aucune
   * ville, dont 24 681 portaient pourtant un `location` exploitable. Le champ
   * n'était jamais dérivé — il ne venait que des adaptateurs qui le
   * renseignent. Sans ville, l'offre est infiltrable et absente de la carte.
   */
  it.each([
    ['Paris', 'PARIS'],
    ['Beaverton, Oregon', 'BEAVERTON'],
    ['New York,US-NY,United States', 'NEW YORK'],
    ['London, England, gb', 'LONDON'],
  ])('%s -> %s', (raw, city) => {
    expect(cityFromLocation(raw)).toBe(city);
  });

  it('saute un segment de voirie au lieu d’abandonner le libellé', () => {
    // Rejeter tout perdrait New York ; le garder donnerait « World Trade Center ».
    expect(cityFromLocation('1 World Trade Center, New York, NY')).toBe('NEW YORK');
    expect(cityFromLocation('12 rue de la Paix, Paris')).toBe('PARIS');
  });

  it('un mode de travail n’est pas un lieu', () => {
    expect(cityFromLocation('Remote')).toBeUndefined();
    expect(cityFromLocation('Télétravail')).toBeUndefined();
  });

  it('rend undefined sur du vide', () => {
    expect(cityFromLocation('')).toBeUndefined();
    expect(cityFromLocation(null)).toBeUndefined();
  });
});
