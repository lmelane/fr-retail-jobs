import { describe, expect, it } from 'vitest';
import { parseFilters, MAX_PAGE } from './jobs';

/**
 * LES CLÉS D'URL SONT CELLES DU CONTRAT DE FACETTES (lot 6) : `contrat`,
 * `temps`, `programme`… — le vocabulaire visible par le candidat, en français
 * parce que l'URL l'est. Les clés techniques du modèle mondial
 * (`employmentTerm`, `workTime`, `programType`), émises par le site entre le
 * 2026-09-08 et le lot 6, restent LUES : des liens partagés existent.
 */
describe('parseFilters — bornes et clés du contrat', () => {
  it.each(['1.5', '-1', 'Infinity', 'NaN', '9007199254740993'])('normalizes invalid page %s', page => {
    expect(parseFilters({ page }).page).toBe(1);
  });
  it('bounds oversized offsets and search text', () => {
    expect(parseFilters({ page: '999999', q: 'a'.repeat(5000) })).toMatchObject({ page: MAX_PAGE, q: 'a'.repeat(200) });
  });
  // parseFilters reçoit les searchParams de Next (un objet), pas une URLSearchParams.
  const filters = (qs: string) =>
    parseFilters(Object.fromEntries(new URLSearchParams(qs).entries()));

  it('lit la clé du contrat', () => {
    expect(filters('contrat=PERMANENT').filtres.contrat).toEqual(['PERMANENT']);
  });

  it('accepte encore l’ancienne clé technique — les liens partagés continuent de marcher', () => {
    expect(filters('employmentTerm=FIXED_TERM').filtres.contrat).toEqual(['FIXED_TERM']);
  });

  it('la clé du contrat l’emporte quand les deux sont présentes', () => {
    expect(filters('contrat=FIXED_TERM&employmentTerm=PERMANENT').filtres.contrat).toEqual(['FIXED_TERM']);
  });

  it('rend undefined quand aucune n’est fournie', () => {
    expect(filters('ville=Paris').filtres.contrat).toBeUndefined();
  });

  it('lit les autres dimensions sous leur clé visible, et le marché', () => {
    const f = filters('ville=Paris&secteur=LUXURY&pays=fr&marche=FR');
    expect(f.filtres.ville).toEqual(['Paris']);
    expect(f.filtres.secteur).toEqual(['LUXURY']);
    expect(f.filtres.pays).toEqual(['FR']);
    expect(f.marche).toBe('FR');
  });
});
