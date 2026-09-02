import { describe, expect, it, vi, beforeEach } from 'vitest';

// The adapter fetches over HTTP; mock the layer and drive one campaign with the
// exact numeric shapes TalentView returned live (currency 1, remote 1).
vi.mock('../../lib/http.js', () => ({
  fetchJson: vi.fn(),
  fetchText: vi.fn(),
}));

import { fetchJson } from '../../lib/http.js';
import { fetchTalentViewJobs } from './talentview.js';

const mockJson = vi.mocked(fetchJson);

beforeEach(() => mockJson.mockReset());

/**
 * Regression for the live "Argument `salaryCurrency`/`remote`: Expected String,
 * provided Int" that failed every TalentView write (Jules, Promod, Baccarat).
 * TalentView sends numeric IDs where the columns are strings.
 */
describe('TalentView numeric-id fields map to strings', () => {
  it('maps currency id 1 → EUR and remote id 1 → a label, never leaking a number', async () => {
    // The adapter calls fetchJson three times: websites, campaigns, then detail.
    mockJson
      .mockResolvedValueOnce([{ id: 3038 }] as never) // websites
      .mockResolvedValueOnce([{ id: 42, name: 'Vendeur', slug: 'vendeur', address: { city: 'Paris' } }] as never) // campaigns
      .mockResolvedValueOnce({ salary_min: 26500, salary_max: 28000, salary_currency: 1, remote_level: 1 } as never); // detail

    const jobs = await fetchTalentViewJobs({ slug: 'baccarat' });

    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    // The crash was a number in a String column — assert the types are strings.
    expect(job.salaryCurrency).toBe('EUR');
    expect(typeof job.remote).toBe('string');
    expect(job.remote).not.toMatch(/^\d+$/); // never the raw id "1"
    // The real salary numbers survive.
    expect(job.salaryMin).toBe(26500);
    expect(job.salaryMax).toBe(28000);
  });

  it('drops an unknown numeric currency id rather than storing a bare number', async () => {
    mockJson
      .mockResolvedValueOnce([{ id: 1 }] as never)
      .mockResolvedValueOnce([{ id: 7, name: 'Stage', slug: 'stage' }] as never)
      .mockResolvedValueOnce({ salary_currency: 999, remote_level: 999 } as never);

    const [job] = await fetchTalentViewJobs({ slug: 'x' });
    expect(job.salaryCurrency).toBeUndefined();
    expect(job.remote).toBeUndefined();
  });
});
