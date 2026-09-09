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
    expect(normalizeAdapterResult({ jobs: [job('1'), job('2')], declaredTotal: 2 }).complete).toBe(true);
    expect(normalizeAdapterResult({ jobs: [job('1'), job('2')], declaredTotal: 2, rejectedRows: [{ reason: 'X', raw: {} }] }).complete).toBe(false);
    expect(normalizeAdapterResult({ jobs: [job('1')], declaredTotal: 2 })).toMatchObject({ complete: false, truncated: true });
  });
  it('never calls complete a result with duplicate ids or a truncated read', () => {
    expect(normalizeAdapterResult({ jobs: [job('1'), job('1')], declaredTotal: 2, complete: true }).complete).toBe(false);
    expect(normalizeAdapterResult({ jobs: [job('1')], declaredTotal: 2, complete: true, truncated: true }).complete).toBe(false);
  });
});
