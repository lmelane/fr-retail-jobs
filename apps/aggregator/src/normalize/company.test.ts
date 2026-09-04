import { describe, expect, it } from 'vitest';
import { resolveCompany, stripLogoArtifact, stripMultiBrandSuffix } from './company.js';

/**
 * Group ATS feeds (L'Oréal Luxe, Puig, Richemont, SMCP…) publish a whole
 * portfolio under one endpoint and put a multi-brand label in
 * `hiringOrganization.name`: "Cartier +3", "Helena Rubinstein +8". Stored
 * verbatim, that "+N" counter becomes a phantom company name a candidate sees
 * on thousands of offers. The lead brand is the real employer; the "+N" is not
 * part of any company's name.
 */
describe('stripMultiBrandSuffix', () => {
  it('removes a trailing " +N" multi-brand counter', () => {
    expect(stripMultiBrandSuffix('Cartier +3')).toBe('Cartier');
    expect(stripMultiBrandSuffix('Helena Rubinstein +8')).toBe('Helena Rubinstein');
    expect(stripMultiBrandSuffix('Escada Parfums +16')).toBe('Escada Parfums');
    expect(stripMultiBrandSuffix('Maje +1')).toBe('Maje');
  });

  it('keeps a "+" that belongs to the real name when no space precedes the counter', () => {
    // "Dr. Jart+" is a real brand; only the " +13" counter must go.
    expect(stripMultiBrandSuffix('Dr. Jart+ +13')).toBe('Dr. Jart+');
    // A lone trailing "+" with no counter is left untouched.
    expect(stripMultiBrandSuffix('Dr. Jart+')).toBe('Dr. Jart+');
  });

  it('leaves ordinary names unchanged', () => {
    expect(stripMultiBrandSuffix('Cartier')).toBe('Cartier');
    expect(stripMultiBrandSuffix('Hermès')).toBe('Hermès');
    expect(stripMultiBrandSuffix('Groupe Courir')).toBe('Groupe Courir');
    // No digits after the plus: not a counter.
    expect(stripMultiBrandSuffix('C&A +')).toBe('C&A +');
  });

  it('trims surrounding whitespace left by the removal', () => {
    expect(stripMultiBrandSuffix('Rabanne +1 ')).toBe('Rabanne');
  });
});

describe('resolveCompany with a multi-brand suffix', () => {
  it('resolves "Cartier +3" to the real Cartier identity, not a phantom company', () => {
    const identity = resolveCompany('Cartier +3');
    expect(identity.companyId).toBe('CARTIER');
    expect(identity.displayName).toBe('Cartier');
  });

  it('resolves an unknown lead brand to a clean id and name without the counter', () => {
    const identity = resolveCompany('Escada Parfums +16');
    // Unknown to the alias table -> derived id, but free of the "+16".
    expect(identity.companyId).not.toContain('16');
    expect(identity.displayName).toBe('Escada Parfums');
  });

  it('still resolves a clean known name unchanged', () => {
    expect(resolveCompany('Cartier').companyId).toBe('CARTIER');
  });
});

describe('stripLogoArtifact — "Logo" happé depuis un attribut alt', () => {
  /**
   * Mesuré en prod 2026-09-04 : 391 offres actives sous six sociétés fantômes
   * ("Richemont Logo" 195, "Logo Diptyque" 149, "Cartier Logo" 33…) pendant que
   * la vraie "Cartier" affichait 0. Le candidat filtrant sur Cartier ne voyait
   * rien.
   */
  it.each([
    ['Cartier Logo', 'Cartier'],
    ['Richemont Logo', 'Richemont'],
    ['Logo Diptyque', 'Diptyque'],
    ['Jaeger LeCoultre logo', 'Jaeger LeCoultre'],
    ['Logo Pierre Fabre', 'Pierre Fabre'],
  ])('%s -> %s', (raw, expected) => {
    expect(stripLogoArtifact(raw)).toBe(expected);
  });

  it('ne touche pas un nom où le mot n’est pas en bordure', () => {
    expect(stripLogoArtifact('Logo Design Studio Paris')).toBe('Design Studio Paris');
    expect(stripLogoArtifact('Maison Logotype')).toBe('Maison Logotype');
  });

  it('ne vide jamais un nom réduit au mot seul', () => {
    expect(stripLogoArtifact('Logo')).toBe('Logo');
    expect(stripLogoArtifact('  logo  ')).toBe('logo');
  });

  it('resolveCompany applique le nettoyage bout en bout', () => {
    expect(resolveCompany('Cartier Logo').displayName).toBe('Cartier');
    // Composé avec le suffixe multi-marques (D11) : les deux artefacts tombent.
    expect(resolveCompany('Cartier Logo +3').displayName).toBe('Cartier');
  });
});
