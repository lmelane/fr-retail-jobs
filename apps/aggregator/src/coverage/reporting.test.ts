import { describe, expect, it } from 'vitest';
import { attributionLabel, outcome, share } from './reporting.js';

describe('share', () => {
  it('does not round an open defect up to 100 %', () => {
    // The real regression: 440 of 441 sources passed the publication check and the summary printed "100 %",
    // hiding the one source (ulta-jibe) whose public counter disagreed with the database.
    expect(share(440, 441)).toBe('99,8 % (440/441)');
    expect(share(440, 441)).not.toContain('100 %');
  });

  it('reserves 100 % for unanimity', () => {
    expect(share(441, 441)).toBe('100 % (441/441)');
    expect(share(0, 441)).toBe('0,0 % (0/441)');
  });

  it('keeps a very high but incomplete ratio below 100', () => {
    expect(share(9999, 10000)).toBe('99,9 % (9999/10000)');
    expect(share(99999, 100000)).toBe('99,9 % (99999/100000)');
  });

  it('reports a null denominator instead of dividing by zero', () => {
    expect(share(0, 0)).toBe('n/d (dénominateur nul)');
  });

  it('refuses counts that are not a share', () => {
    expect(() => share(5, 4)).toThrow(/not a share/);
    expect(() => share(-1, 4)).toThrow(/non-negative/);
  });
});

describe('outcome', () => {
  it('calls an absence of observation NOT_VERIFIED, never a failure', () => {
    // 353 of 441 live sources carry no identity observation at all: that is missing proof, not a measured defect.
    expect(outcome(0, 0, 1200)).toBe('NOT_VERIFIED');
  });

  it('separates proven from failed once something was observed', () => {
    expect(outcome(10, 10, 10)).toBe('PROVEN');
    expect(outcome(10, 9, 10)).toBe('FAILED');
    // Observed but incomplete: representations exist that were never observed, so the check is not proven.
    expect(outcome(5, 5, 10)).toBe('FAILED');
  });

  it('treats no active representation as nothing to verify', () => {
    expect(outcome(0, 0, 0)).toBe('NOT_VERIFIED');
  });

  it('rejects inconsistent counts rather than reporting a plausible number', () => {
    expect(() => outcome(3, 4, 10)).toThrow(/inconsistent/);
    expect(() => outcome(11, 0, 10)).toThrow(/inconsistent/);
  });
});

describe('attributionLabel', () => {
  it('always shows the real denominator', () => {
    expect(attributionLabel(0, 0, 10290)).toBe('non vérifiée (0 / 10290 observées)');
    expect(attributionLabel(500, 400, 1000)).toBe('400 / 1000 prouvées, 500 non observées');
    expect(attributionLabel(10, 10, 10)).toBe('proven');
    expect(attributionLabel(0, 0, 0)).toBe('aucune représentation active');
  });
});
