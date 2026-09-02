import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn() }));

import { fetchJson } from '../../lib/http.js';
import { fetchMagnetJobs } from './magnet.js';

const mockJson = vi.mocked(fetchJson);
beforeEach(() => mockJson.mockReset());

/** Login returns a token, then one page of offers, then an empty page to stop. */
function mockLoginThenOffers(offers: unknown[]) {
  mockJson
    .mockResolvedValueOnce({ data: { token: 'tok' } } as never) // login
    .mockResolvedValueOnce({ data: { list: offers } } as never) // page 0
    .mockResolvedValueOnce({ data: { list: [] } } as never); // page 1 (stop)
}

/**
 * Regression for the live 404 on every Magnet apply link (Groupe Eram, ETAM,
 * Beaumanoir): the URL was built as `${origin}/offre/${id}`, but the id is
 * `10955-<base64>`, not a URL path — so every link 404'd. The API ships a real,
 * verified-200 `apply_link`; the adapter must use it and NEVER construct one.
 */
describe('fetchMagnetJobs apply URL', () => {
  const config = {
    siteKey: '61ffe84ad14ba0fdbb448d2d388ac4e3',
    origin: 'https://recrutement.groupe-eram.com',
  };

  it('uses the API apply_link, not a constructed /offre/{id}', async () => {
    mockLoginThenOffers([
      {
        id: '10955-OTkwNzAtaFo3MnBr',
        reference: '99070-hZ72pk',
        title: 'Conseiller de vente F/H',
        apply_link: 'https://api.magnet.work/v2/redirect/job-offer/eram/99070-hZ72pk',
      },
    ]);

    const jobs = await fetchMagnetJobs(config);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].url).toBe('https://api.magnet.work/v2/redirect/job-offer/eram/99070-hZ72pk');
    expect(jobs[0].url).not.toContain('/offre/');
  });

  it('falls back to link when apply_link is absent', async () => {
    mockLoginThenOffers([
      { id: 'x', title: 'Vendeur', link: 'https://api.magnet.work/v2/redirect/job-offer/eram/abc' },
    ]);

    const jobs = await fetchMagnetJobs(config);
    expect(jobs[0].url).toBe('https://api.magnet.work/v2/redirect/job-offer/eram/abc');
  });

  it('skips an offer with no usable link rather than storing a dead /offre/{id}', async () => {
    mockLoginThenOffers([{ id: '10955-deadbeef', title: 'Ghost, no link' }]);

    const jobs = await fetchMagnetJobs(config);
    expect(jobs).toHaveLength(0);
  });
});
