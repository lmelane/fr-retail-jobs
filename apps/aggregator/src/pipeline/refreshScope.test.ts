import { describe, it, expect } from 'vitest';
import { refreshScope } from './refresh.js';

/**
 * LE REFRESH A SON PROPRE PÉRIMÈTRE, et il ne le déduit PAS du statut ACTIVE.
 *
 * Avant cette porte, `runRefresh` prenait toute `JobSource` active. Pendant une reprise bornée — 9 sources
 * ingérées sur 440 — le silence des 431 autres aurait pu fermer leurs offres, alors qu'elles n'ont simplement
 * pas tourné. Le registre P6 a précisément séparé « au catalogue » de « vient de prouver son exhaustivité » :
 * la première notion ne peut pas servir de périmètre à la seconde.
 */
describe('refreshScope — le périmètre autorisé du refresh', () => {
  const catalogue = ['mecca', 'urbn-hub', 'beiersdorf', 'source-hors-vague'];

  it('sans variable, le périmètre reste celui d\'avant : toutes les sources', () => {
    expect(refreshScope(catalogue, undefined)).toBeUndefined();
    expect(refreshScope(catalogue, '')).toBeUndefined();
    expect(refreshScope(catalogue, '   ')).toBeUndefined();
  });

  it('une liste ferme le périmètre aux seules clés nommées', () => {
    expect(refreshScope(catalogue, 'mecca,beiersdorf')).toEqual(['mecca', 'beiersdorf']);
  });

  it('tolère les espaces autour des clés, comme une variable écrite à la main', () => {
    expect(refreshScope(catalogue, ' mecca , beiersdorf ')).toEqual(['mecca', 'beiersdorf']);
  });

  /**
   * Une faute de frappe qui RÉDUIRAIT le périmètre en silence est plus dangereuse qu'un arrêt : le refresh
   * paraîtrait avoir tourné sur la vague alors qu'il en aurait ignoré une partie.
   */
  it('une clé inconnue ARRÊTE, elle n\'est jamais ignorée', () => {
    expect(() => refreshScope(catalogue, 'mecca,mecca-typo')).toThrow(/clés inconnues — mecca-typo/);
  });

  it('nomme TOUTES les clés fautives, pas seulement la première', () => {
    expect(() => refreshScope(catalogue, 'absente-1,mecca,absente-2')).toThrow(/absente-1, absente-2/);
  });
});
