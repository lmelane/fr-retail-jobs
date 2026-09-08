import { assertSourceRunning, sourceSignal, sourceDelay } from './sourceBudget.js';
import { assertPublicUrl, isPublicHttpUrl, BlockedUrlError } from './ssrf.js';
import { withHostGate, reportThrottle, reportSuccess } from './hostGate.js';
import { getWafCookie, isWafChallenge, primeWafCookie, WafChallengeError } from './wafToken.js';
import { detectChallenge } from './responseIntegrity.js';
import { publicDispatcher } from './publicTransport.js';

export { WafChallengeError } from './wafToken.js';
export { detectChallenge, type ChallengeVendor } from './responseIntegrity.js';

/**
 * Joint le cookie WAF amorcé pour l'origine de `url`, s'il existe, aux en-têtes
 * de la requête — après un éventuel cookie déjà fourni par l'appelant.
 */
function withWafCookie(url: string, headers: Record<string, string>): Record<string, string> {
  const cookie = getWafCookie(url);
  if (!cookie) return headers;
  const existing = Object.entries(headers).find(([key]) => key.toLowerCase() === 'cookie');
  if (!existing) return { ...headers, cookie };
  return { ...headers, [existing[0]]: `${existing[1]}; ${cookie}` };
}

/** Statut HTTP définitif (4xx hors 403/405/429) : pas de nouvel essai. */
export class HttpStatusError extends Error {
  constructor(public readonly status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpStatusError';
  }
}

const timeoutMs = Number(process.env.HTTP_TIMEOUT_MS ?? 20_000);
const userAgent = process.env.USER_AGENT ?? 'CatwalksJobsBot/0.1';

/**
 * F-01 — the body read is bounded too. `response.text()` used to run OUTSIDE
 * any timeout: a host that answers headers then trickles bytes (or streams
 * gigabytes) held a worker forever. 30s and 20MB comfortably fit every real
 * payload here (largest seen: WTTJ shards, a few MB).
 */
const readTimeoutMs = Number(process.env.HTTP_READ_TIMEOUT_MS ?? 30_000);
const maxBodyBytes = Number(process.env.HTTP_MAX_BODY_BYTES ?? 20_000_000);

/**
 * Adapters' per-detail concurrency must not exceed the per-host gate (4): a
 * pLimit(8) just parks 4 extra requests in the gate queue where they burn
 * their timeout budget doing nothing (F-01).
 */
export const DEFAULT_DETAIL_CONCURRENCY = 4;

/** Reads a body with a hard time budget and a size cap. */
export async function readBytesBounded(response: Response, url: string): Promise<Buffer> {
  const body = response.body;
  // No readable stream (a 204, or a mocked Response in tests): text() is all
  // there is, and there is nothing to bound.
  if (!body) {
    const buffer = typeof response.arrayBuffer === 'function'
      ? Buffer.from(await response.arrayBuffer()) : Buffer.from(typeof response.text === 'function' ? await response.text() : '');
    if (buffer.length > maxBodyBytes) throw new Error(`body over ${maxBodyBytes} bytes for ${url}`);
    return buffer;
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  const deadline = Date.now() + readTimeoutMs;
  try {
    for (;;) {
      assertSourceRunning();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`body read timeout (${readTimeoutMs}ms) for ${url}`);
      let timer: ReturnType<typeof setTimeout>;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`body read timeout (${readTimeoutMs}ms) for ${url}`)), remaining);
        }),
      ]).finally(() => clearTimeout(timer!));
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBodyBytes) throw new Error(`body over ${maxBodyBytes} bytes for ${url}`);
      chunks.push(Buffer.from(chunk.value));
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks);
}

export async function readBodyBounded(response: Response, url: string): Promise<string> {
  return (await readBytesBounded(response, url)).toString('utf8');
}

/** Redirect hops to follow before giving up — enough for http→https→www chains. */
const MAX_REDIRECTS = 5;

