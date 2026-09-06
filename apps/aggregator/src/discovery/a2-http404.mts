/**
 * a2 — preuve d'exécution : fetchWithRetry rejoue-t-il un 404 (statut non
 * transitoire) ? On remplace fetch par un compteur ; aucun réseau.
 * Usage : npx tsx src/discovery/a2-http404.mts
 */
process.env.HOST_BASE_GAP_MS = '0';
const calls: Record<string, number> = {};
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  calls[url] = (calls[url] ?? 0) + 1;
  const status = url.includes('/404') ? 404 : url.includes('/410') ? 410 : 200;
  return new Response(status === 200 ? 'ok' : 'not found', { status });
}) as typeof fetch;

const { fetchWithRetry } = await import('../lib/http.js');
const started = Date.now();
for (const path of ['/404', '/410', '/ok']) {
  const url = `https://example.com${path}`;
  const t = Date.now();
  try {
    const r = await fetchWithRetry(url);
    console.log(`${path}: HTTP ${r.status} après ${calls[url]} appel(s), ${Date.now() - t} ms`);
  } catch (e) {
    console.log(`${path}: erreur « ${(e as Error).message} » après ${calls[url]} appel(s), ${Date.now() - t} ms`);
  }
}
console.log(`total ${Date.now() - started} ms`);
globalThis.fetch = originalFetch;
