import { describe, it, expect } from 'vitest';
import { countryIntegrityOf, isProvingVerdict, COUNTRY_INTEGRITY_PROVING } from './countryIntegrity.js';
import { resolveGeography } from './geography.js';

/**
 * Le verdict se dérive de la VRAIE résolution géographique, jamais d'un objet fabriqué à la main : c'est la
 * consigne du propriétaire, et c'est aussi ce qui protège du décor de test complaisant. Chaque cas passe donc
 * par `resolveGeography`.
 */
const verdictFor = (input: Parameters<typeof resolveGeography>[0]) =>
  countryIntegrityOf(resolveGeography(input), input.rawCountry);

describe('countryIntegrityOf — la liste positive est fermée', () => {
  it('les trois seuls verdicts positifs sont ceux du contrat partagé avec le web', () => {
    expect([...COUNTRY_INTEGRITY_PROVING]).toEqual(['RAW_COUNTRY_CODE', 'RAW_COUNTRY', 'VERIFIED']);
  });

  it.each(['AMBIGUOUS', 'UNVERIFIED', 'POSTAL_FORMAT_COMPATIBLE', 'SOMETHING_NEW', '', null, undefined])(
    'un verdict hors liste (%s) ne prouve rien',
    (v) => expect(isProvingVerdict(v as string)).toBe(false),
  );
});

describe('countryIntegrityOf — un champ pays DÉDIÉ prouve', () => {
  it('un code pays déclaré dans son propre champ prouve, même ambigu : la source l\'a voulu', () => {
    // `country_code: "CA"` n'est pas un suffixe de libellé : c'est une déclaration délibérée.
    expect(verdictFor({ rawCountryCode: 'CA', location: 'Toronto, CA' })).toBe('RAW_COUNTRY_CODE');
  });

  it('un NOM de pays déclaré prouve', () => {
    expect(verdictFor({ rawCountry: 'Canada', location: 'Toronto' })).toBe('RAW_COUNTRY');
    expect(verdictFor({ rawCountry: 'Germany', location: 'Hamburg' })).toBe('RAW_COUNTRY');
  });

  it('un code NON ambigu dans le champ nom prouve : FR, IT, GB ne sont subdivision de rien', () => {
    expect(verdictFor({ rawCountry: 'FR', location: 'Paris' })).toBe('RAW_COUNTRY');
  });
});

/**
 * LE CŒUR DE H-GEO-01, REPORTÉ SUR LA CHAÎNE D'INGESTION.
 *
 * `resolveGeography` classe `country: "CA"` en `RAW_COUNTRY`, exactement comme `country: "Canada"`. Sans cette
 * garde, un code ambigu arrivé par le champ NOM obtiendrait le privilège de balisage que la règle web refuse au
 * même code arrivé par le suffixe — la validation circulaire, réintroduite par une autre porte.
 */
describe('countryIntegrityOf — un code AMBIGU nu ne prouve jamais', () => {
  it.each(['CA', 'IN', 'DE', 'AR', 'MA', 'ID', 'NL', 'SK', 'CO'])(
    'country="%s" (code ambigu nu) ne produit aucun verdict',
    (code) => expect(verdictFor({ rawCountry: code, location: `Ville, ${code}` })).toBeNull(),
  );

  it('le pays est bien RÉSOLU, c\'est seulement la PREUVE qui est refusée', () => {
    const geo = resolveGeography({ rawCountry: 'CA', location: 'Toronto, CA' });
    expect(geo.countryCode).toBe('CA');          // la valeur reste, rien n'est effacé
    expect(countryIntegrityOf(geo, 'CA')).toBeNull(); // mais elle n'est pas prouvée
  });

  it('le même pays écrit en toutes lettres, lui, prouve — c\'est la seule différence', () => {
    expect(verdictFor({ rawCountry: 'Canada', location: 'Toronto, CA' })).toBe('RAW_COUNTRY');
  });
});

describe('countryIntegrityOf — ce qui est LU dans le libellé ne prouve pas', () => {
  it.each([
    ['Scottsdale, AZ', 'un suffixe de subdivision'],
    ['Toronto, CA', 'un suffixe ambigu'],
    ['Tokyo, Japan', 'un pays nommé dans le libellé'],
    ['Montreal, Quebec, CAN', 'un code alpha-3 dans le libellé'],
  ])('%s (%s) ne produit aucun verdict persisté', (location) => {
    expect(verdictFor({ location })).toBeNull();
  });

  it('un countryCode déjà en base ne prouve rien par sa seule existence', () => {
    // `legacyCountry` est la valeur stockée : elle sert d'arbitre, jamais de preuve.
    expect(verdictFor({ location: 'Berlin, DE', legacyCountry: 'DE' })).toBeNull();
  });

  it('une offre sans pays du tout ne produit aucun verdict', () => {
    expect(verdictFor({ location: 'Remote' })).toBeNull();
  });
});

/**
 * Les 99 offres à code ambigu de la vague P7, telles qu'elles sont RÉELLEMENT stockées en production
 * (mesurées le 2026-09-12). Aucune ne doit devenir éligible sans que sa source déclare le pays.
 */
describe('countryIntegrityOf — les libellés réels de la vague P7', () => {
  it.each([
    ['Hamburg, Hamburg, 20354', 'DE'],
    ['CA-AB-Calgary', 'CA'],
    ['NL-Utrecht', 'NL'],
    ['Delhi', 'IN'],
    ['Jakarta', 'ID'],
    ['Buenos Aires', 'AR'],
  ])('%s sous %s reste sans preuve tant que la source ne déclare rien', (location, legacyCountry) => {
    expect(verdictFor({ location, legacyCountry })).toBeNull();
  });

  it('la même offre devient prouvée dès que la source publie un champ pays', () => {
    expect(verdictFor({ location: 'CA-AB-Calgary', legacyCountry: 'CA', rawCountryCode: 'CA' }))
      .toBe('RAW_COUNTRY_CODE');
  });
});
