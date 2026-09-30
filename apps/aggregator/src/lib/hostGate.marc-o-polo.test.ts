import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./sourceBudget.js', () => ({ assertSourceRunning: vi.fn(), sourceSignal: () => undefined, sourceDelay: vi.fn() }));

import { withHostGate } from './hostGate.js';
import { sourceDelay } from './sourceBudget.js';
import { paceFloorMs, rateLimitKeyFor } from './rateLimitKey.js';

/**
 * MARC O'POLO — LA CADENCE DE L'API D'OFFRES (D-485, 30/09/2026).
 *
 * Lectures directes du 30/09 (archive `audits/2026-09-30/marc-o-polo/`) : 98 requêtes en rafale, puis 56 à 3,5 s d'écart, avant HTTP 403
 * `{"message":"Forbidden"}` sur toutes les suivantes pendant plusieurs minutes ; le seuil estimé est d'environ 50
 * requêtes sur cinq minutes glissantes. Une collecte en demande environ 118. Ces témoins font passer 118 requêtes par
 * la VRAIE porte, sur une horloge virtuelle, et comptent le pire cumul sur cinq minutes.
 */
let now = 0;
const timers: { at: number; resolve: () => void }[] = [];
beforeEach(() => {
  now += 86_400_000; timers.length = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.mocked(sourceDelay).mockReset().mockImplementation((ms: number) =>
    new Promise<undefined>((resolve) => { timers.push({ at: now + ms, resolve: () => resolve(undefined) }); }));
});
afterEach(() => vi.restoreAllMocks());

async function simulate(urls: string[]): Promise<number[]> {
  const starts: number[] = [];
  let done = false;
  const work = Promise.all(urls.map((url) => withHostGate(url, async () => { starts.push(now); }))).then(() => { done = true; });
  for (;;) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (done) break;
    timers.sort((a, b) => a.at - b.at);
    const next = timers.shift();
    if (!next) throw new Error('the gate stalled with no pending wait');
    now = Math.max(now, next.at);
    next.resolve();
  }
  await work;
  return starts.sort((a, b) => a - b);
}
function worstWindow(starts: number[], ms: number): number {
  let worst = 0;
  for (let first = 0, last = 0; last < starts.length; last++) {
    while (starts[last] - starts[first] >= ms) first++;
    worst = Math.max(worst, last - first + 1);
  }
  return worst;
}
const FIVE_MINUTES = 300_000;
const MEASURED_THRESHOLD = 50;
const API = 'https://vhfco59ro6.execute-api.eu-central-1.amazonaws.com/production/vacancies';
const collecte = (base: string) => [`${base}?language=en`, ...Array.from({ length: 117 }, (_, i) => `${base}/2026-${4000 + i}?language=en`)];

describe("Marc O'Polo — la collecte reste sous le seuil mesuré du pare-feu de l'API", () => {
  it('PRÉMISSE : la même collecte sur un hôte sans plancher dépasse le seuil (le défaut du 30/09 est visible)', async () => {
    const starts = await simulate(collecte('https://api.pace.example/production/vacancies'));
    expect(starts).toHaveLength(118);
    expect(worstWindow(starts, FIVE_MINUTES)).toBeGreaterThan(MEASURED_THRESHOLD);
  });

  it("l'API de Marc O'Polo : au plus 43 départs sur cinq minutes, 7 s entre deux départs", async () => {
    const starts = await simulate(collecte(API));
    expect(starts).toHaveLength(118);
    expect(worstWindow(starts, FIVE_MINUTES)).toBeLessThanOrEqual(43);
    expect(Math.min(...starts.slice(1).map((start, i) => start - starts[i]))).toBeGreaterThanOrEqual(7_000);
  });

  it("seul l'hôte exact de l'API reçoit la cadence ; le site et un hôte voisin gardent la base", () => {
    expect(paceFloorMs(rateLimitKeyFor(`${API}?language=en`))).toBe(7_000);
    for (const url of ['https://company.marc-o-polo.com/en/career/start-creating-with-us/our-jobs',
      'https://other.execute-api.eu-central-1.amazonaws.com/production/vacancies']) expect(paceFloorMs(rateLimitKeyFor(url))).toBe(0);
  });
});
