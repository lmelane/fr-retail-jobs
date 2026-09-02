import { describe, it, expect } from 'vitest';
import { normalizeLocationString } from './location.js';

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
