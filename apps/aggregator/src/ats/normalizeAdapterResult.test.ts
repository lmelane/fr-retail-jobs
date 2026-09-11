import { describe, expect, it } from 'vitest';
import { normalizeAdapterResult } from './index.js';

const job = (id: string) => ({ externalId: id, title: `T ${id}`, url: `https://x.example/${id}` }) as any;

describe('normalizeAdapterResult — rejected rows are witnesses, not doubt', () => {
  it('keeps an adapter-proven enumeration complete when its rejected rows explain the gap (sitemap pages without a posting)', () => {
    const r = normalizeAdapterResult({ jobs: [job('1'), job('2')], declaredTotal: 3, complete: true, truncated: false, rejectedRows: [{ reason: 'LISTED_PAGE_WITHOUT_JOBPOSTING', raw: { url: 'https://x.example/3' } }] });
    expect(r.complete).toBe(true); expect(r.truncated).toBe(false);
  });
  it('respects an adapter that refuses the proof, whatever the count says', () => {
    expect(normalizeAdapterResult({ jobs: [job('1')], declaredTotal: 1, complete: false, truncated: false }).complete).toBe(false);
  });
  it('for a legacy adapter that states nothing, the count proves completion only without rejected rows', () => {
    expect(normalizeAdapterResult({ jobs: [job('1'), job('2')], declaredTotal: 2 })).toMatchObject({ complete: true, enumerationVerdict: 'PROVEN' });
    /**
     * An unexplained rejected row on an otherwise complete count is now UNKNOWN, not REFUTED (2026-09-11).
     * The row we could not read might have been a posting or might not: that is doubt, and `complete:
     * undefined` says so. Calling it `false` claimed a proof of incompleteness we never had — and that claim
     * is what froze 187 sources carrying 20 796 live representations, none of which could close an offer.
     */
    expect(normalizeAdapterResult({ jobs: [job('1'), job('2')], declaredTotal: 2, rejectedRows: [{ reason: 'X', raw: {} }] }))
      .toMatchObject({ complete: undefined, enumerationVerdict: 'UNKNOWN' });
    // A genuinely short read stays REFUTED: half the declared listing is below the coverage threshold.
    expect(normalizeAdapterResult({ jobs: [job('1')], declaredTotal: 2 })).toMatchObject({ complete: false, truncated: true, enumerationVerdict: 'REFUTED' });
  });

  it('one posting short of a large declared total is neither truncated nor incomplete (kering 1 025/1 026)', () => {
    // Requiring exactness refused completeness on a 99.9 % read, because several ATS publish a posting while
    // the sweep is running. The coverage threshold that governs attestation now governs this too.
    const jobs = Array.from({ length: 1025 }, (_, i) => job(String(i)));
    expect(normalizeAdapterResult({ jobs, declaredTotal: 1026 })).toMatchObject({ complete: true, truncated: false, enumerationVerdict: 'PROVEN' });
  });
  it('never calls complete a result with duplicate ids or a truncated read', () => {
    expect(normalizeAdapterResult({ jobs: [job('1'), job('1')], declaredTotal: 2, complete: true }).complete).toBe(false);
    expect(normalizeAdapterResult({ jobs: [job('1')], declaredTotal: 2, complete: true, truncated: true }).complete).toBe(false);
  });
});
