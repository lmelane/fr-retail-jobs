const timeoutMs = Number(process.env.HTTP_TIMEOUT_MS ?? 20_000);
const userAgent = process.env.USER_AGENT ?? 'CatwalksJobsBot/0.1';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'user-agent': userAgent,
          'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7',
          ...(init.headers ?? {}),
        },
      });
      if (response.ok) return response;
      if (![429, 500, 502, 503, 504].includes(response.status)) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
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
        clearTimeout(timer);
        await sleep(Math.min(waitMs, 90_000));
        continue;
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    await sleep(500 * 2 ** i + Math.floor(Math.random() * 300));
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`);
}

export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const response = await fetchWithRetry(url, init);
  return response.text();
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  });
  return response.json() as Promise<T>;
}
