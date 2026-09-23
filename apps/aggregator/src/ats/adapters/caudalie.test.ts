import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withCaptureContext, type CaptureRecord } from '../../capture/context.js';
import { fetchCaudalieJobs, parseCaudalieListing, readCaudalieRaw } from './caudalie.js';

vi.mock('../../lib/hostGate.js', () => ({ withHostGate: async (_url: string, run: () => Promise<unknown>) => run(), reportThrottle: () => {}, reportSuccess: () => {} }));

const origin = 'https://caudalie.career';
const endpoint = `${origin}/home/ajax_filter_offers`;
const listingUrl = `${origin}/home/our-job-offers`;
const observedAt = new Date('2026-09-23T11:00:00.000Z');
// Native shape retained from the public AJAX listing. Text is a short fixture.
const offer = { slug: 'BWZRMW', title: 'PERMANENT JOB - BEAUTY EXPERT, LONDON (PART TIME)',
  is_new: true, location: 'Europe (except France)', contract_type: 'Indefinite-term contract' };
const other = { ...offer, slug: 'ABC123', title: 'Second native offer' };
const listing = (rows: unknown[] = [offer, other]) => ({ status: 'success', code: 200, results: rows });
const page = (row = offer) => `<html><head><meta property="og:url" content="${origin}/apply/offer/${row.slug}"></head><body>
  <section id="page-container"><h1>${row.title}</h1><div><p>Caudalie UK LTD is looking for a beauty expert.</p>
  <p>Area: London. Start in October 2026. Native description &amp; responsibilities.</p></div></section>
  <section><h2>Application</h2><form><input name="email"><p>APPLICATION CONSENT MUST NOT BE JOB TEXT</p></form></section></body></html>`;

