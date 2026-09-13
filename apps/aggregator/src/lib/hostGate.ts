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

import { assertSourceRunning, sourceDelay, sourceSignal } from './sourceBudget.js';
import { rateLimitKeyFor } from './rateLimitKey.js';

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

/**
 * LA CLÉ DU BUDGET — le tenant, pas le nom d'hôte.
 *
 * Mesuré en P8 : `urbn-hub` éclate en HUIT sous-domaines iCIMS d'un même client, à qui la porte accordait
 * huit budgets séparés — soit huit fois la cadence qu'un seul client devrait obtenir. À l'inverse, quatre
 * sources Fast Retailing partagent un hostname et donc, déjà, un budget.
 *
 * On garde donc le hostname pour le DIAGNOSTIC (latences, statuts, télémétrie) et on limite sur le TENANT.
 * Le repli reste le hostname : conservateur, il protège autant qu'avant et jamais moins.
 */
function hostOf(url: string): string {
  return rateLimitKeyFor(url);
}

/**
 * Runs `task` under the gate for `url`'s host: waits for a concurrency slot and
 * the per-host gap, runs it, then releases the slot and wakes the next waiter.
 */
export async function withHostGate<T>(url: string, task: () => Promise<T>): Promise<T> {
  assertSourceRunning();
  const host = hostOf(url);
  const state = stateFor(host);

  // Wait for a concurrency slot.
  if (state.active >= MAX_CONCURRENT_PER_HOST) {
    await new Promise<void>((resolve, reject) => {
      const signal = sourceSignal();
      const grant = () => {
        signal?.removeEventListener('abort', cancel);
        state.active++; // Reserve before waking, so new arrivals cannot steal the slot.
        resolve();
      };
      const cancel = () => {
        const index = state.queue.indexOf(grant);
        if (index >= 0) state.queue.splice(index, 1);
        reject(signal?.reason);
      };
      state.queue.push(grant);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
    });
  } else state.active++;

  try {
    // Honour the per-host gap so bursts to one host are spaced out.
    const now = Date.now();
    const wait = Math.max(0, state.nextAllowedAt - now);
    state.nextAllowedAt = Math.max(now, state.nextAllowedAt) + state.gapMs;
    if (wait > 0) await sourceDelay(wait);
    assertSourceRunning();
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
export function reportThrottle(url: string, retryAfterMs?: number | null): void {
  const state = stateFor(hostOf(url));
  state.gapMs = Math.min(MAX_GAP_MS, Math.max(state.gapMs, BASE_GAP_MS) * 2);
  /**
   * LE COOLDOWN APPARTIENT À LA CLÉ DE LIMITATION, pas au worker qui a pris le 429.
   *
   * `stateFor(hostOf(url))` résout désormais la `rateLimitKey` : toutes les sources du même tenant partagent
   * donc `nextAllowedAt`, et une source qui se fait refuser fait attendre les autres du tenant — pendant
   * qu'un tenant différent continue sans pénalité. C'est la propriété que H1 a rendue nécessaire : trois 429
   * y ont été absorbés par re-tentative, chaque worker repartant de son côté.
   *
   * `Retry-After` prime quand l'hôte le nomme : il sait mieux que notre backoff. On prend le MAXIMUM, jamais
   * le minimum — plusieurs 429 rapprochés ne doivent jamais RACCOURCIR un cooldown déjà posé.
   */
  const jitter = Math.floor(Math.random() * 250);
  const asked = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? Math.min(retryAfterMs, MAX_GAP_MS) : 0;
  const until = Date.now() + Math.max(state.gapMs, asked) + jitter;
  state.nextAllowedAt = Math.max(state.nextAllowedAt, until);
}

/** Le cooldown courant d'une clé, en ms — pour les preuves et les tests. */
export function cooldownRemainingMs(url: string): number {
  return Math.max(0, stateFor(hostOf(url)).nextAllowedAt - Date.now());
}

/** Report a clean success: let the host's gap decay back toward the base. */
export function reportSuccess(url: string): void {
  const state = stateFor(hostOf(url));
  if (state.gapMs > BASE_GAP_MS) {
    state.gapMs = Math.max(BASE_GAP_MS, Math.round(state.gapMs * GAP_DECAY));
  }
}
