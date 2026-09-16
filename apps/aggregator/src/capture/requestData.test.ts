import { afterEach, expect, it, vi } from 'vitest';
import { digestBytes, describeRequest, requestFingerprint, withCaptureContext, type CaptureRecord } from './context.js';
import { logicalRequestFingerprint, observedHop, validateRequestData, type RequestData } from './requestData.js';
import { fetchFollowingSafely, fetchWithRetry } from '../lib/http.js';
import { CRAWLER_IDENTITY } from '../lib/crawlerIdentity.js';

const gate = vi.hoisted(() => ({ before: null as (() => void) | null }));
vi.mock('../lib/hostGate.js', () => ({ withHostGate: async (_url: string, run: () => Promise<unknown>) => { gate.before?.(); return run(); }, reportThrottle: () => {}, reportSuccess: () => {} }));
afterEach(() => { gate.before = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const url = 'https://request-proof.example/search?token=private-query#jobs';
const logical = { url, method: 'POST', body: 'private-request-body', headers: { authorization: 'private-auth', cookie: 'private-cookie', 'x-api-key': 'private-key' }, format: 'HTTP_RESPONSE' as const };
async function collect(run: () => Promise<unknown>) {
  const records: CaptureRecord[] = [];
  await withCaptureContext({ sequence: 0, write: async row => { validateRequestData(row.requestData); records.push(row); } }, run);
  return records;
}
const envelope = (): RequestData => {
  const request = describeRequest({ url: 'https://request-proof.example/', format: 'HTTP_RESPONSE' });
  return { version: 1, logical: request, origin: 'HTTP_TRANSPORT', hops: [observedHop(structuredClone(request), new Response('ok'))] };
};

it('preserves the historical logical key while recording actual identity, defaults and POST to GET redirection', async () => {
  const sent: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, init: { ...init, headers: new Headers(init.headers) } });
    return sent.length === 1 ? new Response('redirect-body', { status: 302, headers: { location: 'https://target-proof.example/jobs?market=DE' } }) : new Response('final-native-body');
  }));
  const [row] = await collect(async () => { expect(await (await fetchWithRetry(url, logical, 1)).text()).toBe('final-native-body'); });
  expect(sent).toHaveLength(2); expect(row.requestHash).toBe(requestFingerprint(logical));
  expect(row.requestHash).toBe(digestBytes(JSON.stringify(['HTTP_RESPONSE', 'POST', url, digestBytes(logical.body), [['accept', null], ['accept-language', null], ['content-type', null]]])));
  expect(row.requestData.hops.map(h => h.request.method)).toEqual(['POST', 'GET']);
  row.requestData.hops.forEach((hop, i) => {
    const target = new URL(sent[i].url); target.hash = '';
    expect(hop.request).toEqual(describeRequest({ ...sent[i].init, url: target.toString(), format: 'HTTP_RESPONSE' }));
  });
  expect(row.requestData.hops[0].request).toMatchObject({ userAgent: CRAWLER_IDENTITY,
    negotiation: { accept: '*/*', 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7', 'content-type': 'text/plain;charset=UTF-8' } });
  expect(row.requestData.hops[1].request).toMatchObject({ bodyHash: digestBytes(''), negotiation: { 'content-type': null } });
  const finalHeaders = new Headers(sent[1].init.headers);
  for (const name of ['authorization', 'cookie', 'x-api-key']) expect(finalHeaders.has(name)).toBe(false);
  for (const secret of ['private-request-body', 'private-auth', 'private-cookie', 'private-key']) expect(JSON.stringify(row.requestData)).not.toContain(secret);
  expect(row.requestData.logical.url).toContain('private-query'); expect(row.requestUrl).not.toContain('private-query');
});

it('preserves an explicit locale and a 307 request body byte hash on same-origin redirects', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 307, headers: { location: '/again' } })).mockResolvedValueOnce(new Response('ok'));
  vi.stubGlobal('fetch', fetch);
  const [row] = await collect(() => fetchWithRetry(url, { method: 'POST', body: new URLSearchParams({ q: 'é' }), headers: { 'accept-language': 'ja-JP', accept: 'application/json' } }, 1));
  expect(row.requestData.hops).toHaveLength(2);
  for (const hop of row.requestData.hops) expect(hop.request).toMatchObject({ method: 'POST', bodyHash: digestBytes('q=%C3%A9'), negotiation: { 'accept-language': 'ja-JP', accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' } });
});

it('records a failed physical request after a redirect without inventing a response or leaking the error message', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 302, headers: { location: '/again' } })).mockRejectedValueOnce(new TypeError('private-error-detail')));
  const records: CaptureRecord[] = [];
  await expect(withCaptureContext({ sequence: 0, write: async row => { validateRequestData(row.requestData); records.push(row); } }, () => fetchWithRetry(url, {}, 1))).rejects.toThrow('private-error-detail');
  expect(records).toHaveLength(1);
  expect(records[0].requestData.hops.map(h => [h.status, h.failure])).toEqual([[302, null], [null, 'TypeError']]);
  expect(records[0].status).toBeNull(); expect(records[0].bytes).toBeNull();
  expect(JSON.stringify(records)).not.toContain('private-error-detail');
});

