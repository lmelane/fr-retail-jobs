import { describe, expect, it } from 'vitest';
import { parseFilters, MAX_PAGE } from './jobs';

/**
 * LE PARAMÈTRE TECHNIQUE porte le nom de la DIMENSION, pas un mot français.
 *
 * `?contrat=` datait du modèle franco-centré, où la colonne s'appelait
 * `contract` et stockait « CDI ». La base est mondiale depuis le 2026-09-08 :
 * l'URL technique suit. Vérifié avant de renommer — ni le sitemap ni aucun
 * canonical ne référençaient ce paramètre, donc aucune URL indexée n'était en
 * jeu.
 *
 * L'ancien nom reste LU (des liens partagés existent) mais rien ne l'émet plus.
 * L'interface, elle, continue d'afficher « Contrat » et « CDI » : c'est la
 * couche de localisation, pas le modèle.
 */
describe('parseFilters — le paramètre de durée d’emploi', () => {
  it.each(['1.5', '-1', 'Infinity', 'NaN', '9007199254740993'])('normalizes invalid page %s', page => {
    expect(parseFilters({ page }).page).toBe(1);
  });
  it('bounds oversized offsets and search text', () => {
    expect(parseFilters({ page: '999999', q: 'a'.repeat(5000) })).toMatchObject({ page: MAX_PAGE, q: 'a'.repeat(200) });
  });
  // parseFilters reçoit les searchParams de Next (un objet), pas une URLSearchParams.
  const filters = (qs: string) =>
    parseFilters(Object.fromEntries(new URLSearchParams(qs).entries()));

  it('lit le paramètre canonique', () => {
    expect(filters('employmentTerm=PERMANENT').employmentTerm).toBe('PERMANENT');
  });

  it('accepte encore l’ancien ?contrat= — les liens partagés continuent de marcher', () => {
    expect(filters('contrat=FIXED_TERM').employmentTerm).toBe('FIXED_TERM');
  });

  it('le paramètre canonique l’emporte quand les deux sont présents', () => {
    expect(filters('contrat=FIXED_TERM&employmentTerm=PERMANENT').employmentTerm).toBe('PERMANENT');
  });

  it('rend undefined quand aucun n’est fourni', () => {
    expect(filters('ville=Paris').employmentTerm).toBeUndefined();
  });

  /** Les autres paramètres restent en français : ils n'ont jamais désigné une taxonomie. */
  it('ne touche pas aux autres paramètres visibles', () => {
    const f = filters('ville=Paris&secteur=LUXURY&pays=FR');
    expect(f.city).toBe('Paris');
    expect(f.sector).toBe('LUXURY');
    expect(f.country).toBe('FR');
  });
});