/**
 * One fetch that follows redirects MANUALLY, validating every hop against the
 * SSRF guard. `redirect: 'follow'` would let a public URL redirect to an
 * internal target (169.254.169.254, localhost) unchecked; validating each
 * Location closes that.
 */
export async function fetchFollowingSafely(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  let current = url;
  let request: RequestInit = { ...init, headers: new Headers(init.headers) };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    signal.throwIfAborted();
    assertPublicUrl(current);
    const options: RequestInit = { ...request, headers: Object.fromEntries(new Headers(request.headers)),
      signal, redirect: 'manual' };
    // Node's fetch and installed undici share the dispatcher protocol, but
    // their separately versioned TypeScript declarations are not assignable.
    Object.assign(options, { dispatcher: publicDispatcher() });
    const response = await fetch(current, options);

    // 3xx with a Location -> validate and follow it ourselves.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return response;
      await response.body?.cancel();
      const next = new URL(location, current).toString();
      if (!isPublicHttpUrl(next)) throw new BlockedUrlError(next);
      if (new URL(next).origin !== new URL(current).origin) {
        // Arbitrary API keys can have custom names. Forward only negotiation headers.
        const safe = new Headers();
        for (const key of ['accept', 'accept-language', 'user-agent']) {
          const value = new Headers(request.headers).get(key);
          if (value) safe.set(key, value);
        }
        // Do not forward a credential-bearing POST body to a different origin.
        if (request.body != null && ![301, 302, 303].includes(response.status)) {
          throw new Error('Refusing cross-origin redirect with a request body');
        }
        request = { ...request, headers: safe };
      }
      if (response.status === 303 && request.method !== 'HEAD' ||
          [301, 302].includes(response.status) && request.method?.toUpperCase() === 'POST') {
        const headers = new Headers(request.headers);
        for (const key of ['content-type', 'content-length', 'transfer-encoding']) headers.delete(key);
        request = { ...request, method: 'GET', body: undefined, headers };
      }
      current = next;
      continue;
    }
    return response;
  }
  throw new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${url}`);
}

export async function fetchWithRetry(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let lastError: unknown;
  /**
   * Challenge WAF (202 vide + `x-amzn-waf-action: challenge`) : on amorce le
   * jeton de l'origine — une fois — et on accorde UNE re-tentative de plus
   * que le budget normal, avec le cookie. Un second challenge est un échec
   * franc (WafChallengeError), jamais un corps vide rendu comme une page.
   */
  let wafRetried = false;
  for (let i = 0; i < attempts + (wafRetried ? 1 : 0); i++) {
    assertSourceRunning();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Every request passes through the per-host gate — the global politeness
      // that stops us throttling a shared host (ELC, Richemont, Beaumanoir…) in
      // the first place, instead of only reacting after it blocks us.
      // F-01: the timeout clock starts AFTER the gate grants the slot — time
      // spent queued behind a backed-off host is not the request's fault, and
      // starting the timer early expired requests before they even began.
      const response = await withHostGate(url, () => {
        assertSourceRunning();
        timer = setTimeout(() => controller.abort(), timeoutMs);
        return fetchFollowingSafely(
          url,
          {
            ...init,
            headers: withWafCookie(url, {
              'user-agent': userAgent,
              'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7',
              ...Object.fromEntries(new Headers(init.headers)),
            }),
          },
          AbortSignal.any([controller.signal, ...[sourceSignal(), init.signal].filter((s): s is AbortSignal => !!s)]),
        );
      });
      if (isWafChallenge(response)) {
        await response.body?.cancel();
        if (timer) clearTimeout(timer);
        // Une requête déjà munie du jeton et pourtant challengée ne gagnera
        // rien à être rejouée à l'identique : échec immédiat.
        if (!wafRetried && !getWafCookie(url)) {
          wafRetried = true;
          // L'amorçage tourne hors de la porte d'hôte (déjà rendue) : il ouvre
          // sa propre page navigateur et passe lui-même par withHostGate.
          if (await primeWafCookie(url)) continue;
        }
        throw new WafChallengeError(url);
      }
      if (response.ok) {
        reportSuccess(url);
        return response;
      }
      await response.body?.cancel();
      /**
       * Transient statuses worth another attempt after a backoff. 403 and 405
       * are here because an anti-bot WAF returns them as a SOFT block, not a
       * real rejection: Estée Lauder's Eightfold portal answered 405 to
       * /api/pcsx/search during a heavy run and lost all 1374 offers, yet the
       * identical GET returns 200 once the throttle lifts. A genuine 403/405
       * still fails cleanly after the (capped) retries — the cost is a few
       * seconds, the gain is a whole group's offers not dropped to a blip.
       */
      if (![403, 405, 429, 500, 502, 503, 504].includes(response.status)) {
        // Un 404/410/400 ne changera pas au prochain essai : il était rejoué
        // 3 fois (3,9 s) parce que levé DANS le try — audit A2, 2026-09-06.
        throw new HttpStatusError(response.status, url);
      }
      // A soft block means we are being rude to this host — grow its gap so the
      // whole pool naturally slows down for it (and only it), not just this retry.
      reportThrottle(url);
      lastError = new Error(`HTTP ${response.status} for ${url}`);

      /**
       * 429 is the host telling us to slow down, and a half-second retry is
       * the opposite of listening. Courir rate-limited a run and 245 of 395
       * pages failed — each worker retried fast, twelve workers in parallel,
       * which kept the limiter tripped for the whole source. A long pause here
       * throttles the entire pool naturally, since every worker that hits the
       * limiter parks itself. Retry-After is honoured when the host names it.
       */
      if (response.status === 429) {
        const asked = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(asked) && asked > 0 ? asked * 1000 : 20_000 * (i + 1);
        if (timer) clearTimeout(timer);
        await sourceDelay(Math.min(waitMs, 90_000));
        continue;
      }
    } catch (error) {
      assertSourceRunning();
      init.signal?.throwIfAborted();
      // A blocked URL will never become fetchable — do not waste retries on it.
      if (error instanceof BlockedUrlError || error instanceof WafChallengeError || error instanceof HttpStatusError) {
        if (timer) clearTimeout(timer);
        throw error;
      }
      lastError = error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (i + 1 < attempts + (wafRetried ? 1 : 0)) {
      await sourceDelay(500 * 2 ** i + Math.floor(Math.random() * 300));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`);
}

