import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn(), fetchWithRetry: vi.fn() }));

import { fetchJson } from '../../lib/http.js';
import { fetchSmartRecruitersJobs } from './smartrecruiters.js';

const mockJson = vi.mocked(fetchJson);
beforeEach(() => mockJson.mockReset());

/** Lot 2 (2026-09-06) : H&M plafonné à 1 000/1 622 par une borne codée en dur, l'API servant bien les offsets au-delà. */
describe('fetchSmartRecruitersJobs — pagination', () => {
  it('lit au-delà de 1 000 jusqu’au total annoncé', async () => {
    const total = 1622;
    mockJson.mockImplementation(async (url) => {
      const m = String(url).match(/offset=(\d+)/);
      if (!m) return {};
      const offset = Number(m[1]);
      const n = Math.max(0, Math.min(100, total - offset));
      return { totalFound: total, content: Array.from({ length: n }, (_, i) => ({ id: String(offset + i), name: `Poste ${offset + i}`, location: { city: 'Stockholm', country: 'se' } })) };
    });
    const { jobs, declaredTotal } = await fetchSmartRecruitersJobs({ company: 'HMGroup', withDescriptions: false });
    expect(jobs).toHaveLength(total);
    expect(declaredTotal).toBe(total);
    expect(mockJson).toHaveBeenCalledTimes(17);
  });
});
