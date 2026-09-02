import { describe, it, expect } from 'vitest';
import { loadMaisons, findMaison } from './maisons.js';

/**
 * Behaviour these tests pin down (BDD): data/maisons.csv ships with CRLF line
 * endings, so a naive split on '\n' leaves a trailing '\r' on the last field of
 * every non-final row. That made `confidence` read as "HIGH\r", which is neither
 * 'HIGH' nor a value any consumer can compare against. The parser must strip the
 * carriage returns.
 */

describe('loadMaisons — CRLF line endings are stripped (M-1)', () => {
  const entries = loadMaisons();

  it('parses many rows', () => {
    // Sanity: the reference list is the backbone of the filter, not a stub.
    expect(entries.length).toBeGreaterThan(700);
  });

  it('never leaves a carriage return in any field', () => {
    for (const entry of entries) {
      expect(entry.confidence).not.toMatch(/\r/);
      expect(entry.source).not.toMatch(/\r/);
      expect(entry.segment).not.toMatch(/\r/);
      expect(entry.name).not.toMatch(/\r/);
    }
  });

  it('yields only the three valid confidence levels', () => {
    const levels = new Set(entries.map((entry) => entry.confidence));
    for (const level of levels) {
      expect(['HIGH', 'MEDIUM', 'LOW']).toContain(level);
    }
  });

  it('has confidence exactly "HIGH" for a known HIGH-confidence house', () => {
    // Sephora is a HIGH-confidence LVMH row; the old parser gave it "HIGH\r".
    const sephora = findMaison('Sephora');
    expect(sephora).not.toBeNull();
    expect(sephora?.confidence).toBe('HIGH');
  });

  it('keeps trailing-field values clean on rows other than the last', () => {
    // The last CSV row is unaffected by the bug; the regression lives in every
    // preceding row. Assert on a house that is not last in the file.
    const vuitton = findMaison('Louis Vuitton');
    expect(vuitton?.confidence).toBe('HIGH');
    expect(vuitton?.confidence).not.toContain('\r');
  });
});
