import { describe, it, expect } from 'vitest';
import { readAllPages, MAX_ANNOUNCED_PAGES } from './apiPagination.js';

/**
 * LE DÉFAUT RÉEL QUE CES TESTS VERROUILLENT.
 *
 * `public-chain-reconcile` plafonnait à 50 pages. L'API publique sert 25 offres par page ; Skechers en publie
 * 1 656 sur 67 pages. L'outil s'arrêtait donc page 50 et rapportait 406 offres « absentes de l'API » — alors
 * que l'API les servait toutes (`total` = 1 656 = la base). Le produit était juste ; c'est la mesure qui
 * mentait, et elle mentait dans le sens qui invente un défaut.
 */
const pageOf = (n: number, per: number, pageCount: number) =>
  ({ items: Array.from({ length: per }, (_, i) => `p${n}-${i}`), pageCount });

describe('lecture paginée jusqu\'au bout', () => {
  it('lit les 67 pages de Skechers, pas les 50 premières', async () => {
    const PER = 25, PAGES = 67;
    const seen: number[] = [];
    const all = await readAllPages(async (page) => { seen.push(page); return pageOf(page, PER, PAGES); });
    expect(seen.at(-1)).toBe(PAGES);
    expect(all).toHaveLength(PER * PAGES); // 1 675 ≥ les 1 656 réelles : aucune page manquée.
    expect(new Set(all).size).toBe(all.length);
  });

  it('une page illisible LÈVE au lieu de rendre un ensemble tronqué', async () => {
    // Le cœur du sujet : rendre les 3 premières pages serait indiscernable d'une collection de 3 pages.
    await expect(readAllPages(async (page) => (page <= 3 ? pageOf(page, 25, 10) : null), 'API'))
      .rejects.toThrow(/page 4 illisible/);
  });

  it('ne suit pas une pagination invraisemblable', async () => {
    await expect(readAllPages(async () => ({ items: [], pageCount: MAX_ANNOUNCED_PAGES + 1 })))
      .rejects.toThrow(/pagination suspecte/);
  });

  it('refuse un pageCount absurde plutôt que de le traiter comme 1 page', async () => {
    for (const bad of [0, -3, Number.NaN]) {
      await expect(readAllPages(async () => ({ items: ['a'], pageCount: bad }))).rejects.toThrow(/pageCount invalide/);
    }
  });

  it('une collection d\'une seule page se lit sans pageCount déclaré', async () => {
    expect(await readAllPages(async () => ({ items: ['a', 'b'] }))).toEqual(['a', 'b']);
  });

  it('une collection vide reste vide — ce n\'est pas une erreur', async () => {
    expect(await readAllPages(async () => ({ items: [], pageCount: 1 }))).toEqual([]);
  });
});
