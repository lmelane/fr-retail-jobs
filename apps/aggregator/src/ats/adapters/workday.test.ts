import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn() }));

import { fetchJson } from '../../lib/http.js';
import { fetchWorkdayJobs } from './workday.js';

const mockJson = vi.mocked(fetchJson);
beforeEach(() => mockJson.mockReset());

/**
 * Regression for the live "cartier-3 failed: Cannot read properties of
 * undefined (reading 'split')": Richemont's Workday tenant returned a posting
 * with no externalPath, and `job.externalPath.split('/')` threw, losing all
 * ~1300 of its offers. A path-less row must be skipped, not crash the source.
 */
describe('fetchWorkdayJobs with a posting missing externalPath', () => {
  it('skips the path-less posting and keeps the valid ones, no throw', async () => {
    mockJson.mockResolvedValueOnce({
      total: 2,
      jobPostings: [
        { title: 'Vendeur', externalPath: '/job/Paris/Vendeur_R-123' },
        { title: 'Ghost row', /* no externalPath */ locationsText: 'Nowhere' },
      ],
    } as never);

    const jobs = await fetchWorkdayJobs({
      tenant: 'richemont',
      site: 'richemont',
      origin: 'https://richemont.wd3.myworkdayjobs.com',
      withDescriptions: false,
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Vendeur');
    // externalId is the last path segment.
    expect(jobs[0].externalId).toBe('Vendeur_R-123');
  });
});
