import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchWithRetry: vi.fn() }));
vi.mock('../../lib/browser.js', () => ({ fetchRenderedHtml: vi.fn() }));
import { fetchJson, fetchWithRetry } from '../../lib/http.js';
import { fetchEightfoldJobs } from './eightfold.js';

/** Kering, 2026-09-09 : 1 030 lues pour 1 031 annoncées, run après run — le déficit doit être nommé. */
const position = (id: number) => ({ id, name: `Client Advisor ${id}`, positionUrl: `/careers/job/${id}`, locations: ['Paris, IDF, FR'] });
const page = (ids: number[], count: number) => ({ data: { positions: ids.map(position), count } });
const config = { origin: 'https://careers.example.com', domain: 'example.com', withDescriptions: false };
beforeEach(() => { vi.mocked(fetchJson).mockReset(); vi.mocked(fetchWithRetry).mockReset(); vi.mocked(fetchWithRetry).mockRejectedValue(new Error('no session')); });

describe('Eightfold — enumeration proof against the announced count', () => {
  it('proves a board read to its count, page by page', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 13)).mockResolvedValueOnce(page([11, 12, 13], 13));
    const r = await fetchEightfoldJobs(config);
    expect(r.jobs).toHaveLength(13); expect(r.declaredTotal).toBe(13); expect(r.complete).toBe(true); expect(r.truncated).toBe(false);
    expect(r.enumeration).toMatchObject({ pages: 2, termination: 'PUBLISHER_TOTAL_REACHED', issues: [] });
    expect(r.enumeration?.pageEvidence?.map((p) => p.publisherCounter)).toEqual(['count=13', 'count=13']);
  });
  it('names a position repeated across pages: the announced posting that never appeared is the deficit', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 13)).mockResolvedValueOnce(page([10, 11, 12], 13));
    const r = await fetchEightfoldJobs(config);
    expect(r.jobs).toHaveLength(12); expect(r.complete).toBe(false); expect(r.truncated).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['REPEATED_IDS_ACROSS_PAGES', 'ENUMERATION_NOT_PROVEN'])); expect(r.enumeration?.termination).toBe('PUBLISHER_TOTAL_ROWS_READ');
    expect(r.enumeration?.pageEvidence?.[1]?.componentCounters).toContain('repeated=1');
  });
  it('keeps reading a short page while the count announces more, and counts positions the mapper rejects', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 15)).mockResolvedValueOnce({ data: { positions: [position(11), { id: 12 } as any], count: 15 } }).mockResolvedValueOnce(page([13, 14, 15], 15));
    const r = await fetchEightfoldJobs(config);
    expect(r.jobs).toHaveLength(14); expect(fetchJson).toHaveBeenCalledTimes(3); expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['POSITIONS_WITHOUT_ID_OR_TITLE']));
  });
});
