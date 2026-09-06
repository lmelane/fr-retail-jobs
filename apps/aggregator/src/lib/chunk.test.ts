import { describe, expect, it } from 'vitest';
import { chunk, DB_WRITE_BATCH } from './chunk.js';

describe('chunk', () => {
  it('découpe en tranches de taille fixe, la dernière plus courte', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 2)).toEqual([[1, 2]]);
  });

  it('une liste vide ne produit aucune tranche', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('la tranche par défaut reste sous la borne Postgres des 32 767 paramètres, même à 9 colonnes', () => {
    expect(DB_WRITE_BATCH * 9).toBeLessThan(32_767);
    expect(chunk(Array.from({ length: DB_WRITE_BATCH * 2 + 1 }, (_, i) => i))).toHaveLength(3);
  });

  it('refuse une taille invalide', () => {
    expect(() => chunk([1], 0)).toThrow();
    expect(() => chunk([1], 1.5)).toThrow();
  });
});
