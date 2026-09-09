import { describe, expect, it } from 'vitest';
import { normalizeAdapterResult } from './index.js';

const job = { externalId: '1', title: 'Vendeur', url: 'https://example.com/1' };
describe('adapter completion evidence', () => {
  it('never allows rejected rows to be hidden by a complete flag or a matching count', () => {
    expect(normalizeAdapterResult({ jobs: [job], declaredTotal: 1, complete: true,
      rejectedRows: [{ reason: 'MALFORMED_SOURCE_ROW', raw: { id: null } }] }).complete).toBe(false);
  });
  it('does not invent completion for a legacy array', () => {
    expect(normalizeAdapterResult([job]).complete).toBe(false);
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
