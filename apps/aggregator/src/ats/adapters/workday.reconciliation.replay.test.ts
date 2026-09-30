import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withCaptureContext, type CaptureRecord } from '../../capture/context.js';

vi.mock('../../lib/hostGate.js', () => ({ withHostGate: async (_url: string, run: () => Promise<unknown>) => run(), reportThrottle: () => {}, reportSuccess: () => {} }));
vi.mock('../../lib/sourceBudget.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/sourceBudget.js')>()), sourceDelay: vi.fn(async () => undefined) }));

import { fetchWorkdayJobs } from './workday.js';

/**
 * LA SECONDE PASSE SE REJOUE HORS RÉSEAU (D-482, 30/09/2026).
 *
 * La qualification rejoue chaque capture avec le lecteur du jour (`sourceValidation.ts`) : les requêtes répétées d'un
 * même offset y sont servies dans l'ordre de leur capture, par empreinte (`capture/batch.ts`). Ce témoin passe par le
 * VRAI transport (`fetchJson` → `fetchWithRetry`, archivage de chaque réponse) sur un réseau simulé qui sert les pages
 * réelles, puis rejoue les réponses archivées par file d'empreinte : même résultat, aucune réponse laissée de côté,
 * aucun appel réseau.
 */
type Page = { offset: number; body: string };
const pages = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))).toString('utf8')) as Page[];
const observedAt = new Date('2026-09-29T17:10:58.530Z');

function network(plan: (offset: number, read: number) => string) {
  const reads = new Map<number, number>();
  const mock = vi.fn(async (_url: string, init?: RequestInit) => {
    const { offset } = JSON.parse(String(init?.body)) as { offset: number };
    const read = reads.get(offset) ?? 0; reads.set(offset, read + 1);
    return new Response(plan(offset, read), { headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', mock);
  return { mock, reads };
}

async function collectThenReplay(config: Record<string, unknown>, plan: (offset: number, read: number) => string) {
  const { mock, reads } = network(plan);
  const records: CaptureRecord[] = [];
  const live = await withCaptureContext({ sequence: 0, observedAt, write: async (row) => { records.push(row); } }, () => fetchWorkdayJobs(config));
  const queues = new Map<string, CaptureRecord[]>();
  for (const row of records) queues.set(row.requestHash, [...(queues.get(row.requestHash) ?? []), row]);
  const calls = mock.mock.calls.length;
  mock.mockImplementation(async () => { throw new Error('Replay tried to use the network'); });
  const replay = await withCaptureContext({ sequence: 0, observedAt, replay: async (hash) => {
    const row = queues.get(hash)?.shift(); if (!row) throw new Error('Offline replay request is absent from the capture'); return row;
  } }, () => fetchWorkdayJobs(config));
  return { live, replay, records, reads, left: [...queues.values()].reduce((n, q) => n + q.length, 0), networkAfterReplay: mock.mock.calls.length - calls };
}

beforeEach(() => vi.stubEnv('PIPELINE_PAUSED', '0'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Workday — capture puis rejeu hors réseau de la seconde passe D-482', () => {
  it('Nordstrom 29/09 : la seconde passe entière, archivée, se rejoue à l’identique', async () => {
    const byOffset = new Map(pages('workday-nordstrom-liste-20260929.json.gz').map((p) => [p.offset, p.body]));
    const { live, replay, records, reads, left, networkAfterReplay } = await collectThenReplay(
      { tenant: 'nordstrom', site: 'nordstrom_careers', origin: 'https://nordstrom.wd501.myworkdayjobs.com', withDescriptions: false },
      (offset, read) => read > 0 && offset === 0 ? byOffset.get(1340)! : byOffset.get(offset)!);
    // Prémisse : la page 0 a été demandée deux fois (deux passes), 135 réponses archivées.
    expect(reads.get(0)).toBe(2);
    expect(records).toHaveLength(135);
    expect(live.complete).toBe(true);
    expect(replay).toEqual(live);
    expect(left).toBe(0);
    expect(networkAfterReplay).toBe(0);
  });
});
