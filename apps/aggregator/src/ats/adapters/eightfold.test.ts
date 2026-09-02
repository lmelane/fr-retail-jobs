import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchWithRetry: vi.fn() }));
vi.mock('../../lib/browser.js', () => ({ fetchRenderedHtml: vi.fn() }));

import { fetchJson, fetchWithRetry } from '../../lib/http.js';
import { fetchEightfoldJobs } from './eightfold.js';

const mockJson = vi.mocked(fetchJson);
const mockRetry = vi.mocked(fetchWithRetry);
beforeEach(() => {
  mockJson.mockReset();
  mockRetry.mockReset();
});

/**
 * Regression for the live ERR on every Eightfold apply link (Estée Lauder,
 * Dr. Jart+, Frédéric Malle…): positionUrl is a RELATIVE path
 * ("/careers/job/123"), stored as-is it is not fetchable. It must be resolved
 * against the origin — verified `${origin}/careers/job/123` → 200.
 */
describe('fetchEightfoldJobs apply URL', () => {
  it('resolves the relative positionUrl against the origin', async () => {
    // openSession reads Set-Cookie off the careers page response.
    mockRetry.mockResolvedValueOnce({ headers: { getSetCookie: () => ['sid=abc; Path=/'] } } as never);
    mockJson
      .mockResolvedValueOnce({
        data: {
          positions: [{ id: 1168274680915, name: 'Vendeur', positionUrl: '/careers/job/1168274680915' }],
        },
      } as never)
      .mockResolvedValueOnce({ data: { positions: [] } } as never);

    const jobs = await fetchEightfoldJobs({
      origin: 'https://careers.elcompanies.com',
      domain: 'elcompanies.com',
      withDescriptions: false,
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].url).toBe('https://careers.elcompanies.com/careers/job/1168274680915');
  });
});
