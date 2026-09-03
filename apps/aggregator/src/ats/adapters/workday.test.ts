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

/**
 * Regression for the live 404 on every Richemont/Cartier apply link: the URL was
 * built with `new URL(externalPath, `${origin}/${site}/`)`, which DROPS the
 * `/{site}/` segment because externalPath is an absolute path ("/job/…") that
 * overrides the base path — producing `${origin}/job/…` (404) instead of
 * `${origin}/${site}/job/…` (200, verified live).
 */
describe('fetchWorkdayJobs apply URL', () => {
  it('keeps the /{site}/ path segment (absolute externalPath must not drop it)', async () => {
    mockJson.mockResolvedValueOnce({
      total: 1,
      jobPostings: [{ title: 'Vendeur', externalPath: '/job/Paris/Vendeur_R-123' }],
    } as never);

    const jobs = await fetchWorkdayJobs({
      tenant: 'richemont',
      site: 'broadbean_external',
      origin: 'https://richemont.wd3.myworkdayjobs.com',
      withDescriptions: false,
    });

    expect(jobs[0].url).toBe(
      'https://richemont.wd3.myworkdayjobs.com/broadbean_external/job/Paris/Vendeur_R-123',
    );
  });
});

import { brandFromWorkdayDetail } from './workday.js';

/**
 * Audit A-01 — on a group tenant, the offer belongs to its Maison. The detail
 * payload names it twice; shapes verified live on richemont/broadbean_external.
 */
describe('brandFromWorkdayDetail', () => {
  it('prefers the logo alt text — it is the clean brand name', () => {
    expect(
      brandFromWorkdayDetail({
        jobPostingInfo: { logoImage: { alt: 'Panerai' } },
        hiringOrganization: { name: 'C170 Officine Panerai' },
      }),
    ).toBe('Panerai');
  });

  it('falls back to the legal entity, stripped of its code prefix', () => {
    expect(brandFromWorkdayDetail({ hiringOrganization: { name: 'C170 Officine Panerai' } })).toBe(
      'Officine Panerai',
    );
  });

  it('returns undefined on a single-brand tenant without those fields', () => {
    expect(brandFromWorkdayDetail({ jobPostingInfo: { jobDescription: 'x' } })).toBeUndefined();
  });
});
