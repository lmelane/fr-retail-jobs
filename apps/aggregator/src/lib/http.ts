import { assertPublicUrl, isPublicHttpUrl, BlockedUrlError } from './ssrf.js';
import { withHostGate, reportThrottle, reportSuccess } from './hostGate.js';

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
async function readBodyBounded(response: Response, url: string): Promise<string> {
  const body = response.body;
  // No readable stream (a 204, or a mocked Response in tests): text() is all
  // there is, and there is nothing to bound.
  if (!body) return typeof response.text === 'function' ? response.text() : '';
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  const deadline = Date.now() + readTimeoutMs;
  try {
    for (;;) {
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
  return Buffer.concat(chunks).toString('utf8');
}

/** Redirect hops to follow before giving up — enough for http→https→www chains. */
const MAX_REDIRECTS = 5;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One fetch that follows redirects MANUALLY, validating every hop against the
 * SSRF guard. `redirect: 'follow'` would let a public URL redirect to an
 * internal target (169.254.169.254, localhost) unchecked; validating each
 * Location closes that.
 */
async function fetchFollowingSafely(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertPublicUrl(current);
    const response = await fetch(current, { ...init, signal, redirect: 'manual' });

    // 3xx with a Location -> validate and follow it ourselves.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return response;
      const next = new URL(location, current).toString();
      if (!isPublicHttpUrl(next)) throw new BlockedUrlError(next);
      current = next;
      continue;
    }
    return response;
  }
  throw new Error(`Too many redirects (>${MAX_REDIRECTS}) for ${url}`);
}

export async function fetchWithRetry(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
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
        timer = setTimeout(() => controller.abort(), timeoutMs);
        return fetchFollowingSafely(
          url,
          {
            ...init,
            headers: {
              'user-agent': userAgent,
              'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7',
              ...(init.headers ?? {}),
            },
          },
          controller.signal,
        );
      });
      if (response.ok) {
        reportSuccess(url);
        return response;
      }
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
        throw new Error(`HTTP ${response.status} for ${url}`);
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
        await sleep(Math.min(waitMs, 90_000));
        continue;
      }
    } catch (error) {
      // A blocked URL will never become fetchable — do not waste retries on it.
      if (error instanceof BlockedUrlError) {
        if (timer) clearTimeout(timer);
        throw error;
      }
      lastError = error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    await sleep(500 * 2 ** i + Math.floor(Math.random() * 300));
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`);
}

export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const response = await fetchWithRetry(url, init);
  return readBodyBounded(response, url);
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  });
  return JSON.parse(await readBodyBounded(response, url)) as T;
}
