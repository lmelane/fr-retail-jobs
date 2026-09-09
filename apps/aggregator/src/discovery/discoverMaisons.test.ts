import { describe, expect, it } from 'vitest';
import { loadDeadNames, parseRosterCsv, discoveryTaskKey } from './discoverMaisons.js';

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


it('preserves a quoted business name containing commas', () => {
  expect(parseRosterCsv('name,url\n"Maison, Inc.",https://brand.com/careers'))
    .toEqual([{ name: 'Maison, Inc.', url: 'https://brand.com/careers' }]);
});
it('keeps regional portals separate and preserves non-Latin identities', () => {
  expect(discoveryTaskKey({name:'集团',url:'https://brand.com/fr'})).not.toBe(discoveryTaskKey({name:'集团',url:'https://brand.com/us'}));
  expect(discoveryTaskKey({name:'集团',url:'https://brand.com'})).not.toBe(discoveryTaskKey({name:'公司',url:'https://brand.com'}));
});
