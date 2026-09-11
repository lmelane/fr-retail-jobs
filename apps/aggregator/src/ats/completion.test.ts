import { describe, expect, it } from 'vitest';
import { normalizeAdapterResult } from './index.js';

const job = { externalId: '1', title: 'Vendeur', url: 'https://example.com/1' };
describe('adapter completion evidence', () => {
  it('keeps rejected rows visible and never lets a matching count hide them; an adapter that judged them may still prove its enumeration', () => {
    /**
     * Legacy adapter (no verdict): a rejection is DOUBT, so the verdict is UNKNOWN and `complete` is
     * `undefined`. It used to be `false`, which asserted a proof of incompleteness nobody had — and that claim
     * is what removed the right to attest from 187 sources carrying 20 796 live representations (2026-09-11).
     * Doubt still blocks nothing on its own: attestation then falls back to the collapse guard.
     */
    expect(normalizeAdapterResult({ jobs: [job], declaredTotal: 1,
      rejectedRows: [{ reason: 'MALFORMED_SOURCE_ROW', raw: { id: null } }] }))
      .toMatchObject({ complete: undefined, enumerationVerdict: 'UNKNOWN' });
    // Adapter with an explicit verdict: the rejected rows are its witnesses (expired sitemap page, path-less row) and stay reported.
    const judged = normalizeAdapterResult({ jobs: [job], declaredTotal: 2, complete: true, truncated: false,
      rejectedRows: [{ reason: 'LISTED_PAGE_WITHOUT_JOBPOSTING', raw: { url: 'https://example.com/2' } }] });
    expect(judged.complete).toBe(true); expect(judged.rejectedRows).toHaveLength(1);
  });
  it('does not invent completion for a legacy array — and does not invent incompleteness either', () => {
    // A bare array declares nothing at all. That is UNKNOWN; calling it "proven incomplete" was the defect.
    expect(normalizeAdapterResult([job])).toMatchObject({ complete: undefined, enumerationVerdict: 'UNKNOWN' });
  });
  it('recognizes matching unique identities and a declared total', () => {
    expect(normalizeAdapterResult({ jobs: [job], declaredTotal: 1 }).complete).toBe(true);
  });
  it('rejects zero totals manufactured from a missing header on a nonempty response', () => {
    expect(normalizeAdapterResult({ jobs: [job], declaredTotal: 0 }).complete).toBe(false);
  });
  it('does not let a matching count override an explicit incomplete verdict', () => {
    expect(normalizeAdapterResult({ jobs: [job], declaredTotal: 1, complete: false }).complete).toBe(false);
  });
  it('does not let duplicate identities pretend to fill the declared total', () => {
    expect(normalizeAdapterResult({ jobs: [job, job], declaredTotal: 2, complete: true }).complete).toBe(false);
  });
});
