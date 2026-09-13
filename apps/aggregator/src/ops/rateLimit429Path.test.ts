import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry } from '../lib/http.js';
import { reportThrottle, cooldownRemainingMs } from '../lib/hostGate.js';
import { rateLimitHits, resetRateLimitSignal } from '../observability/rateLimitSignal.js';
import { BenchmarkStoppedOn429Error } from '../observability/rateLimitSignal.js';

/**
 * LE CHEMIN 429 RÉEL — pas le helper, mais `fetchWithRetry` contre un vrai serveur HTTP.
 *
 * H1 a produit trois 429 absorbés par re-tentative, chaque worker repartant de son côté. Un test qui
 * n'appellerait que la télémétrie ne prouverait pas que le vrai chemin l'invoque.
 *
 * Le transport est remplacé au niveau de `globalThis.fetch` — PAS la logique de `fetchWithRetry`, qui reste
 * celle de production. Un serveur HTTP local serait refusé par la garde SSRF, et affaiblir cette garde pour
 * un test échangerait une preuve contre un trou de sécurité : l'URL reste donc publique et plausible.
 */

const REAL_FETCH = globalThis.fetch;
let TARGET = 'https://careers.exemple-429.test/offres';
let hostSeq = 0;
let calls = 0; let retryAfter: string | null = '1';

beforeEach(() => {
  resetRateLimitSignal(); calls = 0;
  // Un hôte NEUF par test : la porte conserve `nextAllowedAt` et `gapMs` par clé, et un cooldown laissé par
  // le test précédent décalerait le suivant — il résoudrait alors sur la 2e réponse (200) sans jamais voir
  // le 429. Isoler l'état est ici une condition de validité, pas une commodité.
  TARGET = `https://careers.exemple-429-${++hostSeq}.test/offres`;
  delete process.env.P8_STOP_ON_FIRST_429;
  globalThis.fetch = (async (input: any) => {
    calls++;
    const headers = new Headers();
    if (calls === 1) {
      if (retryAfter !== null) headers.set('retry-after', retryAfter);
      return new Response('slow down', { status: 429, headers });
    }
    return new Response('{"ok":true}', { status: 200, headers });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = REAL_FETCH; });

describe('chemin 429 réel, via fetchWithRetry', () => {
  it('un vrai 429 appelle la télémétrie et conserve Retry-After BRUT', async () => {
    retryAfter = '1';
    const r = await fetchWithRetry(TARGET, {}, 3);
    expect(r.status).toBe(200); // la re-tentative a abouti
    const h = rateLimitHits();
    expect(h).toHaveLength(1);
    expect(h[0]!.retryAfterRaw).toBe('1');
    expect(h[0]!.appliedDelayMs).toBeGreaterThan(0);
    // La pression vient des VRAIES tentatives passées par fetchWithRetry.
    expect(h[0]!.requestsLast60s).toBeGreaterThan(0);
  }, 30_000);

  it('Retry-After en DATE HTTP est compris, pas rendu NaN', async () => {
    retryAfter = new Date(Date.now() + 1000).toUTCString();
    await fetchWithRetry(TARGET, {}, 3);
    const h = rateLimitHits()[0]!;
    expect(h.retryAfterRaw).toBe(retryAfter);
    expect(Number.isNaN(h.appliedDelayMs)).toBe(false);
    expect(h.appliedDelayMs).toBeGreaterThan(0);
  }, 30_000);

  it('en-tête ABSENT : null archivé, délai de repli borné', async () => {
    retryAfter = null;
    await fetchWithRetry(TARGET, {}, 3);
    const h = rateLimitHits()[0]!;
    expect(h.retryAfterRaw).toBeNull();
    expect(h.appliedDelayMs).toBeGreaterThan(0);
    expect(h.appliedDelayMs).toBeLessThanOrEqual(90_000);
  }, 60_000);

});

describe('P8_STOP_ON_FIRST_429 — arrêt franc du passage de mesure', () => {
  it('le premier 429 interrompt réellement, sans nouvelle sollicitation', async () => {
    process.env.P8_STOP_ON_FIRST_429 = '1';
    let n = 0;
    // Un transport qui rend TOUJOURS 429 : si l'arrêt ne fonctionnait pas, on verrait plusieurs appels.
    globalThis.fetch = (async () => {
      n++;
      const h = new Headers(); h.set('retry-after', '1');
      return new Response('slow down', { status: 429, headers: h });
    }) as typeof fetch;
    await expect(fetchWithRetry('https://careers.exemple-stop.test/x', {}, 3))
      .rejects.toThrow(BenchmarkStoppedOn429Error);
    expect(n).toBe(1);
    delete process.env.P8_STOP_ON_FIRST_429;
    globalThis.fetch = REAL_FETCH;
  }, 30_000);
});

describe('cooldown partagé par rateLimitKey', () => {
  it('un 429 sur une source fait attendre TOUTES les sources du tenant', () => {
    const a = 'https://stores-na-urbn.icims.com/a';
    const b = 'https://homeoffice-eu-urbn.icims.com/b';
    const autre = 'https://mecca.wd3.myworkdayjobs.com/c';
    reportThrottle(a, 5_000);
    // B est un AUTRE sous-domaine du même tenant : il hérite du cooldown.
    expect(cooldownRemainingMs(b)).toBeGreaterThan(1_000);
    // Un tenant différent continue sans pénalité.
    expect(cooldownRemainingMs(autre)).toBe(0);
  });

  it('plusieurs 429 ne RACCOURCISSENT jamais le cooldown courant', () => {
    const u = 'https://stores-na-urbn.icims.com/x';
    reportThrottle(u, 30_000);
    const long = cooldownRemainingMs(u);
    reportThrottle(u, 500); // un Retry-After plus court arrive ensuite
    expect(cooldownRemainingMs(u)).toBeGreaterThanOrEqual(long - 1_000);
  });

  it('Retry-After prime sur le backoff quand il est plus long', () => {
    const u = 'https://careers.exemple-cooldown.test/x';
    reportThrottle(u, 10_000);
    expect(cooldownRemainingMs(u)).toBeGreaterThan(5_000);
  });
});
