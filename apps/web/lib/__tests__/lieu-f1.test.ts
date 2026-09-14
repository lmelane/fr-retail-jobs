import { describe, expect, it } from 'vitest';
import { resolveLieu } from '../lieu';
import { parseFilters } from '../jobs';

/**
 * F1 / D-418 §3 — le champ « lieu » se résout côté moteur. Ces témoins
 * passent au rouge si un code inconnu devient un pays, si un nom de pays
 * retombe en ville, si le télétravail n'est plus reconnu, ou si `pays`/`ville`
 * explicites perdent la main.
 */
describe('resolveLieu', () => {
  it('vide → null', () => {
    expect(resolveLieu('')).toBeNull();
    expect(resolveLieu('   ')).toBeNull();
    expect(resolveLieu(undefined)).toBeNull();
  });

  it('un code ISO-2 CONNU ou un alias est un pays, un digramme inconnu reste une ville', () => {
    expect(resolveLieu('fr')).toEqual({ type: 'pays', country: 'FR', libelle: 'France' });
    expect(resolveLieu('US')).toEqual({ type: 'pays', country: 'US', libelle: 'États-Unis' });
    expect(resolveLieu('uk')).toEqual({ type: 'pays', country: 'GB', libelle: 'Royaume-Uni' });
    // Prémisse : « xq » n'est pas un code attribué.
    expect(resolveLieu('xq')).toEqual({ type: 'ville', cityLoose: 'xq', libelle: 'Xq' });
  });

  it('un nom de pays, en français ou en anglais, est un pays avec son libellé français', () => {
    expect(resolveLieu('France')).toEqual({ type: 'pays', country: 'FR', libelle: 'France' });
    expect(resolveLieu('royaume-uni')).toEqual({ type: 'pays', country: 'GB', libelle: 'Royaume-Uni' });
    expect(resolveLieu('Germany')).toEqual({ type: 'pays', country: 'DE', libelle: 'Allemagne' });
    expect(resolveLieu('États-Unis')).toEqual({ type: 'pays', country: 'US', libelle: 'États-Unis' });
  });

  it('télétravail, remote, à distance → télétravail', () => {
    for (const v of ['télétravail', 'Teletravail', 'remote', 'à distance', 'home office']) {
      expect(resolveLieu(v)).toEqual({ type: 'teletravail', remote: true, libelle: 'Télétravail' });
    }
  });

  it('tout le reste est une ville en correspondance large, espaces normalisés, libellé capitalisé', () => {
    expect(resolveLieu('Paris')).toEqual({ type: 'ville', cityLoose: 'Paris', libelle: 'Paris' });
    expect(resolveLieu('  pari ')).toEqual({ type: 'ville', cityLoose: 'pari', libelle: 'Pari' });
    expect(resolveLieu('aix  en   provence')).toEqual({ type: 'ville', cityLoose: 'aix en provence', libelle: 'Aix En Provence' });
  });
});

describe('parseFilters avec lieu', () => {
  it('lieu=France → country, sans cityLoose, lieu résolu exposé', () => {
    const f = parseFilters({ lieu: 'France' });
    expect(f.country).toBe('FR');
    expect(f.cityLoose).toBeUndefined();
    expect(f.lieuResolu).toEqual({ type: 'pays', libelle: 'France' });
  });

  it('lieu=Paris → cityLoose, sans country', () => {
    const f = parseFilters({ lieu: 'Paris' });
    expect(f.cityLoose).toBe('Paris');
    expect(f.country).toBeUndefined();
    expect(f.city).toBeUndefined();
    expect(f.remote).toBeUndefined();
  });

  it('lieu=télétravail → remote, rien d’autre', () => {
    const f = parseFilters({ lieu: 'télétravail' });
    expect(f.remote).toBe(true);
    expect(f.country).toBeUndefined();
    expect(f.cityLoose).toBeUndefined();
    expect(f.lieuResolu).toEqual({ type: 'teletravail', libelle: 'Télétravail' });
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
    expect(f.lieuResolu).toBeUndefined();
  });
});
