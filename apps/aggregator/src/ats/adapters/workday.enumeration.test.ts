import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { fetchWorkdayJobs } from './workday.js';

/** Nordstrom 1 303/1 304 and Swatch 248/249 (2026-09-09): the −1 needs a stated cause, not a bare truncation flag. */
const posting = (id: number) => ({ title: `Sales ${id}`, externalPath: `/job/Paris/Sales_${id}`, locationsText: 'Paris', postedOn: 'Posted Today', bulletFields: [`R-${id}`] });
const page = (ids: number[], total?: number) => ({ total, jobPostings: ids.map(posting) });
const config = { tenant: 't', site: 's', origin: 'https://t.wd3.myworkdayjobs.com', withDescriptions: false };
beforeEach(() => vi.resetAllMocks());

describe('Workday — enumeration proof against the announced total', () => {
  it('proves a board read to its total, page by page', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => i), 25)).mockResolvedValueOnce(page([20, 21, 22, 23, 24], 0));
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(25); expect(r.declaredTotal).toBe(25); expect(r.complete).toBe(true); expect(r.truncated).toBe(false);
    expect(r.enumeration).toMatchObject({ pages: 2, termination: 'PUBLISHER_TOTAL_REACHED', issues: [] });
    expect(r.enumeration?.pageEvidence?.map((p) => p.publisherCounter)).toEqual(['total=25', '']);
  });
  it('names a posting repeated across pages as the cause of a missing one, and does not claim completeness', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => i), 25)).mockResolvedValueOnce(page([19, 20, 21, 22, 23], 0));
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(24); expect(r.complete).toBe(false); expect(r.truncated).toBe(true); expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['REPEATED_IDS_ACROSS_PAGES', 'ENUMERATION_NOT_PROVEN'])); expect(r.enumeration?.termination).toBe('PUBLISHER_TOTAL_ROWS_READ');
    expect(r.enumeration?.pageEvidence?.[1]?.componentCounters).toContain('repeated=1');
  });
  it('keeps reading a short page while the publisher announces more, and counts rows without a path', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => i), 41)).mockResolvedValueOnce({ total: 0, jobPostings: [...[20, 21, 22].map(posting), { title: 'No path' } as any] }).mockResolvedValueOnce(page(Array.from({ length: 18 }, (_, i) => 23 + i), 0));
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(41); expect(r.complete).toBe(true); expect(fetchJson).toHaveBeenCalledTimes(3);
    expect(r.enumeration?.issues).toEqual(['ROWS_WITHOUT_EXTERNAL_PATH']); expect(r.enumeration?.termination).toBe('PUBLISHER_TOTAL_REACHED');
  });
  it('without an announced total, a short page ends the board and nothing is proven', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([1, 2, 3]));
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(3); expect(r.complete).toBe(false); expect(r.enumeration?.termination).toBe('SHORT_PAGE'); expect(r.declaredTotal).toBeUndefined();
  });
});
