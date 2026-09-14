import { describe, expect, it } from 'vitest';
import { resolveLieu } from '../lieu';
import { parseFilters } from '../jobs';

/**
 * F1 / D-418 §3 — le champ « lieu » se résout côté moteur. Ces témoins
 * passent au rouge si un code inconnu devient un pays, si un nom de pays
 * retombe en ville, ou si `pays`/`ville` explicites perdent la main.
 */
describe('resolveLieu', () => {
  it('vide → null', () => {
    expect(resolveLieu('')).toBeNull();
    expect(resolveLieu('   ')).toBeNull();
    expect(resolveLieu(undefined)).toBeNull();
  });

  it('un code ISO-2 CONNU est un pays, un digramme inconnu reste une ville', () => {
    expect(resolveLieu('fr')).toEqual({ country: 'FR' });
    expect(resolveLieu('US')).toEqual({ country: 'US' });
    // Prémisse : « xq » n'est pas un code attribué.
    expect(resolveLieu('xq')).toEqual({ cityLoose: 'xq' });
  });

  it('un nom de pays, en français ou en anglais, est un pays', () => {
    expect(resolveLieu('France')).toEqual({ country: 'FR' });
    expect(resolveLieu('royaume-uni')).toEqual({ country: 'GB' });
    expect(resolveLieu('Germany')).toEqual({ country: 'DE' });
    expect(resolveLieu('États-Unis')).toEqual({ country: 'US' });
  });

  it('tout le reste est une ville en correspondance large, espaces normalisés', () => {
    expect(resolveLieu('Paris')).toEqual({ cityLoose: 'Paris' });
    expect(resolveLieu('  Pari ')).toEqual({ cityLoose: 'Pari' });
    expect(resolveLieu('Aix  en   Provence')).toEqual({ cityLoose: 'Aix en Provence' });
  });
});

describe('parseFilters avec lieu', () => {
  it('lieu=France → country, sans cityLoose', () => {
    const f = parseFilters({ lieu: 'France' });
    expect(f.country).toBe('FR');
    expect(f.cityLoose).toBeUndefined();
  });

  it('lieu=Paris → cityLoose, sans country', () => {
    const f = parseFilters({ lieu: 'Paris' });
    expect(f.cityLoose).toBe('Paris');
    expect(f.country).toBeUndefined();
    expect(f.city).toBeUndefined();
  });

  it('pays et ville explicites gardent la main sur lieu', () => {
    expect(parseFilters({ lieu: 'France', pays: 'IT' }).country).toBe('IT');
    const f = parseFilters({ lieu: 'Pari', ville: 'Paris' });
    expect(f.city).toBe('Paris');
    expect(f.cityLoose).toBeUndefined();
  });

  it('sans lieu, rien ne change', () => {
    const f = parseFilters({ q: 'vendeuse' });
    expect(f.cityLoose).toBeUndefined();
    expect(f.country).toBeUndefined();
  });
});
