import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn(), fetchJson: vi.fn() }));
import { fetchText } from '../../lib/http.js';
import { fetchSuccessFactorsResult, parseSuccessFactorsPagination, parsePublishedHtmlLocales } from './successfactors.js';
const text = vi.mocked(fetchText);
const listing = (start: number, end: number, total: number) => `<span class="paginationLabel">Results <b>${start} – ${end}</b> of <b>${total}</b></span>` + Array.from({ length: end - start + 1 }, (_, i) => `<a href="/job/Paris-Advisor/${start + i}/">Advisor</a>`).join('');
describe('Worldwide SAP HTML locales', () => {
  beforeEach(() => vi.resetAllMocks());
  it('reads only published same-portal locales, including country links on a global home page', () => {
    const html = '<a href="/France/?locale=fr_FR">FR</a><a href="/Italy/?locale=it_IT">IT</a>' +
      '<a href="https://other.example/?locale=de_DE">External</a><a href="/France/?locale=fr_FR">FR</a>';
    expect(parsePublishedHtmlLocales(html, 'https://jobs.example.com')).toEqual(['fr_FR', 'it_IT']);
    expect(parsePublishedHtmlLocales(html, 'https://jobs.example.com/France')).toEqual(['fr_FR']);
  });
  it('paginates each locale and unions overlapping native IDs without summing counts', async () => {
    text.mockImplementation(async raw => {
      const u = new URL(String(raw)), locale = u.searchParams.get('locale');
      if (u.pathname === '/') return '<a href="/France/?locale=fr_FR">FR</a><a href="/Italy/?locale=it_IT">IT</a>';
      if (!locale) return listing(1, 1, 1);
      if (locale === 'fr_FR') return u.searchParams.get('startrow') === '0' ? listing(1, 2, 3) : listing(3, 3, 3);
      return listing(1, 2, 2).replace('/2/', '/4/');
    });
    const r = await fetchSuccessFactorsResult({ origin: 'https://jobs.example.com', allLocales: true, withDescriptions: false });
    expect(r.jobs.map(j => j.externalId)).toEqual(['1', '2', '3', '4']);
    expect(r.complete).toBe(true); expect(r.declaredTotal).toBeUndefined();
    expect(r.enumeration?.scopes).toEqual([
      { scope: 'fr_FR', declaredTotal: 3, uniqueIds: 3, pages: 2, complete: true },
      { scope: 'it_IT', declaredTotal: 2, uniqueIds: 2, pages: 1, complete: true },
    ]);
    expect(r.enumeration?.pageEvidence?.every(p => new URL(p.url).searchParams.has('locale'))).toBe(true);
  });
  it('preserves successful languages but cannot certify the union when another language fails', async () => {
    text.mockImplementation(async raw => {
      const u = new URL(String(raw));
      if (u.pathname === '/') return '<a href="?locale=fr_FR">FR</a><a href="?locale=it_IT">IT</a>';
      if (u.searchParams.get('locale') === 'it_IT') throw new Error('HTTP 503');
      return listing(1, 1, 1);
    });
    const r = await fetchSuccessFactorsResult({ origin: 'https://jobs.example.com', allLocales: true, withDescriptions: false });
    expect(r.jobs).toHaveLength(1); expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toContain('HTML_LOCALE_FAILED:it_IT:Error: HTTP 503');
  });
  it('cannot certify all locales from a successful default listing when discovery is missing', async () => {
    text.mockResolvedValue(listing(1, 1, 1));
    const r = await fetchSuccessFactorsResult({ origin: 'https://jobs.example.com', allLocales: true, withDescriptions: false });
    expect(r.jobs).toHaveLength(1); expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toContain('NO_PUBLISHED_HTML_LOCALE_SET');
  });
  it('requires the native empty-result component, an explicit zero and the search form for an empty HTML scope', () => {
    const empty = '<div id="noresults"><div id="attention">Žádná volná pracovní místa</div>' +
      '<div id="noresults-message">0 nejnovějších pracovních míst</div></div><form name="keywordsearch"></form>';
    expect(parseSuccessFactorsPagination(empty)).toEqual({ start: 0, end: 0, total: 0 });
    expect(parseSuccessFactorsPagination(empty.replace('0 nej', '12 nej'))).toBeNull();
    expect(parseSuccessFactorsPagination(empty + '<a href="/job/Advisor/1/">Advisor</a>')).toBeNull();
    expect(parseSuccessFactorsPagination('<p>0 jobs found</p>')).toBeNull();
  });
});
