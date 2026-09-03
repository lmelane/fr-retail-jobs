/**
 * Per-host politeness gate — the global hygiene for outbound requests (Loïc,
 * 2026-09-03).
 *
 * The recurring failure was ALWAYS the same shape: many brands share one host
 * (careers.elcompanies.com for 6 Estée Lauder brands, richemont.wd3… for every
 * Richemont Maison, one Beaumanoir tenant, Courir's rate limiter), we hammered it
 * in parallel, it throttled us (403/405/429), and a whole group's offers dropped
 * to a blip. Retrying reactively per-adapter treats the symptom.
 *
 * This treats the cause, once, for EVERY outbound fetch: it serialises requests
 * to the SAME host behind a small concurrency limit and a minimum gap, and it
 * BACKS OFF adaptively — a host that throttles gets a longer gap for a while, then
 * recovers. Different hosts never wait on each other, so throughput across the
 * catalogue is unaffected; only a host we are being rude to slows down.
 */

type HostState = {
  /** Requests in flight to this host right now. */
  active: number;
  /** Earliest time (ms) the next request to this host may start. */
  nextAllowedAt: number;
  /** Current minimum gap between requests to this host (grows on throttle). */
  gapMs: number;
  /** Waiters parked until a slot frees up. */
  queue: (() => void)[];
};

const MAX_CONCURRENT_PER_HOST = Number(process.env.HOST_MAX_CONCURRENCY ?? 4);
const BASE_GAP_MS = Number(process.env.HOST_BASE_GAP_MS ?? 80);
const MAX_GAP_MS = Number(process.env.HOST_MAX_GAP_MS ?? 8_000);
/** How long a raised gap decays back toward the base, per successful request. */
const GAP_DECAY = 0.8;

const hosts = new Map<string, HostState>();

function stateFor(host: string): HostState {
  let state = hosts.get(host);
  if (!state) {
    state = { active: 0, nextAllowedAt: 0, gapMs: BASE_GAP_MS, queue: [] };
    hosts.set(host, state);
  }
  return state;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `task` under the gate for `url`'s host: waits for a concurrency slot and
 * the per-host gap, runs it, then releases the slot and wakes the next waiter.
 */
export async function withHostGate<T>(url: string, task: () => Promise<T>): Promise<T> {
  const host = hostOf(url);
  const state = stateFor(host);

  // Wait for a concurrency slot.
  if (state.active >= MAX_CONCURRENT_PER_HOST) {
    await new Promise<void>((resolve) => state.queue.push(resolve));
  }
  state.active++;

  // Honour the per-host gap so bursts to one host are spaced out.
  const now = Date.now();
  const wait = Math.max(0, state.nextAllowedAt - now);
  state.nextAllowedAt = Math.max(now, state.nextAllowedAt) + state.gapMs;
  if (wait > 0) await sleep(wait);

  try {
    return await task();
  } finally {
    state.active--;
    const next = state.queue.shift();
    if (next) next();
  }
}

/**
 * Report that a host throttled us (403/405/429/5xx): grow its gap so subsequent
 * requests to it slow down. Called by fetchWithRetry on a soft-block status.
 */
export function reportThrottle(url: string): void {
  const state = stateFor(hostOf(url));
  state.gapMs = Math.min(MAX_GAP_MS, Math.max(state.gapMs, BASE_GAP_MS) * 2);
  state.nextAllowedAt = Math.max(state.nextAllowedAt, Date.now() + state.gapMs);
}

/** Report a clean success: let the host's gap decay back toward the base. */
export function reportSuccess(url: string): void {
  const state = stateFor(hostOf(url));
  if (state.gapMs > BASE_GAP_MS) {
    state.gapMs = Math.max(BASE_GAP_MS, Math.round(state.gapMs * GAP_DECAY));
  }
}
