import { describe, it, expect } from 'vitest';
import { offerSlug, offerPath, offerIdCandidates } from './offer-url';

describe('offerSlug', () => {
  it('normalizes accents, punctuation and case', () => {
    expect(offerSlug('Chargé(e) de Clientèle — CDI')).toBe('charge-e-de-clientele-cdi');
    expect(offerSlug('Vendeur / Vendeuse Boutique (H/F)')).toBe('vendeur-vendeuse-boutique-h-f');
  });
  it('caps length at 80 without a trailing hyphen', () => {
    const slug = offerSlug('a'.repeat(50) + ' ' + 'b'.repeat(50));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('offerPath', () => {
  it('builds /emplois/slug-id, the site route (lot 9)', () => {
    expect(offerPath({ id: 'ckabc123', title: 'Vendeur Paris' })).toBe('/emplois/vendeur-paris-ckabc123');
  });
  it('falls back to the bare id when the title yields nothing', () => {
    expect(offerPath({ id: 'ckabc123', title: '???' })).toBe('/emplois/ckabc123');
  });
  /**
   * PARITÉ AVEC LE SITE (lot 9). Ces valeurs sont FIXÉES ici et dans le témoin
   * `chemin-emploi-lot9` du site : les deux algorithmes doivent rendre les mêmes
   * octets, sinon le sitemap annonce des URL que le site ne lie jamais.
   */
  it('renders the parity cases exactly as the site does', () => {
    expect(offerPath({ id: 'cw_cm1', title: 'Œnologue · Chef de Cave' })).toBe('/emplois/nologue-chef-de-cave-cw_cm1');
    expect(offerPath({ id: 'c1', title: 'Conﬁguration & Café' })).toBe('/emplois/configuration-cafe-c1');
    expect(offerPath({ id: 'c2', title: 'Süß – São Tomé' })).toBe('/emplois/su-sao-tome-c2');
    expect(offerPath({ id: 'c3', title: `${'Responsable boutique '.repeat(4)}Paris rive gauche` })).toBe('/emplois/responsable-boutique-responsable-boutique-responsable-boutique-responsable-bouti-c3');
    expect(offerPath({ id: 'c4', title: '  --  ' })).toBe('/emplois/c4');
  });
});

describe('offerIdCandidates', () => {
  it('tries the raw value first, then suffixes from the shortest', () => {
    expect(offerIdCandidates('vendeur-paris-ckabc123')).toEqual([
      'vendeur-paris-ckabc123',
      'ckabc123',
      'paris-ckabc123',
    ]);
  });
  it('a bare id yields only itself', () => {
    expect(offerIdCandidates('ckabc123')).toEqual(['ckabc123']);
  });
  it('recovers a hyphenated id embedded in a slug URL', () => {
    // The e2e fixture id "e2e-active-1" inside its canonical slug URL.
    const candidates = offerIdCandidates('vendeur-boutique-e2e-active-1');
    expect(candidates).toContain('e2e-active-1');
  });
  it('caps the number of lookups on a hostile many-hyphen param', () => {
    expect(offerIdCandidates('a-b-c-d-e-f-g-h-i').length).toBeLessThanOrEqual(5);
  });
});
