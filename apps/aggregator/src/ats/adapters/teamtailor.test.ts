import { describe, expect, it } from 'vitest';
import { toNormalized } from './teamtailor.js';

/** Audit A5 (2026-09-06) : normal.eu publie son feed sur jobs.normal.eu, ses fiches n'existent que sur jobs.normal.{no,fr} — 478/478 liens en 404. */
describe('toNormalized — hôte des fiches', () => {
  const item = { id: '8288459', title: 'Sales Assistant', url: 'https://jobs.normal.eu/jobs/8288459-sales-assistant', date_published: '2026-09-01' } as never;
  it('rehéberge l’URL sur jobOrigin quand il est configuré', () => {
    expect(toNormalized(item, 'https://jobs.normal.fr')?.url).toBe('https://jobs.normal.fr/jobs/8288459-sales-assistant');
  });
  it('garde l’URL du feed sans jobOrigin', () => {
    expect(toNormalized(item)?.url).toBe('https://jobs.normal.eu/jobs/8288459-sales-assistant');
  });
});
