import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandCompanyTerm } from '../groups.js';

/** The employer directory still uses the reviewed reference-group expansion.
 * Public job search bounds are exercised in search-plan and search-intent tests. */
describe('bornes de la recherche (audit 14/09/2026)', () => {
  it('le référentiel des groupes est LU : le chemin est le bon', () => {
    // Prémisse : sans expansion, le témoin suivant ne prouverait rien.
    const brut = expandCompanyTerm('sandro');
    expect(brut.length, 'le CSV doit être lisible, sinon le chemin est de nouveau cassé').toBeGreaterThan(1);
    // Le cas produit qui a motivé l'expansion : une marque atteint son groupe.
    expect(brut.map((v) => v.toLowerCase())).toContain('smcp');
  });

  it("le fichier vit bien dans reference/, pas à la racine de data/", () => {
    // Le défaut exact : un chemin qui a l'air juste et ne l'est pas.
    const bon = join(process.cwd(), '..', 'aggregator', 'data', 'reference', 'maisons.csv');
    expect(() => readFileSync(bon, 'utf8')).not.toThrow();
    expect(readFileSync(bon, 'utf8').split('\n')[0]).toContain('name,canonical_slug');
  });

  it("l'expansion d'un terme très partagé reste BORNÉE", () => {
    /*
     * « l'oreal » était le pire cas mesuré par l'audit : 55 marques rattachées.
     * L'expansion peut légitimement être large — ce qui compte, c'est qu'elle
     * ne soit pas multipliée par un nombre de termes illimité.
     */
    const grand = expandCompanyTerm("l'oreal");
    expect(grand.length).toBeGreaterThan(1);
    // Aucune assertion de plafond ici : la borne vit sur les TERMES, pas sur
    // l'expansion d'un terme. Ce témoin documente l'ordre de grandeur réel.
    expect(grand.length).toBeLessThan(500);
  });

  it('un terme inconnu ne rend que lui-même', () => {
    expect(expandCompanyTerm('zzzz-maison-inexistante')).toEqual(['zzzz-maison-inexistante']);
  });

});
