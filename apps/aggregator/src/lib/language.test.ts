import { describe, expect, test } from 'vitest';
import { detectLanguage } from './language.js';

describe('detectLanguage', () => {
  test('detects French posting text', () => {
    expect(
      detectLanguage(
        'Nous recherchons pour notre boutique de Paris une conseillère de vente qui saura accompagner les clients dans leur parcours et porter les valeurs de la maison.',
      ),
    ).toBe('fr');
  });

  test('detects English posting text', () => {
    expect(
      detectLanguage(
        'We are looking for a sales advisor to join our team in the London flagship store and deliver an exceptional experience to our clients.',
      ),
    ).toBe('en');
  });

  test('detects German posting text', () => {
    expect(
      detectLanguage(
        'Wir suchen eine Verstärkung für unser Team in der Filiale München. Du berätst unsere Kunden mit Leidenschaft und bist verantwortlich für die Warenpräsentation.',
      ),
    ).toBe('de');
  });

  test('detects Italian posting text', () => {
    expect(
      detectLanguage(
        'Per la nostra boutique di Milano cerchiamo una figura che sappia accogliere i clienti e trasmettere i valori della maison con passione e professionalità nel lavoro quotidiano.',
      ),
    ).toBe('it');
  });

  test('strips HTML before scoring', () => {
    expect(
      detectLanguage(
        '<p>Nous recherchons</p><ul><li>une personne pour la boutique</li><li>avec de l’expérience dans le luxe et la vente</li></ul>',
      ),
    ).toBe('fr');
  });

  test('returns undefined on a bare job title', () => {
    // "Store Manager" alone carries no function words — refusing to guess is
    // the contract, a wrong language stored is worse than none.
    expect(detectLanguage('Store Manager')).toBeUndefined();
  });

  test('returns undefined on empty input', () => {
    expect(detectLanguage(undefined)).toBeUndefined();
    expect(detectLanguage('')).toBeUndefined();
  });
});
