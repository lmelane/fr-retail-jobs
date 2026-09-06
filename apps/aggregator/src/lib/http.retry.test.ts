import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchText, HttpStatusError } from './http.js';

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
