import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { fetchPhenomJobs } from './phenom.js';

/** Foot Locker, 2026-09-09 : 2 836 lues pour 2 847 déclarées — une page courte au milieu du board arrêtait la lecture. */
const entry = (id: number) => ({ data: { jobId: String(id), title: `Sales Associate ${id}`, city: 'Paris', country: 'France', country_code: 'FR', applyUrl: `https://careers.example.com/job/${id}` } });
const page = (ids: number[], total: number) => ({ jobs: ids.map(entry), totalCount: total });
beforeEach(() => vi.resetAllMocks());

describe('Phenom — énumération prouvée contre le total éditeur', () => {
  it('continue après une page courte tant que le total n’est pas atteint, puis prouve l’énumération', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => i), 205))
      .mockResolvedValueOnce(page(Array.from({ length: 95 }, (_, i) => 100 + i), 205))   // page allégée : 5 entrées de moins
      .mockResolvedValueOnce(page(Array.from({ length: 10 }, (_, i) => 195 + i), 205));
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.jobs).toHaveLength(205); expect(r.declaredTotal).toBe(205); expect(r.complete).toBe(true); expect(r.truncated).toBe(false);
    expect(r.enumeration?.termination).toBe('PUBLISHER_TOTAL_REACHED'); expect(r.enumeration?.pages).toBe(3);
  });
  it('n’annonce pas complet quand le board se répète avant le total, ni quand le total change', async () => {
    const same = page(Array.from({ length: 100 }, (_, i) => i), 300);
    vi.mocked(fetchJson).mockResolvedValueOnce(same).mockResolvedValueOnce({ ...same, totalCount: 301 });
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.jobs).toHaveLength(100); expect(r.complete).toBe(false); expect(r.truncated).toBe(true);
    expect(r.enumeration?.termination).toBe('REPEATED_PAGE'); expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['SOURCE_TOTAL_CHANGED', 'ENUMERATION_NOT_PROVEN']));
  });
  it('sans total éditeur, une page courte termine la lecture et rien n’est prouvé', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({ jobs: [entry(1), entry(2)] });
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.jobs).toHaveLength(2); expect(r.complete).toBe(false); expect(r.enumeration?.termination).toBe('SHORT_PAGE');
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
});
