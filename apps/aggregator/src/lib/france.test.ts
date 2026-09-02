import { describe, it, expect } from 'vitest';
import { isFranceJob } from './france.js';

/**
 * Behaviour (BDD): only real French locations land on the France board and the
 * map. A substring match ("Venice" contains "nice") put foreign offers on the
 * French map — each case below is written as the correct expectation.
 */

describe('isFranceJob — country wins when explicit', () => {
  it('is France when the country is FR/FRA/FRANCE', () => {
    expect(isFranceJob('FR', 'Paris')).toBe(true);
    expect(isFranceJob('FRA', undefined)).toBe(true);
    expect(isFranceJob('France', 'anywhere')).toBe(true);
  });

  it('is not France when the country is another country', () => {
    expect(isFranceJob('US', 'Paris')).toBe(false);
    expect(isFranceJob('GB', 'London')).toBe(false);
    expect(isFranceJob('CH', 'Genève')).toBe(false);
  });
});

describe('isFranceJob — location, when no country is given', () => {
  it('recognises real French cities', () => {
    expect(isFranceJob(undefined, 'Paris')).toBe(true);
    expect(isFranceJob(undefined, 'Lyon 3e')).toBe(true);
    expect(isFranceJob(undefined, 'Marseille, PACA')).toBe(true);
    expect(isFranceJob(undefined, '75008 Paris')).toBe(true);
    expect(isFranceJob(undefined, 'Nice')).toBe(true);
    expect(isFranceJob(undefined, 'La Défense')).toBe(true);
  });

  it('does not treat a foreign city as French because it contains a French city as a substring', () => {
    expect(isFranceJob(undefined, 'Venice')).toBe(false); // contains NICE
    expect(isFranceJob(undefined, 'Varennes, Quebec')).toBe(false); // contains RENNES
    expect(isFranceJob(undefined, 'Caen, Belgium')).toBe(false); // exact CAEN but Belgium — country-less, ambiguous, but "Belgium" present
    expect(isFranceJob(undefined, 'Lilleshall, UK')).toBe(false); // contains LILLE
    expect(isFranceJob(undefined, 'Niceville, Florida')).toBe(false); // contains NICE
  });

  it('is not France for a clearly foreign location', () => {
    expect(isFranceJob(undefined, 'London')).toBe(false);
    expect(isFranceJob(undefined, 'Milano, Italia')).toBe(false);
    expect(isFranceJob(undefined, 'New York')).toBe(false);
  });
});
