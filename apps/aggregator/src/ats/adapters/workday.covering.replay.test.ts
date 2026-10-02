import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withCaptureContext, type CaptureRecord } from '../../capture/context.js';

vi.mock('../../lib/hostGate.js', () => ({ withHostGate: async (_url: string, run: () => Promise<unknown>) => run(), reportThrottle: () => {}, reportSuccess: () => {} }));
vi.mock('../../lib/sourceBudget.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/sourceBudget.js')>()), sourceDelay: vi.fn(async () => undefined) }));

import { fetchWorkdayJobs, WORKDAY_TOTAL_CAP } from './workday.js';
import { PROVING_TERMINATIONS } from '../../pipeline/refreshPlan.js';

/**
 * LA PREUVE PAR FACETTE SE REJOUE HORS RÉSEAU (D-520 §4 a). La qualification rejoue chaque capture avec le lecteur du jour
 * (`sourceValidation.ts`) : chaque requête est servie par son empreinte, dans l'ordre de capture. Ce témoin passe par le
 * VRAI transport (`fetchJson`, archivage de chaque réponse) sur un réseau simulé de la forme de knitwell (site plafonné à
 * 2 000, page au-delà resservie, facettes à plat d'accord), puis rejoue l'archive : même résultat, preuve adoptée à
 * l'identique, aucune réponse laissée de côté, aucun appel réseau.
 */
const observedAt = new Date('2026-10-02T15:13:00.000Z');
const config = { tenant: 'knitwellgroup', site: 'US_Retail_Jobs', origin: 'https://knitwellgroup.wd1.myworkdayjobs.com', withDescriptions: false };
const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
const posting = (id: number) => ({ title: `Sales ${id}`, externalPath: `/job/NY/Sales_R-${id}`, locationsText: 'New York', postedOn: 'Posted Today', bulletFields: [`R-${id}`] });
const families: Record<string, number[]> = { 'fam-Stores': ids(0, 1_300), 'fam-Corporate': ids(1_300, 1_900), 'fam-DC': ids(1_900, 2_100) };
const facets = [
  { facetParameter: 'jobFamilyGroup', values: Object.entries(families).map(([id, list]) => ({ descriptor: id.slice(4), id, count: list.length })) },
  { facetParameter: 'workerSubType', values: [{ descriptor: 'Regular', id: 'wst-r', count: 2_100 }] },
];
const site = ids(0, 2_100);

function network() {
  const mock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { offset: number; appliedFacets: Record<string, string[]> };
    const applied = Object.values(body.appliedFacets).flat()[0];
    // Beyond the cap the capped site re-serves its last page (knitwell, 02/10): the probe sees nothing new.
    const list = applied ? (families[applied] ?? []).slice(body.offset, body.offset + 20)
      : body.offset >= WORKDAY_TOTAL_CAP ? site.slice(1_980, 2_000) : site.slice(body.offset, body.offset + 20);
    const total = body.offset !== 0 ? 0 : applied ? (families[applied] ?? []).length : WORKDAY_TOTAL_CAP;
    return new Response(JSON.stringify({ total, jobPostings: list.map(posting), ...(body.offset === 0 && !applied ? { facets } : {}) }),
      { headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => vi.stubEnv('PIPELINE_PAUSED', '0'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Workday — la preuve par facette, capturée puis rejouée hors réseau (D-520 §4 a)', () => {
  it('collecte puis rejeu : 2 100 offres sur 2 100, preuve adoptée, résultat identique, archive consommée, aucun appel réseau', async () => {
    const mock = network();
    const records: CaptureRecord[] = [];
    const live = await withCaptureContext({ sequence: 0, observedAt, write: async (row) => { records.push(row); } }, () => fetchWorkdayJobs(config));
    // Prémisse : the covering boards were really read through the transport and archived.
    expect(live.complete).toBe(true);
    expect(live.enumeration?.termination).toBe('COVERING_FACET_RECONCILED');
    expect(PROVING_TERMINATIONS.has(live.enumeration!.termination!)).toBe(true);
    expect(new Set(live.jobs.map((job) => job.externalId)).size).toBe(2_100);
    // 101 requests for the capped site and its probe, 105 for the three covering boards: each one archived.
    const covering = mock.mock.calls.filter(([, init]) => String(init?.body).includes('"jobFamilyGroup"')).length;
    expect(covering).toBe(105);
    expect(records).toHaveLength(mock.mock.calls.length);
    const queues = new Map<string, CaptureRecord[]>();
    for (const row of records) queues.set(row.requestHash, [...(queues.get(row.requestHash) ?? []), row]);
    const calls = mock.mock.calls.length;
    mock.mockImplementation(async () => { throw new Error('Replay tried to use the network'); });
    const replay = await withCaptureContext({ sequence: 0, observedAt, replay: async (hash) => {
      const row = queues.get(hash)?.shift(); if (!row) throw new Error('Offline replay request is absent from the capture'); return row;
    } }, () => fetchWorkdayJobs(config));
    expect(replay).toEqual(live);
    expect([...queues.values()].reduce((n, q) => n + q.length, 0)).toBe(0);
    expect(mock.mock.calls.length - calls).toBe(0);
  });
});
