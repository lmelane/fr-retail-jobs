import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./sourceBudget.js', () => ({ assertSourceRunning: vi.fn(), sourceSignal: () => undefined, sourceDelay: vi.fn() }));

import { withHostGate, reportThrottle, reportSuccess, cooldownRemainingMs } from './hostGate.js';
import { sourceDelay } from './sourceBudget.js';
import { paceFloorMs, rateLimitKeyFor } from './rateLimitKey.js';

/**
 * EIGHTFOLD — UN COMPTEUR, UNE CADENCE (30/09/2026).
 *
 * Le pare-feu d'Eightfold a refusé Estée Lauder et Kering ENSEMBLE le 29/09, trois fois, quand leur cumul dépassait
 * environ 1 000 requêtes sur cinq minutes glissantes (RawCapture du RUN 12f79076, lecture seule : 1 158, 1 262 et
 * 1 021 requêtes dans les cinq minutes précédant chaque premier refus ; levée à chaque retour sous 1 000).
 *
 * Ces témoins font passer 1 200 requêtes par la VRAIE porte, sur une horloge virtuelle (`sourceDelay` avance le
 * temps au lieu de l'attendre), et comptent le pire cumul sur cinq minutes. La prémisse montre que la même mesure
 * voit le défaut : deux hôtes sans clé commune dépassent le seuil.
 */
let now = 0;
const timers: { at: number; resolve: () => void }[] = [];
beforeEach(() => {
  // Chaque témoin commence une journée plus tard : les réservations des précédents sont échues.
  now += 86_400_000; timers.length = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.mocked(sourceDelay).mockReset().mockImplementation((ms: number) =>
    new Promise<undefined>((resolve) => { timers.push({ at: now + ms, resolve: () => resolve(undefined) }); }));
});
afterEach(() => vi.restoreAllMocks());

/** Runs every gated request to completion, jumping the clock to the next pending wait whenever the gate sleeps. */
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
/** The largest number of request starts inside any window of `ms`. */
function worstWindow(starts: number[], ms: number): number {
  let worst = 0;
  for (let first = 0, last = 0; last < starts.length; last++) {
    while (starts[last] - starts[first] >= ms) first++;
    worst = Math.max(worst, last - first + 1);
  }
  return worst;
}
const FIVE_MINUTES = 300_000;
const MEASURED_THRESHOLD = 1_000;
const alternate = (a: string, b: string, n: number) => Array.from({ length: n }, (_, i) => `${i % 2 ? a : b}?position_id=${i}`);
const ELC = 'https://elcompanies.eightfold.ai/api/pcsx/position_details';
const KERING = 'https://careers.kering.com/api/pcsx/position_details';

describe('Eightfold — la porte tient les deux sources sous le seuil mesuré du pare-feu', () => {
  it('PRÉMISSE : deux hôtes sans clé commune, à la cadence de base, dépassent le seuil (le défaut du 29/09 est visible)', async () => {
    const starts = await simulate(alternate('https://a.pace.example/x', 'https://b.pace.example/x', 1_200));
    expect(starts).toHaveLength(1_200);
    expect(worstWindow(starts, FIVE_MINUTES)).toBeGreaterThan(MEASURED_THRESHOLD);
  });

  it('Estée Lauder et Kering ensemble : jamais plus de 857 départs sur cinq minutes, 350 ms entre deux départs', async () => {
    const starts = await simulate(alternate(ELC, KERING, 1_200));
    expect(starts).toHaveLength(1_200);
    expect(worstWindow(starts, FIVE_MINUTES)).toBeLessThanOrEqual(858);
    expect(worstWindow(starts, FIVE_MINUTES)).toBeLessThan(MEASURED_THRESHOLD * 0.9);
    const gaps = starts.slice(1).map((start, i) => start - starts[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(350);
  });

  it('une requête Estée Lauder retarde la suivante de Kering : un seul budget, pas deux', async () => {
    await simulate([`${ELC}?position_id=1`]);
    expect(cooldownRemainingMs(`${KERING}?position_id=2`)).toBe(350);
  });

  it('un refus double la cadence à partir du plancher, et les succès ne la ramènent jamais sous lui', async () => {
    reportThrottle(`${KERING}?position_id=3`);
    await simulate([`${ELC}?position_id=4`]);
    expect(cooldownRemainingMs(`${ELC}?position_id=5`)).toBe(700);
    for (let i = 0; i < 50; i++) reportSuccess(`${KERING}?position_id=6`);
    now += 60_000;
    await simulate([`${ELC}?position_id=7`]);
    expect(cooldownRemainingMs(`${ELC}?position_id=8`)).toBe(350);
  });
});

describe('Eightfold — la clé commune ne regroupe que ce qui a été mesuré', () => {
  it('les deux portails, et eux seuls, partagent la clé cadencée', () => {
    expect(rateLimitKeyFor(`${ELC}?position_id=1`)).toBe('tenant:eightfold');
    expect(rateLimitKeyFor('https://careers.kering.com/api/pcsx/search?domain=kering.com')).toBe('tenant:eightfold');
    expect(rateLimitKeyFor('https://kering.eightfold.ai/careers')).toBe('tenant:eightfold');
    expect(paceFloorMs('tenant:eightfold')).toBe(350);
    // Le site institutionnel de Kering, un autre éditeur, un domaine qui ne fait que ressembler : budgets séparés, sans cadence.
    for (const url of ['https://www.kering.com/fr/', 'https://careers.pvh.com/us/en/job/1', 'https://noteightfold.ai/x', 'https://eightfold.ai.example.com/x']) {
      expect(rateLimitKeyFor(url)).toBe(`host:${new URL(url).hostname}`);
      expect(paceFloorMs(rateLimitKeyFor(url))).toBe(0);
    }
  });
});
