import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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
  it('names a posting repeated across pages, re-reads the board on a shifted grid, and still refuses completeness when the missing posting never surfaces', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => i), 25)).mockResolvedValueOnce(page([19, 20, 21, 22, 23], 0))
      // second sweep, offset 10: the shifted page shows the same rows — posting 24 is never served by the tenant
      .mockResolvedValueOnce(page([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], 0));
    const r = await fetchWorkdayJobs(config);
    // Every announced row was read (not truncated) yet one announced posting never appeared: not proven.
    expect(r.jobs).toHaveLength(24); expect(r.complete).toBe(false); expect(r.truncated).toBe(false); expect(fetchJson).toHaveBeenCalledTimes(3);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['REPEATED_IDS_ACROSS_PAGES', 'ENUMERATION_NOT_PROVEN'])); expect(r.enumeration?.issues).not.toContain('RECONCILED_BY_SECOND_SWEEP');
    expect(r.enumeration?.termination).toBe('PUBLISHER_TOTAL_ROWS_READ');
    expect(r.enumeration?.pageEvidence?.[1]?.componentCounters).toContain('repeated=1');
    expect(r.enumeration?.pageEvidence?.[2]?.componentCounters).toContain('sweep=2');
  });
  it("Levi's (2026-09-10): a posting that slid between two page boundaries is caught by the shifted grid — every announced row accounted for, board proven, repetition still named", async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => i), 25)).mockResolvedValueOnce(page([19, 20, 21, 22, 23], 0))
      // second sweep, offset 10: the shifted page contains posting 24
      .mockResolvedValueOnce(page([10, 11, 12, 13, 14, 15, 16, 17, 18, 24, 20, 21, 22, 23], 0));
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(25); expect(r.complete).toBe(true); expect(r.truncated).toBe(false); expect(fetchJson).toHaveBeenCalledTimes(3);
    expect(r.enumeration?.termination).toBe('SECOND_SWEEP_RECONCILED');
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['REPEATED_IDS_ACROSS_PAGES', 'RECONCILED_BY_SECOND_SWEEP'])); expect(r.enumeration?.issues).not.toContain('ENUMERATION_NOT_PROVEN');
    expect(r.enumeration?.pageEvidence?.[2]?.componentCounters).toContain('freshInSweep=1');
    expect(r.jobs.map((j) => j.externalId)).toContain('Sales_24');
  });
  it("parses the real Levi's Workday page shape (recorded 2026-09-10): announced total, ids from externalPath, public URL under the site", async () => {
    const real = JSON.parse(readFileSync(new URL('./fixtures/lot4-workday-levis-offset0.json', import.meta.url), 'utf8'));
    vi.mocked(fetchJson).mockResolvedValueOnce(real).mockResolvedValueOnce({ total: 0, jobPostings: [] });
    const r = await fetchWorkdayJobs({ tenant: 'levistraussandco', site: 'External', origin: 'https://levistraussandco.wd5.myworkdayjobs.com', withDescriptions: false });
    expect(r.declaredTotal).toBe(real.total); expect(r.jobs).toHaveLength(3); expect(r.complete).toBe(false);
    for (const [i, job] of r.jobs.entries()) {
      expect(job.externalId).toBe(String(real.jobPostings[i].externalPath).split('/').filter(Boolean).pop());
      expect(job.url).toBe(`https://levistraussandco.wd5.myworkdayjobs.com/External${real.jobPostings[i].externalPath}`);
      expect(job.title).toBe(real.jobPostings[i].title);
    }
  });
  it('keeps reading a short page while the publisher announces more, and counts rows without a path', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page(Array.from({ length: 20 }, (_, i) => i), 41)).mockResolvedValueOnce({ total: 0, jobPostings: [...[20, 21, 22].map(posting), { title: 'No path' } as any] }).mockResolvedValueOnce(page(Array.from({ length: 17 }, (_, i) => 23 + i), 0));
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(40); expect(r.complete).toBe(true); expect(fetchJson).toHaveBeenCalledTimes(3);
    expect(r.enumeration?.issues).toEqual(['ROWS_WITHOUT_EXTERNAL_PATH']); expect(r.enumeration?.termination).toBe('PUBLISHER_TOTAL_ROWS_READ');
    expect(r.rejectedRows).toEqual([{ reason: 'ROW_WITHOUT_EXTERNAL_PATH', raw: { title: 'No path' } }]);
  });
  it('Nordstrom: every announced row read, three of them without a path — proven, with the rejected rows as witnesses', async () => {
    const rows = [...Array.from({ length: 17 }, (_, i) => posting(i)), { title: 'a' }, { title: 'b' }, { title: 'c' }] as any[];
    vi.mocked(fetchJson).mockResolvedValueOnce({ total: 20, jobPostings: rows });
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(17); expect(r.declaredTotal).toBe(20); expect(r.complete).toBe(true); expect(r.truncated).toBe(false); expect(r.rejectedRows).toHaveLength(3);
  });
  it('Mango (2026-09-10): the same path-less row served on two pages is ONE announced row — reconciled by the second sweep, proven', async () => {
    const pathless = { title: 'Fix-Term', bulletFields: ['Fix-Term'] } as any;
    // 25 announced: 19 postings + the path-less row on page 1; page 2 repeats posting 18 and the same path-less row, and misses posting 23; the shifted sweep finds it.
    vi.mocked(fetchJson)
      .mockResolvedValueOnce({ total: 25, jobPostings: [...Array.from({ length: 19 }, (_, i) => posting(i)), pathless] })
      .mockResolvedValueOnce({ total: 0, jobPostings: [posting(18), posting(19), posting(20), posting(21), posting(22), pathless] })
      .mockResolvedValueOnce({ total: 0, jobPostings: [posting(10), posting(11), posting(12), posting(13), posting(14), posting(15), posting(16), posting(17), posting(18), posting(19), posting(20), posting(21), posting(22), posting(23)] });
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(24); expect(r.rejectedRows).toHaveLength(2); expect(r.complete).toBe(true);
    expect(r.enumeration?.termination).toBe('SECOND_SWEEP_RECONCILED'); expect(r.enumeration?.issues).not.toContain('ENUMERATION_NOT_PROVEN');
  });
  it('without an announced total, a short page ends the board and nothing is proven', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([1, 2, 3]));
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(3); expect(r.complete).toBe(false); expect(r.enumeration?.termination).toBe('SHORT_PAGE'); expect(r.declaredTotal).toBeUndefined();
  });
});
