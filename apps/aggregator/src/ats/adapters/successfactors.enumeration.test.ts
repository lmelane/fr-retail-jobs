import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn(), fetchJson: vi.fn() }));
import { fetchJson, fetchText } from '../../lib/http.js';
import { fetchRmkV2Jobs, fetchSuccessFactorsResult, parseSuccessFactorsPagination, parseMicrodataDetail } from './successfactors.js';
const text = vi.mocked(fetchText), json = vi.mocked(fetchJson);
const listing = (start: number, end: number, total: number) => `<span class="paginationLabel">Results <b>${start} – ${end}</b> of <b>${total}</b></span>` + Array.from({ length: end - start + 1 }, (_, i) => `<a href="/job/Paris-Advisor/${start + i}/">Advisor</a>`).join('');
const tiles = (label: string, total: number, size: number) => `<span id="tile-search-results-label">${label}</span><ul id="job-tile-list"></ul><script>init({apiEndpoint: "tile-search-results", jobRecordsPerPage: parseInt("${size}"), jobRecordsFound: parseInt("${total}")});</script>`;
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
    expect(parseSuccessFactorsPagination(tiles('Showing 1 to 50 of 130 Jobs', 130, 50))).toEqual({ start: 1, end: 50, total: 130 });
    expect(parseSuccessFactorsPagination('<span class="paginationLabel">Ergebnisse <b>1 – 50</b> von <b>1.075</b></span>')).toEqual({ start: 1, end: 50, total: 1075 });
    expect(parseSuccessFactorsPagination('<body>Copyright 2026, 500 employees, 20 jobs</body>')).toBeNull();
  });
  it('uses native tile counters across translated labels and the observed count-versus-end display defect', () => {
    expect(parseSuccessFactorsPagination(tiles('Showing 101 to 100 of 212 Jobs', 212, 100), 100)).toEqual({ start: 101, end: 200, total: 212 });
    expect(parseSuccessFactorsPagination(tiles('Showing 201 to 12 of 212 Jobs', 212, 100), 200)).toEqual({ start: 201, end: 212, total: 212 });
    expect(parseSuccessFactorsPagination(tiles('3 İşten 1-3 arasındakiler gösteriliyor', 3, 11))).toEqual({ start: 1, end: 3, total: 3 });
    expect(parseSuccessFactorsPagination('<span id="tile-search-results-label">3 İşten 1-3 arasındakiler gösteriliyor</span>')).toBeNull();
    expect(parseSuccessFactorsPagination(tiles('', 0, 11))).toEqual({ start: 0, end: 0, total: 0 });
  });
  it('retains page-level counter and ID witnesses for diagnosing repeated or changing results', async () => {
    text.mockResolvedValueOnce(listing(1, 2, 4)).mockResolvedValueOnce(listing(3, 4, 4));
    const r = await fetchSuccessFactorsResult({ origin: 'https://jobs.example.com', withDescriptions: false });
    expect(r.enumeration?.pageEvidence).toEqual([
      expect.objectContaining({ offset: 0, pagination: { start: 1, end: 2, total: 4 }, ids: ['1', '2'], sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ offset: 2, pagination: { start: 3, end: 4, total: 4 }, ids: ['3', '4'] }),
    ]);
  });
  /** A page that serves the given IDs under the given window and total (the shape of a shifted page). */
  const served = (start: number, end: number, total: number, ids: string[]) =>
    `<span class="paginationLabel">Results <b>${start} – ${end}</b> of <b>${total}</b></span>` + ids.map(id => `<a href="/job/Paris-Advisor/${id}/">Advisor</a>`).join('');
  /**
   * RUN du 01/10/2026, Crocs : 525 annoncées, une page à 526 qui recommence par la dernière offre de la page précédente,
   * puis de nouveau 525 ; une offre sautée à une frontière de page, 524 lues. Une seconde passe stable la retrouve.
   */
  it('relit le tableau en entier quand le total change pendant la lecture, et prouve la seconde passe seule', async () => {
    const firstPass = [served(1, 2, 6, ['1', '2']), served(3, 4, 7, ['2', '3']), served(5, 6, 6, ['5', '6']), served(5, 6, 6, ['5', '6'])];
    const freshPass = [served(1, 2, 6, ['1', '2']), served(3, 4, 6, ['3', '4']), served(5, 6, 6, ['5', '6'])];
    text.mockImplementation(async () => (firstPass.length ? firstPass : freshPass).shift()!);
    const r = await fetchSuccessFactorsResult({ origin: 'https://jobs.example.com', withDescriptions: false });
    const pass1 = r.enumeration!.pageEvidence!.filter(page => !page.url.includes('#pass=2'));
    // Prémisse : la première passe seule a bien sauté l'offre 4 sous un total changeant, sinon le témoin ne teste rien.
    expect(new Set(pass1.flatMap(page => page.ids))).toEqual(new Set(['1', '2', '3', '5', '6']));
    expect(r.complete).toBe(true); expect(r.declaredTotal).toBe(6);
    expect(r.jobs.map(job => job.externalId).sort()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(r.enumeration).toMatchObject({ termination: 'RECONCILED_BY_FRESH_PASS', pages: 7 });
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['SOURCE_TOTAL_CHANGED', 'RECONCILED_BY_FRESH_PASS']));
    // La seconde passe relit les mêmes adresses : seule la preuve les distingue.
    expect(text.mock.calls[4][0]).toBe(text.mock.calls[0][0]);
    expect(r.enumeration?.pageEvidence?.filter(page => page.url.endsWith('#pass=2'))).toHaveLength(3);
  });
  it('garde toutes les offres lues mais ne prouve rien quand le total change aussi pendant la seconde passe', async () => {
    const pages = [listing(1, 2, 4), listing(3, 5, 5), listing(1, 2, 5), listing(3, 6, 6)];
    text.mockImplementation(async () => pages.shift()!);
    const r = await fetchSuccessFactorsResult({ origin: 'https://jobs.example.com', withDescriptions: false });
    expect(r.jobs).toHaveLength(6); expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['SOURCE_TOTAL_CHANGED', 'ENUMERATION_NOT_PROVEN']));
    expect(r.enumeration?.issues).not.toContain('RECONCILED_BY_FRESH_PASS');
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
