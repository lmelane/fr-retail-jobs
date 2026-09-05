import { describe, expect, it } from 'vitest';
import { guessDomain } from './company-domain';

/**
 * Mesuré le 2026-09-05 : 18 des 30 plus grosses Maisons n'avaient pas de logo.
 * La cause n'était pas le fournisseur — DuckDuckGo rend bien 15 Ko pour Sephora
 * — mais le domaine fabriqué : parfumschanel.com, tiffanyand.com,
 * footlockerfrance.com, mangomngsa.com n'existent pas.
 */
describe('guessDomain', () => {
  it.each([
    ['Parfums Chanel', 'chanel.com'],
    ['Christian Dior Couture', 'christiandior.com'],
    ['Estée Lauder Companies', 'esteelauder.com'],
    ['MANGO MNG, S.A.', 'mango.com'],
    ['Michael Page France', 'michaelpage.com'],
    ['Groupe Printemps', 'printemps.com'],
    ['Maison Margiela', 'margiela.com'],
  ])('%s -> %s', (name, domain) => {
    expect(guessDomain(name)).toBe(domain);
  });

  it('retire le « & » sans laisser « and » collé au nom', () => {
    // "Tiffany & Co." donnait tiffanyand.com : le "Co." tombait, le "and" restait.
    expect(guessDomain('Tiffany & Co.')).toBe('tiffany.com');
  });

  it('garde un nom qui ne contient que des mots de structure', () => {
    // Vidé par le nettoyage, il repart du nom brut plutôt que de rendre null.
    expect(guessDomain('Groupe')).toBe('groupe.com');
  });

  it('rend null quand il ne reste pas de quoi faire un domaine', () => {
    expect(guessDomain('A')).toBeNull();
    expect(guessDomain('—')).toBeNull();
  });

  it('ne casse pas les noms déjà simples', () => {
    expect(guessDomain('Sephora')).toBe('sephora.com');
    expect(guessDomain("Levi's")).toBe('levis.com');
  });
});
