import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchText, fetchWithRetry, HttpStatusError, readBytesBounded } from './http.js';
import { withSourceBudget } from './sourceBudget.js';

/**
 * Audit A2 (2026-09-06), preuve exécutée : un 404 était rejoué 3 fois
 * (3,9 s) parce que l'erreur était levée dans le `try` du retry. Un statut
 * définitif coûte UN appel.
 */
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchWithRetry — statuts définitifs', () => {
  it('cancels an oversized stream instead of buffering it indefinitely', async () => {
    let cancelled = false;
    const block = new Uint8Array(8_000_000);
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(block); }, cancel() { cancelled = true; } });
    await expect(readBytesBounded(new Response(stream), 'https://example.com/huge')).rejects.toThrow('body over');
    expect(cancelled).toBe(true);
  });
  it('strips credentials and custom API keys across origins, and drops redirected POST bodies', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://other.example/jobs' } }))
      .mockResolvedValueOnce(new Response('ok'));
    await fetchText('https://redirect.example/jobs', { method: 'POST', body: 'private-data',
      headers: { authorization: 'Bearer secret', cookie: 'private=1', 'x-api-key': 'key', 'content-type': 'text/plain' } });
    const options = fetchMock.mock.calls[1][1] as RequestInit;
    expect(options.method).toBe('GET');
    expect(options.body).toBeUndefined();
    const headers = new Headers(options.headers);
    for (const key of ['authorization', 'cookie', 'x-api-key', 'content-type']) expect(headers.has(key)).toBe(false);
  });

  it('blocks internal redirect targets before requesting them', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }));
    await expect(fetchText('https://blocked-redirect.example/jobs')).rejects.toThrow('non-public');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight request and starts no retries after the source deadline', async () => {
    fetchMock.mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    }));
    await expect(withSourceBudget(() => fetchWithRetry('https://cancel.example/jobs'), 20, 'cancel')).rejects.toThrow('__TIMEOUT__');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('un 404 = un seul appel, erreur typée', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(fetchText('https://example.com/dead')).rejects.toBeInstanceOf(HttpStatusError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un 503 reste rejoué', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(new Response('<html>ok</html>', { status: 200 }));
    expect(await fetchText('https://example.com/flaky')).toBe('<html>ok</html>');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