it('keeps each retry separate from its redirect chain', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('ok')));
  const rows = await collect(() => fetchWithRetry(url, {}, 2));
  expect(rows.map(r => r.requestData.hops.map(h => h.status))).toEqual([[503], [200]]);
  expect(rows.map(r => r.sequence)).toEqual([0, 1]);
});

it('does not mislabel an SSRF refusal before transport as an observed HTTP request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const rows: CaptureRecord[] = [];
  await expect(withCaptureContext({ sequence: 0, write: async row => { rows.push(row); } }, () => fetchWithRetry('http://127.0.0.1/private', {}, 1))).rejects.toThrow();
  expect(rows[0].requestData).toMatchObject({ origin: 'UNOBSERVED_TRANSPORT', hops: [] }); expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ['a missing response with no failure', (e: any) => { e.hops[0].status = null; }],
  ['a derived document with unknown origin', (e: any) => { e.origin = 'UNOBSERVED_TRANSPORT'; e.hops = []; e.logical.format = 'RENDERED_DOM'; }],
  ['an unknown origin', (e: any) => { e.origin = 'ASSUMED'; }],
  ['no transport hops', (e: any) => { e.hops = []; }],
  ['a different first URL', (e: any) => { e.hops[0].request.url = 'https://different.example/'; }],
  ['a different first method', (e: any) => { e.hops[0].request.method = 'POST'; }],
  ['a different first body', (e: any) => { e.hops[0].request.bodyHash = digestBytes('different'); }],
  ['an HTTP fragment', (e: any) => { e.hops[0].request.url += '#jobs'; }],
  ['a browser origin with HTTP evidence', (e: any) => { e.origin = 'BROWSER_TRANSPORT'; }],
  ['an authentication header', (e: any) => { e.hops[0].request.negotiation.authorization = 'private'; }],
  ['a response cookie', (e: any) => { e.hops[0].responseHeaders['set-cookie'] = 'private'; }],
  ['credentials in the URL', (e: any) => { e.hops[0].request.url = 'https://user:pass@request-proof.example/'; }],
  ['too many hops', (e: any) => { e.hops = Array(7).fill(e.hops[0]); }],
  ['a disconnected next hop', (e: any) => { e.hops.push(structuredClone(e.hops[0])); }],
])('rejects %s in private request provenance', (_name, change) => {
  const value = structuredClone(envelope()); change(value); expect(() => validateRequestData(value)).toThrow();
});

it('does not let current crawler identity change a historical logical request key', () => {
  const value = envelope(); const old = logicalRequestFingerprint(value.logical);
  value.logical.userAgent = 'Future Collector/2'; expect(logicalRequestFingerprint(value.logical)).toBe(old);
});

it('preserves HEAD across a 303 even when the caller used a lowercase method', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: '/again' } })).mockResolvedValueOnce(new Response(null)));
  const [row] = await collect(() => fetchWithRetry(url, { method: 'head' }, 1));
  expect(row.requestData.hops.map(h => h.request.method)).toEqual(['HEAD', 'HEAD']);
});

it('caps the complete private envelope even when each header and URL is individually within bounds', () => {
  const base = 'https://bounded-request.example/' + 'x'.repeat(60000);
  const native = Array.from({ length: 6 }, (_, i) => describeRequest({ url: base + '?hop=' + i, format: 'HTTP_RESPONSE', headers: {
    'user-agent': 'a'.repeat(16000), accept: 'a'.repeat(16000), 'accept-language': 'a'.repeat(16000), 'content-type': 'a'.repeat(16000),
  } }));
  const value: RequestData = { version: 1, logical: native[0], origin: 'HTTP_TRANSPORT', hops: native.map((request, i) => observedHop(request,
    i < 5 ? new Response(null, { status: 302, headers: { location: '?hop=' + (i + 1) } }) : new Response(null))) };
  expect(() => validateRequestData(value)).toThrow('byte budget');
});

it('does not attest an HTTP call when the host queue aborts before dispatch', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const observer = vi.fn();
  gate.before = () => { throw new Error('Queue cancelled before transport'); };
  await expect(fetchFollowingSafely(url, {}, new AbortController().signal, observer)).rejects.toThrow('Queue cancelled');
  expect(fetch).not.toHaveBeenCalled(); expect(observer).not.toHaveBeenCalled();
});

it('snapshots the body at dispatch after the host queue has released the request', async () => {
  const body = new Uint8Array([65]); gate.before = () => { body[0] = 66; };
  const observer = vi.fn(); const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    expect(Buffer.from(init.body as Uint8Array).toString()).toBe('B'); return new Response('ok');
  });
  vi.stubGlobal('fetch', fetch);
  await fetchFollowingSafely(url, { method: 'POST', body }, new AbortController().signal, observer);
  expect(observer.mock.calls[0][3].bodyHash).toBe(digestBytes('B'));
});
