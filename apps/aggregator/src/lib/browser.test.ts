import { afterEach, describe, expect, it, vi } from 'vitest';
import { withCaptureContext, type CaptureRecord } from '../capture/context.js';
import { MAX_CAPTURE_BYTES } from '../capture/store.js';

const fixture = vi.hoisted(() => ({ listeners: new Set<(response: unknown) => void>(), responses: [] as unknown[],
  navigationError: false, launched: 0, closed: 0 }));
vi.mock('playwright', () => ({ chromium: { launch: async () => {
  fixture.launched++;
  return { close: async () => {}, newContext: async () => ({
    route: async () => {}, close: async () => { fixture.closed++; }, newPage: async () => ({
      on: (_event: string, fn: (response: unknown) => void) => { fixture.listeners.add(fn); },
      off: (_event: string, fn: (response: unknown) => void) => { fixture.listeners.delete(fn); },
      goto: async () => {
        for (const response of fixture.responses) for (const fn of fixture.listeners) fn(response);
        if (fixture.navigationError) throw new Error('Navigation interrupted');
        return { status: () => 200, url: () => 'https://example.com/careers' };
      },
      waitForTimeout: async () => {}, content: async () => '<html><body>Rendered jobs</body></html>',
    }),
  }) };
} } }));
vi.mock('./browserProxy.js', () => ({ createPublicBrowserProxy: async () => ({ url: 'http://127.0.0.1:1', close: async () => {} }) }));
vi.mock('./hostGate.js', () => ({ withHostGate: async (_url: string, work: () => Promise<unknown>) => work(), reportThrottle: () => {}, reportSuccess: () => {} }));
import { closeBrowser, fetchRenderedHtml, primeWafToken } from './browser.js';

const url = 'https://example.com/careers';
const response = (body: () => Promise<Buffer>, headers: Record<string, string> = {}) => ({
  url: () => url, status: () => 200, headers: () => headers, body,
  request: () => ({ resourceType: () => 'document', method: () => 'GET', postDataBuffer: () => null, allHeaders: async () => ({ 'user-agent': 'Observed Browser Fixture', 'accept-language': 'de-DE', cookie: 'never-archive-this' }) }),
});
afterEach(async () => { await closeBrowser(); fixture.responses = []; fixture.navigationError = false; fixture.listeners.clear(); vi.restoreAllMocks(); });

describe('browser native capture', () => {
  it('records original document bytes separately from rendered DOM and replays without a browser', async () => {
    const original = Buffer.from('<html>Initial jobs \u00e9</html>'); fixture.responses = [response(async () => original)];
    const records: CaptureRecord[] = [];
    const html = await withCaptureContext({ sequence: 0, write: async row => { records.push(row); } }, () => fetchRenderedHtml(url));
    expect(records.map(row => row.format)).toEqual(['BROWSER_RESPONSE', 'RENDERED_DOM']);
    expect(records[0].bytes).toEqual(original); expect(Buffer.from(records[1].bytes!).toString()).toBe(html);
    expect(records[0].requestData).toMatchObject({ origin: 'BROWSER_TRANSPORT', hops: [{ request: { userAgent: 'Observed Browser Fixture', negotiation: { 'accept-language': 'de-DE' } } }] });
    expect(records[1].requestData).toMatchObject({ origin: 'RENDERED_DOM', hops: [] });
    expect(JSON.stringify(records)).not.toContain('never-archive-this');
    const launched = fixture.launched;
    const replayed = await withCaptureContext({ sequence: 0, replay: async () => records[1] }, () => fetchRenderedHtml(url));
    expect(replayed).toBe(html); expect(fixture.launched).toBe(launched);
    expect(fixture.listeners.size).toBe(0);
  });

  it('drains received evidence when navigation fails and closes its context', async () => {
    fixture.navigationError = true; fixture.responses = [response(async () => { await new Promise(resolve => setTimeout(resolve, 5)); return Buffer.from('received before failure'); })];
    const records: CaptureRecord[] = []; const before = fixture.closed;
    await expect(withCaptureContext({ sequence: 0, write: async row => { records.push(row); } }, () => fetchRenderedHtml(url))).rejects.toThrow('interrupted');
    expect(records).toHaveLength(1); expect(records[0].complete).toBe(true);
    expect(fixture.closed).toBe(before + 1); expect(fixture.listeners.size).toBe(0);
  });

  it('refuses a declared oversized document before reading its body and retains a failure receipt', async () => {
    const body = vi.fn(async () => Buffer.from('unread')); fixture.responses = [response(body, { 'content-length': String(MAX_CAPTURE_BYTES + 1) })];
    const records: CaptureRecord[] = [];
    await expect(withCaptureContext({ sequence: 0, write: async row => { records.push(row); } }, () => fetchRenderedHtml(url))).rejects.toThrow('bounded');
    expect(body).not.toHaveBeenCalled(); expect(records[0]).toMatchObject({ complete: false, bytes: null });
  });

  it('propagates a failed archive write before exposing a parsed DOM', async () => {
    fixture.responses = [response(async () => Buffer.from('native'))];
    await expect(withCaptureContext({ sequence: 0, write: async () => { throw new Error('Storage unavailable'); } }, () => fetchRenderedHtml(url))).rejects.toThrow('capture unavailable');
    expect(fixture.listeners.size).toBe(0);
  });

  it('does not start a browser to prime WAF authentication during offline replay', async () => {
    const before = fixture.launched;
    const cookie = await withCaptureContext({ sequence: 0, replay: async () => { throw new Error('Unused'); } }, () => primeWafToken(url));
    expect(cookie).toBe('aws-waf-token=archive-replay'); expect(fixture.launched).toBe(before);
  });
});

it('retains an explicit unknown transport when browser request headers cannot be observed and refuses the DOM', async () => {
  const observed = response(async () => Buffer.from('body'));
  const original = observed.request();
  observed.request = () => ({ ...original, allHeaders: async () => { throw new Error('Request headers unavailable'); } });
  fixture.responses = [observed]; const records: CaptureRecord[] = [];
  await expect(withCaptureContext({ sequence: 0, write: async row => { records.push(row); } }, () => fetchRenderedHtml(url))).rejects.toThrow('Request headers unavailable');
  expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ complete: false, requestData: { origin: 'UNOBSERVED_TRANSPORT', hops: [] } });
});
