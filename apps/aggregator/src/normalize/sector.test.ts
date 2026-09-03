import { describe, it, expect } from 'vitest';
import { classifySector } from './sector.js';

/**
 * Behaviour these tests pin down (BDD): the sector filter is company-first, so a
 * bare brand token in an employer name must not drag a whole out-of-vertical
 * company into Catwalks. Each false positive below was produced by the current
 * signal list ("Omega Pharma" -> JEWELRY_WATCHES); each is written as the correct
 * expectation. The counter-cases guard the real houses those tokens exist for.
 */

const verdict = (company: string) => classifySector({ company });

describe('classifySector — ambiguous brand tokens no longer admit out-of-vertical employers (S-1)', () => {
  it('rejects "Omega Pharma" and "Omega Engineering" (OMEGA is a watch brand, not these)', () => {
    expect(verdict('Omega Pharma').inScope).toBe(false);
    expect(verdict('Omega Engineering').inScope).toBe(false);
  });

  it('rejects "Tresor Public" (TRESOR the jewellery chain, not the tax office)', () => {
    expect(verdict('Tresor Public').inScope).toBe(false);
  });

  it('rejects "Zenith Aircraft" and "Mango Airlines"', () => {
    expect(verdict('Zenith Aircraft').inScope).toBe(false);
    expect(verdict('Mango Airlines').inScope).toBe(false);
  });

  it('rejects "MODErn Solutions" — MODE must not match as a substring of MODERN', () => {
    expect(verdict('MODErn Solutions').inScope).toBe(false);
    expect(verdict('Modern Solutions').inScope).toBe(false);
  });

  it('rejects "Boutique Hotel Group" (BOUTIQUE the retail word, not a hotel)', () => {
    expect(verdict('Boutique Hotel Group').inScope).toBe(false);
  });
});

describe('classifySector — real fashion / luxury houses stay in scope', () => {
  it('keeps verified reference-list houses in scope', () => {
    // Read from data/maisons.csv: real rows across every core segment.
    expect(verdict('Sephora').inScope).toBe(true);
    expect(verdict('Louis Vuitton').inScope).toBe(true);
    expect(verdict('Cartier').inScope).toBe(true);
    expect(verdict('Chanel').inScope).toBe(true);
    expect(verdict('Guerlain').inScope).toBe(true);
    expect(verdict('Acne Studios').inScope).toBe(true);
  });

  it('keeps the exact brands the ambiguous tokens exist for', () => {
    // Zenith (the LVMH watch house) is a verified maison; "Mango" the retailer is
    // caught by the fashion signal. Narrowing the tokens must not lose these.
    expect(verdict('Zenith').inScope).toBe(true);
    expect(verdict('Mango').inScope).toBe(true);
  });

  it('still recognises a fashion employer by an industry word in the name', () => {
    expect(verdict('Atelier Couture Privé').inScope).toBe(true);
    expect(verdict('Maison de Maroquinerie').inScope).toBe(true);
  });

  it('still recognises known non-listed signal employers', () => {
    // A bare signal brand with no disqualifying industry word stays in scope.
    expect(verdict('Zara').inScope).toBe(true);
    expect(verdict('Galeries Lafayette').inScope).toBe(true);
    expect(verdict('Yves Rocher').inScope).toBe(true);
  });
});

describe('classifySector — genuinely out-of-vertical employers stay excluded (non-regression)', () => {
  it('keeps generalist retailers and services out', () => {
    expect(verdict('Carrefour').inScope).toBe(false);
    expect(verdict('Capgemini').inScope).toBe(false);
    // Sporting-goods stay out; fashion footwear (Courir, Foot Locker) stays in.
    expect(verdict('Intersport').inScope).toBe(false);
  });
});

describe('classifySector — Decathlon is RETAIL (decision 2026-09-03)', () => {
  it('classifies Decathlon as an in-scope RETAIL employer, not excluded', () => {
    const v = verdict('Decathlon');
    expect(v.inScope).toBe(true);
    expect(v.sector).toBe('RETAIL');
  });
});

describe('classifySector — unrecognised employer inherits its source sector', () => {
  it('an unknown brand from a FashionJobs source is FASHION, not OTHER', () => {
    const v = classifySector({ company: 'Some Unlisted Label', sourceSector: 'FASHION' });
    expect(v.inScope).toBe(true);
    expect(v.sector).toBe('FASHION');
  });

  it('a source sector never overrides a positive name match', () => {
    // Sephora is a recognised employer (classified by name); a FASHION source
    // hint must NOT flip it to the fallback FASHION — the name match wins.
    const withHint = classifySector({ company: 'Sephora', sourceSector: 'FASHION' });
    const withoutHint = classifySector({ company: 'Sephora' });
    expect(withHint.sector).toBe(withoutHint.sector);
    expect(withHint.reason).not.toContain('inherited');
  });
});
