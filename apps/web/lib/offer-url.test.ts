import { describe, it, expect } from 'vitest';
import { offerSlug, offerPath, offerIdCandidates } from './offer-url';

describe('offerSlug', () => {
  it('normalizes accents, punctuation and case', () => {
    expect(offerSlug('Chargé(e) de Clientèle — CDI')).toBe('charge-e-de-clientele-cdi');
    expect(offerSlug('Vendeur / Vendeuse Boutique (H/F)')).toBe('vendeur-vendeuse-boutique-h-f');
  });
  it('caps length without a trailing hyphen', () => {
    const slug = offerSlug('a'.repeat(50) + ' ' + 'b'.repeat(50));
    expect(slug.length).toBeLessThanOrEqual(70);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('offerPath', () => {
  it('builds /offre/slug-id', () => {
    expect(offerPath({ id: 'ckabc123', title: 'Vendeur Paris' })).toBe('/offre/vendeur-paris-ckabc123');
  });
  it('falls back to the bare id when the title yields nothing', () => {
    expect(offerPath({ id: 'ckabc123', title: '???' })).toBe('/offre/ckabc123');
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
