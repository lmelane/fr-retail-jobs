import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn() }));
import { fetchText } from '../../lib/http.js';
import { fetchGenericJsonLdJobs, parseListingCount } from './genericJsonLd.js';

/**
 * Real listing responses recorded on 2026-09-10 (fixtures/lot4-generic-*): three boards
 * the A1 re-probes left "BROKEN_PAGER_REPEATS_LAST_PAGE". Detail pages are mocked
 * (a minimal JobPosting per link): the enumeration proof is about the LISTING.
 */
const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const detail = (url: string) => `<html><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: `Job ${url.split('/').pop()}`, datePosted: '2026-09-01', description: 'Real detail pages are not part of this proof.', hiringOrganization: { '@type': 'Organization', name: 'Employer' }, jobLocation: { '@type': 'Place', address: { addressLocality: 'Hamburg', addressCountry: 'DE' } } })}</script></html>`;
const serve = (listing: (url: string) => string | undefined) => vi.mocked(fetchText).mockImplementation(async (url: string) => { const page = listing(url); if (page !== undefined) return page; return detail(url); });
beforeEach(() => vi.resetAllMocks());

describe('publisher count printed on a listing page', () => {
  it('reads Beiersdorf\'s data-result-count and Luxexperience\'s "54 open positions"; invents nothing on Globus', () => {
    expect(parseListingCount(fx('lot4-generic-beiersdorf-p1.html'))).toBe(135);
    expect(parseListingCount(fx('lot4-generic-luxexperience-p1.html'))).toBe(54);
    expect(parseListingCount(fx('lot4-generic-globus-p1.html'))).toBeUndefined();
    expect(parseListingCount('<div data-result-count="135">', 'data-result-count="')).toBe(135);
  });
});

describe('Beiersdorf (real pages 1–15): the pager clamps to its last five links after the 135 announced', () => {
  const base = 'https://www.beiersdorf.com/ajax/Jobboard/JobResultAjax?db=web&lang=en';
  const listing = (url: string) => { const m = /[?&]page=(\d+)$/.exec(url); return m ? fx(`lot4-generic-beiersdorf-p${Math.min(Number(m[1]), 15)}.html`) : undefined; };
  it('with the English-only pattern, 109 links of 135 are listed: repeated page, below the publisher count, not proven — the gap is named', async () => {
    serve(listing);
    const r = await fetchGenericJsonLdJobs({ listingUrl: base, linkPattern: 'career/jobs/', pageParam: 'page', pageStart: 1, maxPages: 40 });
    expect(r.declaredTotal).toBe(135); expect(r.jobs).toHaveLength(109); expect(r.complete).toBe(false); expect(r.truncated).toBe(true);
    expect(r.enumeration?.termination).toBe('REPEATED_PAGE');
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['BROKEN_PAGER_REPEATS_LAST_PAGE', 'LINKS_BELOW_PUBLISHER_COUNT=109/135', 'ENUMERATION_NOT_PROVEN']));
  });
  it('with both URL fragments (career/jobs/|karriere/jobs/), every announced link is listed by page 14 and the clamped page 15 ends the board: proven', async () => {
    serve(listing);
    const r = await fetchGenericJsonLdJobs({ listingUrl: base, linkPattern: 'career/jobs/|karriere/jobs/', pageParam: 'page', pageStart: 1, maxPages: 40 });
    expect(r.declaredTotal).toBe(135); expect(r.jobs).toHaveLength(135); expect(r.complete).toBe(true); expect(r.truncated).toBe(false);
    expect(r.enumeration?.termination).toBe('PUBLISHER_COUNT_REACHED'); expect(r.enumeration?.pages).toBe(15); expect(r.enumeration?.issues).toEqual([]);
    expect(r.enumeration?.scopes?.[0]).toMatchObject({ scope: 'publisherCount', declaredTotal: 135, uniqueIds: 135, complete: true });
  });
});

describe('Globus (real pages 1–2): the listing ignores the page parameter', () => {
  it('a byte-identical second page is an unpaginated listing read in full: proven on its 22 links', async () => {
    serve((url) => /page=1$/.test(url) ? fx('lot4-generic-globus-p1.html') : /page=2$/.test(url) ? fx('lot4-generic-globus-p2.html') : undefined);
    const r = await fetchGenericJsonLdJobs({ listingUrl: 'https://jobs.globus.ch/offre-emplois.html', linkPattern: '-j', pageParam: 'page', pageStart: 1, maxPages: 2 });
    expect(r.jobs).toHaveLength(22); expect(r.declaredTotal).toBe(22); expect(r.complete).toBe(true); expect(r.truncated).toBe(false);
    expect(r.enumeration?.termination).toBe('IDENTICAL_PAGE'); expect(r.enumeration?.pages).toBe(2);
  });
  it('a repeated page that is NOT byte-identical and carries no count is still a broken pager', async () => {
    const p1 = fx('lot4-generic-globus-p1.html');
    serve((url) => /page=1$/.test(url) ? p1 : /page=2$/.test(url) ? p1.replace('<html', '<html data-served="2"') : undefined);
    const r = await fetchGenericJsonLdJobs({ listingUrl: 'https://jobs.globus.ch/offre-emplois.html', linkPattern: '-j', pageParam: 'page', pageStart: 1, maxPages: 2 });
    expect(r.jobs).toHaveLength(22); expect(r.complete).toBe(false); expect(r.enumeration?.termination).toBe('REPEATED_PAGE');
  });
});

describe('Luxexperience (real page 1, 54 announced, 9 per page): the 6th page repeats after the count is met', () => {
  it('a repeated page once every announced link is seen ends the board: proven', async () => {
    const p1 = fx('lot4-generic-luxexperience-p1.html');
    const linksOf = (n: number) => Array.from({ length: 9 }, (_, i) => `<a href="/open-positions/job-detail/synthetic-${n}-${i}">x</a>`).join('');
    // Pages 2–6 carry nine further links each (the real pages have the same shape); page 7 answers page 6 again.
    serve((url) => { const m = /page=(\d+)$/.exec(url); if (!m) return undefined; const n = Number(m[1]); return n === 1 ? p1 : `<html><body>${linksOf(Math.min(n, 6))}</body></html>`; });
    const r = await fetchGenericJsonLdJobs({ listingUrl: 'https://career.luxexperience.com/open-positions', linkPattern: '/open-positions/job-detail/', pageParam: 'page', pageStart: 1, maxPages: 40 });
    expect(r.declaredTotal).toBe(54); expect(r.jobs).toHaveLength(54); expect(r.complete).toBe(true); expect(r.enumeration?.termination).toBe('PUBLISHER_COUNT_REACHED'); expect(r.enumeration?.pages).toBe(7);
  });
});
