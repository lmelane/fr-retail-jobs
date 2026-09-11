/**
 * Feed the REAL pipeline from archived responses, by replacing the network transport and nothing else.
 *
 * The mistake this replaces: a parallel script that selected existing postings, rebuilt a few fields from its own
 * `PATHS` table and wrote them with `job.update`. It shared two cleaning helpers with production and nothing else —
 * no adapter, no identity/configuration/perimeter check, no pipeline write path. It demonstrated a field repair,
 * not an integration, and it drifted: on flatchr its field choices differed from the adapter's until they were
 * copied over by hand, which is the proof that the transformation had been re-implemented instead of reused.
 *
 * The seam is therefore placed UNDER the adapters, at `globalThis.fetch`. Everything above runs untouched:
 * the ATS adapter for the family, the normalisers, the identity gate, the scope rules, the dedup and the upsert.
 * Only the bytes come from a recorded cassette instead of the public internet.
 *
 *   record   (online, once)  run a source normally and save every response next to its request
 *   replay   (offline)       serve those responses back, byte for byte; an unrecorded request FAILS loudly,
 *                            because silently returning "empty" would fake a source with no postings
 *
 * usage — inside a script, before anything imports the pipeline:
 *   import { installOfflineTransport } from './offline-transport.js';
 *   installOfflineTransport({ mode: 'replay', dir: 'backups/…/cassettes/recruitee' });
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';

export type TransportMode = 'record' | 'replay';

/** One request identifies one recorded response. The method and URL are enough for the adapters in use. */
const keyOf = (method: string, url: string) => createHash('sha256').update(`${method.toUpperCase()} ${url}`).digest('hex').slice(0, 32);

export class UnrecordedRequest extends Error {
  constructor(method: string, url: string) {
    super(`offline transport: no recorded response for ${method} ${url}. Record it first — returning an empty body would fabricate a source with no postings.`);
    this.name = 'UnrecordedRequest';
  }
}

export function installOfflineTransport(options: { mode: TransportMode; dir: string }): { calls: () => number } {
  const { mode, dir } = options;
  mkdirSync(dir, { recursive: true });
  const realFetch = globalThis.fetch.bind(globalThis);
  let calls = 0;

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    // The method can arrive on the init, on a Request object, or not at all; anything not a string is a GET.
    const rawMethod = init?.method ?? (typeof input === 'object' && input !== null ? (input as any).method : undefined);
    const method = typeof rawMethod === 'string' && rawMethod ? rawMethod : 'GET';
    const file = `${dir}/${keyOf(method, url)}.json`;
    calls++;

    if (mode === 'record') {
      const response = await realFetch(input, init);
      const body = await response.clone().text();
      writeFileSync(file, JSON.stringify({
        method, url, status: response.status,
        headers: Object.fromEntries(response.headers), body,
      }));
      return response;
    }

    if (!existsSync(file)) throw new UnrecordedRequest(method, url);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    // Cookies and content-encoding describe a transfer that is not happening; the body is already decoded.
    const headers = new Headers(Object.fromEntries(Object.entries(saved.headers as Record<string, string>)
      .filter(([k]) => !/^(set-cookie|content-encoding|content-length|transfer-encoding)$/i.test(k))));
    return new Response(saved.body, { status: saved.status, headers });
  }) as typeof globalThis.fetch;

  return { calls: () => calls };
}

/** How many responses a cassette holds — a cassette of 0 would replay an empty source. */
export function cassetteSize(dir: string): number {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).length : 0;
}
