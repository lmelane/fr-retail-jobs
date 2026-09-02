import { describe, expect, it } from 'vitest';
import { resolveCompany, stripMultiBrandSuffix } from './company.js';

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