/**
 * Le texte d'une réponse — après contrôle d'intégrité.
 *
 * Le contrôle est ICI et non dans `fetchWithRetry` parce qu'un challenge servi
 * en 200 (Cloudflare) n'est reconnaissable qu'une fois le CORPS lu : le statut
 * et les en-têtes sont ceux d'une page normale. Mesuré le 2026-09-08 sur
 * careers.loreal.com — la page d'attente passait `response.ok`, le parseur n'y
 * trouvait aucune carte, et 1 711 offres tombaient BROKEN sans une erreur.
 *
 * Un challenge lève désormais `WafChallengeError`, comme le WAF Amazon : la
 * source est enregistrée en échec franc (donc EXCLUE de toute fermeture
 * d'offres) au lieu d'être prise pour un board devenu vide.
 */
export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const response = await fetchWithRetry(url, init);
  const body = await readBodyBounded(response, url);

  const vendor = detectChallenge(response, body);
  if (vendor) {
    // Amorçage navigateur : le même chemin qui débloque déjà le WAF Amazon.
    // Une seule tentative — une origine déjà munie du jeton et pourtant
    // challengée ne gagnera rien à être rejouée à l'identique.
    if (!getWafCookie(url) && (await primeWafCookie(url))) {
      const retried = await fetchWithRetry(url, init);
      const retriedBody = await readBodyBounded(retried, url);
      if (!detectChallenge(retried, retriedBody)) return retriedBody;
    }
    reportThrottle(url);
    throw new WafChallengeError(url, vendor);
  }

  return body;
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...init,
    headers: { accept: 'application/json', ...Object.fromEntries(new Headers(init.headers)) },
  });
  return JSON.parse(await readBodyBounded(response, url)) as T;
}
