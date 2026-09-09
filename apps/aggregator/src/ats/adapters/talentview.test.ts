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

    const { jobs } = await fetchTalentViewJobs({ slug: 'baccarat' });

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

    const { jobs: [job] } = await fetchTalentViewJobs({ slug: 'x' });
    expect(job.salaryCurrency).toBeUndefined();
    expect(job.remote).toBeUndefined();
  });
});

import { readFileSync } from 'node:fs';
const pages = JSON.parse(readFileSync(new URL('./__fixtures__/talentview-sud-express-pages.json', import.meta.url), 'utf8'));

describe('TalentView public pagination, real Sud Express payloads', () => {
  it('reads 68 jobs across seven pages instead of silently returning the first ten', async () => {
    mockJson.mockResolvedValueOnce([{ id: 11 }]);
    for (const page of pages) mockJson.mockResolvedValueOnce(page.jobs);
    const result = await fetchTalentViewJobs({ slug: 'sud-express', withDescriptions: false });
    expect(result.jobs).toHaveLength(68);
    expect(new Set(result.jobs.map(j => j.externalId)).size).toBe(68);
    expect(result).toMatchObject({ complete: true, truncated: false });
    expect(result.declaredTotal).toBeUndefined();
    expect(mockJson.mock.calls.slice(1).map(c => new URL(c[0]).searchParams.get('offset_start'))).toEqual(['1','2','3','4','5','6','7']);
    for (const [url] of mockJson.mock.calls.slice(1)) expect([...new URL(url).searchParams.keys()]).toEqual(['company_website_id','display_mode','offset_start']);
  });
  it('requires a terminal page and does not attest a page cap or a repeating page', async () => {
    mockJson.mockResolvedValueOnce([{id:11}]).mockResolvedValueOnce(pages[0].jobs);
    expect(await fetchTalentViewJobs({slug:'sud-express',maxPages:1,withDescriptions:false})).toMatchObject({complete:false,truncated:true});
    mockJson.mockReset().mockResolvedValueOnce([{id:11}]).mockResolvedValueOnce(pages[0].jobs).mockResolvedValueOnce(pages[0].jobs);
    const result=await fetchTalentViewJobs({slug:'sud-express',withDescriptions:false});
    expect(result).toMatchObject({complete:false,truncated:true});expect(result.jobs).toHaveLength(10);
  });
  it('reads every public website and merges shared campaign IDs only after each list completes', async () => {
    mockJson.mockResolvedValueOnce([{id:11,locale:'fr'},{id:12,locale:'en'}])
      .mockResolvedValueOnce(pages[6].jobs).mockResolvedValueOnce([pages[6].jobs[0],pages[0].jobs[0]]);
    const result=await fetchTalentViewJobs({slug:'sud-express',withDescriptions:false});
    expect(result.jobs).toHaveLength(9);expect(result.complete).toBe(true);
    expect(mockJson.mock.calls.slice(1).map(c=>new URL(c[0]).searchParams.get('company_website_id'))).toEqual(['11','12']);
  });
  it('does not accept malformed payloads, invalid campaigns or a mid-pagination error as completion', async () => {
    for(const bad of [{error:'unavailable'},[{}]]){
      mockJson.mockReset().mockResolvedValueOnce([{id:11}]).mockResolvedValueOnce(bad);
      await expect(fetchTalentViewJobs({slug:'sud-express',withDescriptions:false})).rejects.toThrow(/malformed|invalid/);
    }
    mockJson.mockReset().mockResolvedValueOnce([{id:11}]).mockResolvedValueOnce(pages[0].jobs).mockRejectedValueOnce(new Error('HTTP 503'));
    await expect(fetchTalentViewJobs({slug:'sud-express',withDescriptions:false})).rejects.toThrow('HTTP 503');
  });
  it('rejects invalid website inventories and configuration', async () => {
    for(const bad of [[],{},[{}],[{id:11},{id:11}]]) {
      mockJson.mockReset().mockResolvedValueOnce(bad);
      await expect(fetchTalentViewJobs({slug:'sud-express',withDescriptions:false})).rejects.toThrow();
    }
    mockJson.mockReset().mockResolvedValueOnce([{id:11}]);
    await expect(fetchTalentViewJobs({slug:'sud-express',maxPages:0})).rejects.toThrow('maxPages');
  });
});
