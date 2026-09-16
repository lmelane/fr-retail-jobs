import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withHostGate, reportThrottle } from './hostGate.js';
import { sourceDelay } from './sourceBudget.js';

vi.mock('./sourceBudget.js', () => ({ assertSourceRunning: vi.fn(), sourceSignal: () => undefined, sourceDelay: vi.fn() }));
let now = 0;
const waits: { ms: number; resolve: () => void }[] = [];
beforeEach(() => {
  now = 0; waits.length = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.mocked(sourceDelay).mockReset().mockImplementation(ms => new Promise<undefined>(resolve => { waits.push({ ms, resolve: () => resolve(undefined) }); }));
});
afterEach(() => vi.restoreAllMocks());
async function advance(time: number) {
  now = time;
  const wait = waits.shift(); expect(wait).toBeDefined(); wait!.resolve();
  await new Promise<void>(resolve => setImmediate(resolve));
}

it('postpones an already waiting request when a refusal arrives after its reservation', async () => {
  const url = 'https://queued-cooldown.example/';
  await withHostGate(url, async () => {});
  const work = vi.fn(async () => now); const pending = withHostGate(url, work);
  expect(waits[0].ms).toBeLessThan(30_000);
  reportThrottle(url, 30_000);
  await advance(80);
  expect(work).not.toHaveBeenCalled();
  expect(waits[0].ms).toBeGreaterThanOrEqual(29_920);
  await advance(30_000);
  expect(await pending).toBe(30_000);
});

it('chunks a long server cooldown without letting timer overflow start the request early', async () => {
  const url = 'https://long-cooldown.example/'; reportThrottle(url, 3_000_000_000);
  const work = vi.fn(async () => now); const pending = withHostGate(url, work);
  expect(waits[0].ms).toBe(2_147_483_647);
  await advance(2_147_483_647);
  expect(work).not.toHaveBeenCalled(); expect(waits[0].ms).toBe(852_516_353);
  await advance(3_000_000_000);
  expect(await pending).toBe(3_000_000_000);
});
