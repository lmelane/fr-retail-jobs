import { describe, expect, it } from 'vitest';
import { parseFilters } from './jobs';
import { CURSEUR_MAX } from './curseur';

/**
 * LES CLÉS D'URL SONT CELLES DU CONTRAT DE FACETTES (lot 6) : `contrat`,
 * `temps`, `programme`… — le vocabulaire visible par le candidat, en français
 * parce que l'URL l'est. Les clés techniques du modèle mondial
 * (`employmentTerm`, `workTime`, `programType`), émises par le site entre le
 * 2026-09-08 et le lot 6, restent LUES : des liens partagés existent.
 * La pagination est un curseur `apres` (lot 7) ; `page` n'existe plus.
 */
describe('parseFilters — bornes et clés du contrat', () => {
  it('lit le curseur `apres` tel quel, borné en longueur ; `page` n’est plus lu', () => {
    expect(parseFilters({ apres: ' abc_-123 ' }).apres).toBe('abc_-123');
    expect(parseFilters({ apres: '' }).apres).toBeUndefined();
    expect(parseFilters({ page: '3' })).not.toHaveProperty('page');
    // Un jeton trop long est tronqué à CURSEUR_MAX + 1 : c'est le décodeur qui le refuse, pas le parseur qui le devine.
    expect(parseFilters({ apres: 'a'.repeat(5000) }).apres).toHaveLength(CURSEUR_MAX + 1);
  });
  it('preserves the full query for explicit validation by the search plan', () => {
    expect(parseFilters({ q: 'a'.repeat(5000) })).toMatchObject({ q: 'a'.repeat(5000) });
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
