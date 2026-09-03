import { describe, it, expect, beforeEach } from 'vitest';
import { withHostGate, reportThrottle, reportSuccess } from './hostGate.js';

/**
 * The per-host gate is the global politeness that stops us throttling a shared
 * host. These tests pin its three guarantees: same-host requests are spaced and
 * concurrency-capped, different hosts never wait on each other, and a throttle
 * grows the host's gap (backoff).
 */
describe('withHostGate', () => {
  beforeEach(() => {
    // Tighten the gap for fast tests via env (read at module load; here we rely
    // on the defaults being small enough — BASE_GAP_MS=250 by default).
  });

  it('serialises requests to the SAME host with a gap between them', async () => {
    const starts: number[] = [];
    const t0 = Date.now();
    await Promise.all(
      [0, 1, 2].map(() =>
        withHostGate('https://same.example/x', async () => {
          starts.push(Date.now() - t0);
        }),
      ),
    );
    // With MAX_CONCURRENT_PER_HOST=2 and a gap, the 3rd start is delayed.
    starts.sort((a, b) => a - b);
    expect(starts.length).toBe(3);
    // The last request must not start at t≈0 — it waited behind the gap/slot.
    expect(starts[2]).toBeGreaterThan(starts[0]);
  });

  it('does NOT make different hosts wait on each other', async () => {
    const t0 = Date.now();
    const done: number[] = [];
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((h) =>
        withHostGate(`https://${h}.example/`, async () => {
          done.push(Date.now() - t0);
        }),
      ),
    );
    // Four distinct hosts run essentially in parallel — all finish quickly.
    expect(done.length).toBe(4);
    expect(Math.max(...done)).toBeLessThan(500);
  });

  it('grows the gap on throttle and decays it on success', async () => {
    const url = 'https://throttled.example/';
    // Two consecutive requests, timing the gap before and after a throttle report.
    const gapBefore = await measureGap(url);
    reportThrottle(url);
    reportThrottle(url);
    const gapAfter = await measureGap(url);
    expect(gapAfter).toBeGreaterThan(gapBefore);
    // A run of successes decays it back down.
    for (let i = 0; i < 10; i++) reportSuccess(url);
    const gapRecovered = await measureGap(url);
    expect(gapRecovered).toBeLessThanOrEqual(gapAfter);
  });
});

/** Time the enforced gap between two back-to-back requests to a host. */
async function measureGap(url: string): Promise<number> {
  const times: number[] = [];
  await withHostGate(url, async () => times.push(Date.now()));
  await withHostGate(url, async () => times.push(Date.now()));
  return times[1] - times[0];
}
