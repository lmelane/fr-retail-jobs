import { describe, expect, it } from 'vitest';
import { loadDeadNames } from './discoverMaisons.js';

/**
 * C-01 closure rule: a dead-list entry only excludes its Maison while its
 * check is FRESH. Past DEAD_RECHECK_DAYS the verdict expires and discovery
 * re-probes — a dead domain is not dead forever, and nobody has to remember
 * a quarterly chore.
 */
describe('loadDeadNames', () => {
  it('excludes freshly-checked entries and re-admits stale ones', () => {
    // The committed file is dated 2026-09-03; fresh from that day's viewpoint…
    const freshView = loadDeadNames(new Date('2026-09-10'));
    expect(freshView.size).toBeGreaterThan(1000);

    // …and fully expired two months later: every Maison re-enters the queue.
    const staleView = loadDeadNames(new Date('2026-11-10'));
    expect(staleView.size).toBe(0);
  });
});