beforeEach(() => vi.stubEnv('PIPELINE_PAUSED', '0'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function network(rows: unknown[] = [offer, other]) {
  const mock = vi.fn(async (url: string, init: RequestInit) => {
    expect(new URL(url).origin).toBe(origin);
    if (url === endpoint) {
      expect(init.method).toBe('POST');
      expect(new URLSearchParams(String(init.body))).toEqual(new URLSearchParams({
        'offerFilter[profession]': '', 'offerFilter[contract_type]': '', 'offerFilter[location]': '',
      }));
      return new Response(JSON.stringify(listing(rows)), { headers: { 'content-type': 'application/json' } });
    }
    const row = [offer, other].find(row => url === `${origin}/apply/offer/${row.slug}`);
    if (!row) throw new Error('Unexpected endpoint');
    return new Response(page(row), { headers: { 'content-type': 'text/html' } });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('Caudalie native listing and retained HTML', () => {
  it('captures actual transport, replays without network and recovers the same jobs from retained RAW', async () => {
    const { fetchGenericJsonLdJobs } = await import('./genericJsonLd.js');
    const { recoverRetainedPublication } = await import('../../publication/recovery.js');
    const fetch = network();
    const records: CaptureRecord[] = [];
    const live = await withCaptureContext({ sequence: 0, observedAt, write: async row => { records.push(row); } },
      () => fetchGenericJsonLdJobs({ reader: 'caudalie-ajax', startUrl: listingUrl }));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(records).toHaveLength(3);
    expect(records.map(row => row.method).sort()).toEqual(['GET', 'GET', 'POST']);
    expect(records.every(row => row.complete && row.bytes && row.requestData.origin === 'HTTP_TRANSPORT')).toBe(true);
    const retained = new Map(records.map(row => [row.requestHash, row]));
    fetch.mockImplementation(async () => { throw new Error('Replay tried to use the network'); });
    const replay = await withCaptureContext({ sequence: 0, observedAt, replay: async hash => {
      const row = retained.get(hash); if (!row) throw new Error('Missing captured response'); return row;
    } }, () => fetchCaudalieJobs({ startUrl: listingUrl }));
    expect(replay).toEqual(live);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(live.jobs.map(job => readCaudalieRaw(JSON.parse(JSON.stringify(job.raw))))).toEqual(live.jobs);
    expect(live.enumeration?.pageEvidence?.[0].canonicalIds).toEqual(['BWZRMW', 'ABC123']);
    expect(live.complete).toBe(true);
    for (const job of live.jobs) {
      const result = recoverRetainedPublication('generic-listing', JSON.parse(JSON.stringify(job.raw)),
        { externalId: job.externalId, url: job.url, observedAt, config: { reader: 'caudalie-ajax', startUrl: listingUrl } });
      expect(result.status).toBe('RECOVERABLE');
      if (result.status === 'RECOVERABLE') expect(result.job.description).toBe(job.description);
    }
    expect(live.jobs[0]).toMatchObject({ externalId: 'BWZRMW', location: undefined, contract: 'Indefinite-term contract' });
    for (const field of ['country', 'city', 'postedAt', 'company', 'workingTime']) expect(live.jobs[0]).not.toHaveProperty(field);
    expect(live.jobs[0].description).toContain('Native description & responsibilities.');
    expect(live.jobs[0].description).not.toContain('APPLICATION CONSENT');
    expect((live.jobs[0].raw as any).detailHtml).toContain('APPLICATION CONSENT');
  });

  it.each(['Europe (sauf France)', 'Europe (except France)', 'Amériques', 'Asie / Pacifique', 'Unknown zone'])('does not turn the native zone %s into a geographic point or country', async location => {
    const { resolveGeography } = await import('../../normalize/geography.js');
    const raw = { source: 'caudalie-ajax-v1', listing: { ...offer, location }, pageUrl: `${origin}/apply/offer/${offer.slug}`, detailHtml: page() };
    const job = readCaudalieRaw(raw)!;
    expect(job.location).toBeUndefined();
    expect(job.raw).toEqual(raw);
    expect(resolveGeography({ location: job.location, rawCountry: job.country, city: job.city }).countryCode).toBeUndefined();
  });

  it('retains the native France zone, which denotes one explicit country', () => {
    const job = readCaudalieRaw({ source: 'caudalie-ajax-v1', listing: { ...offer, location: 'France' }, pageUrl: `${origin}/apply/offer/${offer.slug}`, detailHtml: page() });
    expect(job?.location).toBe('France');
  });

  it.each([null, {}, { status: 'error', code: 200, results: [] }, { status: 'success', code: 500, results: [] },
    { status: 'success', code: 200, results: {} }, listing([{}]), listing([{ ...offer, slug: '../foreign' }]),
    listing([{ ...offer, slug: 'https://other.example/job' }]), listing([offer, offer])])('refuses malformed/error/duplicate native lists %#', value => {
    expect(() => parseCaudalieListing(value)).toThrow();
  });

  it('accepts only an explicit native successful empty response', async () => {
    const fetch = network([]);
    const result = await fetchCaudalieJobs();
    expect(result.jobs).toEqual([]); expect(result.complete).toBe(true); expect(result.declaredTotal).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    '<h1>Login</h1>',
    page().replace(offer.title, 'Different offer'),
    page().replace(`${origin}/apply/offer/${offer.slug}`, 'https://other.example/job'),
    page().replace('<div><p>', '<div><input name="token"><p>'),
  ])('refuses unrelated or application-only detail HTML %#', detailHtml => {
    expect(readCaudalieRaw({ source: 'caudalie-ajax-v1', listing: offer, pageUrl: `${origin}/apply/offer/${offer.slug}`, detailHtml })).toBeNull();
  });

  it('does not claim success when a detail is not the expected native offer', async () => {
    const fetch = network([offer]);
    fetch.mockImplementation(async url => url === endpoint ? new Response(JSON.stringify(listing([offer]))) : new Response('<h1>Unavailable</h1>'));
    await expect(fetchCaudalieJobs()).rejects.toThrow('CAUDALIE_INVALID_DETAIL');
  });

  it('fails before any transport on pause, foreign configuration or unbounded concurrency', async () => {
    const fetch = network();
    await expect(fetchCaudalieJobs({ startUrl: 'https://other.example/jobs' })).rejects.toThrow('CAUDALIE_INVALID_LISTING_URL');
    await expect(fetchCaudalieJobs({ detailConcurrency: 100 })).rejects.toThrow('CAUDALIE_INVALID_CONCURRENCY');
    vi.stubEnv('PIPELINE_PAUSED', '1');
    await expect(fetchCaudalieJobs()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
