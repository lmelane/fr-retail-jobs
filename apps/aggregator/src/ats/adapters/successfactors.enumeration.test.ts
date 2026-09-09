import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn(), fetchJson: vi.fn() }));
import { fetchJson, fetchText } from '../../lib/http.js';
import { fetchRmkV2Jobs, fetchSuccessFactorsResult, parseSuccessFactorsPagination, parseMicrodataDetail } from './successfactors.js';
const text = vi.mocked(fetchText), json = vi.mocked(fetchJson);
const listing = (start: number, end: number, total: number) => `<span class="paginationLabel">Results <b>${start} – ${end}</b> of <b>${total}</b></span>` + Array.from({ length: end - start + 1 }, (_, i) => `<a href="/job/Paris-Advisor/${start + i}/">Advisor</a>`).join('');
describe('SAP enumeration evidence', () => {
  beforeEach(() => vi.resetAllMocks());
  it('uses the 50-row window declared by the publisher instead of a fixed offset of 25', async () => {
    text.mockResolvedValueOnce(listing(1, 50, 100)).mockResolvedValueOnce(listing(51, 100, 100));
    const r = await fetchSuccessFactorsResult({ origin: 'https://jobs.example.com', withDescriptions: false });
    expect(r.jobs).toHaveLength(100); expect(r.complete).toBe(true);
    expect(text.mock.calls[1][0]).toContain('startrow=50');
    expect(r.enumeration).toMatchObject({ pages: 2, termination: 'PUBLISHER_TOTAL_REACHED' });
  });
  it('reads both observed SAP pagination components without counting unrelated page numbers', () => {
    expect(parseSuccessFactorsPagination('<span id="tile-search-results-label">Showing 1 to 50 of 130 Jobs</span>')).toEqual({ start: 1, end: 50, total: 130 });
    expect(parseSuccessFactorsPagination('<span class="paginationLabel">Ergebnisse <b>1 – 50</b> von <b>1.075</b></span>')).toEqual({ start: 1, end: 50, total: 1075 });
    expect(parseSuccessFactorsPagination('<body>Copyright 2026, 500 employees, 20 jobs</body>')).toBeNull();
  });
  it('retains all collected postings and records a total that changes during pagination', async () => {
    text.mockResolvedValueOnce(listing(1, 2, 4)).mockResolvedValueOnce(listing(3, 5, 5));
    const r = await fetchSuccessFactorsResult({ origin: 'https://jobs.example.com', withDescriptions: false });
    expect(r.jobs).toHaveLength(5); expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toContain('SOURCE_TOTAL_CHANGED');
  });
  it('cannot certify a repeating page as complete when the publisher announces more jobs', async () => {
    text.mockResolvedValue(listing(1, 2, 5));
    const r = await fetchSuccessFactorsResult({ origin: 'https://jobs.example.com', withDescriptions: false });
    expect(r.complete).toBe(false); expect(r.jobs).toHaveLength(2);
    expect(r.enumeration?.termination).toBe('REPEATED_PAGE');
  });
  it('does not silently turn a failed RMK endpoint into an empty successful feed', async () => {
    text.mockResolvedValue('<html>Temporarily unavailable</html>');
    json.mockRejectedValue(new Error('HTTP 503'));
    await expect(fetchSuccessFactorsResult({ origin: 'https://jobs.example.com', withDescriptions: false })).rejects.toThrow('503');
  });
  it('validates language totals separately because translated jobs overlap', async () => {
    const item = (id: number) => ({ response: { id, unifiedStandardTitle: 'Advisor', urlTitle: 'Advisor' } });
    json.mockResolvedValueOnce({ totalJobs: 2, jobSearchResult: [item(1), item(2)] })
      .mockResolvedValueOnce({ totalJobs: 1, jobSearchResult: [item(1)] });
    const r = await fetchRmkV2Jobs('https://jobs.example.com', ['en_GB', 'fr_FR']);
    expect(r.complete).toBe(true); expect(r.jobs).toHaveLength(2); expect(r.declaredTotal).toBeUndefined();
    expect(r.enumeration?.scopes?.map(s => s.declaredTotal)).toEqual([2, 1]);
  });
  it('rejects an RMK error document and preserves a malformed row as evidence', async () => {
    json.mockResolvedValueOnce({ error: 'unavailable' });
    await expect(fetchRmkV2Jobs('https://jobs.example.com', ['en_GB'])).rejects.toThrow('INVALID_LIST_RESPONSE');
    json.mockResolvedValue({ totalJobs: 1, jobSearchResult: [{ response: { id: 1 } }] });
    const r = await fetchRmkV2Jobs('https://jobs.example.com', ['en_GB']);
    expect(r.complete).toBe(false); expect(r.rejectedRows).toHaveLength(1);
  });
  it('passes the source hiring organization into identity resolution, with its field provenance', () => {
    expect(parseMicrodataDetail('<meta content="PUIG, S.L." itemprop="hiringOrganization">')).toMatchObject({ company: 'PUIG, S.L.', employerEvidence: { rawName: 'PUIG, S.L.', path: 'microdata.hiringOrganization' } });
    expect(parseMicrodataDetail('<meta content="A" itemprop="hiringOrganization"><meta content="B" itemprop="hiringOrganization">').company).toBeUndefined();
  });
  it('recognizes the observed native zero-job locale without accepting a missing list for a nonzero count', async () => {
    json.mockResolvedValueOnce({ totalJobs: 0 });
    expect(await fetchRmkV2Jobs('https://jobs.example.com', ['en_US'])).toMatchObject({ jobs: [], complete: true });
    json.mockResolvedValueOnce({ totalJobs: 10 });
    await expect(fetchRmkV2Jobs('https://jobs.example.com', ['en_US'])).rejects.toThrow('INVALID_LIST_RESPONSE');
  });
});
