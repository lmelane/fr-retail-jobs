import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withCaptureContext, type CaptureRecord } from '../../capture/context.js';

vi.mock('../../lib/hostGate.js', () => ({ withHostGate: async (_url: string, run: () => Promise<unknown>) => run(), reportThrottle: () => {}, reportSuccess: () => {} }));
// Les attentes du transport entre ses trois essais (0,5 s, 1 s) sont sautées ; le rejeu, lui, n'attend jamais.
vi.mock('../../lib/sourceBudget.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/sourceBudget.js')>()), sourceDelay: vi.fn(async () => undefined) }));

import { fetchWorkdayJobs, WORKDAY_DETAIL_PERMISSION_DENIED } from './workday.js';
import { recoverRetainedPublication } from '../../publication/recovery.js';

/**
 * D-484 §1 (décision CEO du 30/09/2026) — LA FICHE WORKDAY QUE L'ÉDITEUR REFUSE EN LA NOMMANT, sur les réponses réelles.
 *
 * Capture swarovski du RUN du 29/09 (fc6c9182, `scripts/ops/extraire-reponses.mts`) : la page de liste (séquence 26),
 * les TROIS réponses 403 S22 que la fiche R-113477-1 a rendues aux trois essais du transport (560, 565, 573) et la
 * fiche R-111827-1 lue en 200 (558). Corps exacts, empreinte de chaque corps et du fichier vérifiée.
 *
 * Le chemin est celui de la collecte : le VRAI transport (`fetchJson` → `fetchWithRetry`, archivage de chaque réponse),
 * puis le rejeu hors réseau des réponses archivées par file d'empreinte, puis le lecteur hors ligne des publications
 * conservées (`publication/recovery.ts`). La preuve est le CORPS du refus : un 403 sans lui reste à instruire.
 */
type Reponse = { sequence: number; requestUrl: string; status: number; headers: Record<string, string>; sha256: string; body: string };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function fixture(): Reponse[] {
  const gz = readFileSync(new URL('./__fixtures__/workday-swarovski-s22-20260929.json.gz', import.meta.url));
  expect(sha(gz)).toBe('2d8218411d46093bca0242392c30888d24e6915bcf42da357813231f04c8d233');
  const reponses = JSON.parse(gunzipSync(gz).toString('utf8')) as Reponse[];
  for (const r of reponses) expect(sha(r.body)).toBe(r.sha256);
  return reponses;
}
const config = { tenant: 'swarovski', site: 'swarovski', origin: 'https://swarovski.wd3.myworkdayjobs.com' };
const observedAt = new Date('2026-09-29T16:58:22.440Z');
const REFUSED = 'Senior-Digital-Consultant--SAP-Materials-Management--_R-113477-1';
const READ = 'Senior-Workday-Integrations-Developer_R-111827-1';
type Posting = { externalPath: string };

/** Le réseau : la page de liste réduite aux deux lignes réelles, puis les fiches telles qu'archivées. */
function network(reponses: Reponse[], refusal: (attempt: number) => { status: number; body: string; type: string }) {
  const [liste, lue] = reponses;
  const page = JSON.parse(liste!.body) as { jobPostings: Posting[] };
  const rows = page.jobPostings.filter((p) => p.externalPath.endsWith(REFUSED) || p.externalPath.endsWith(READ));
  let attempts = 0;
  const mock = vi.fn(async (url: string) => {
    if (url.endsWith('/jobs')) return new Response(JSON.stringify({ total: rows.length, jobPostings: rows }), { headers: { 'content-type': 'application/json' } });
    if (url.endsWith(READ)) return new Response(lue!.body, { headers: { 'content-type': 'application/json' } });
    if (url.endsWith(REFUSED)) { const r = refusal(attempts++); return new Response(r.body, { status: r.status, headers: { 'content-type': r.type } }); }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', mock);
  return { mock, rows };
}
const real = (reponses: Reponse[]) => (attempt: number) => {
  const r = reponses[2 + Math.min(attempt, 2)]!;
  return { status: r.status, body: r.body, type: r.headers['content-type']! };
};

async function collect() {
  const records: CaptureRecord[] = [];
  const live = await withCaptureContext({ sequence: 0, observedAt, write: async (row) => { records.push(row); } }, () => fetchWorkdayJobs(config));
  return { live, records };
}
const byId = (jobs: { externalId?: string }[], id: string) => jobs.find((j) => j.externalId === id) as Record<string, any>;

beforeEach(() => vi.stubEnv('PIPELINE_PAUSED', '0'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('D-484 §1 — Swarovski, 29/09 : la fiche refusée « S22 permission denied » est une offre retirée par l’éditeur', () => {
  it('prémisse : les trois réponses archivées de R-113477-1 sont des 403 S22, la fiche R-111827-1 est lue en 200', () => {
    const reponses = fixture();
    expect(reponses.map((r) => [r.sequence, r.status])).toEqual([[26, 200], [558, 200], [560, 403], [565, 403], [573, 403]]);
    for (const r of reponses.slice(2)) {
      expect(r.requestUrl.endsWith(REFUSED)).toBe(true);
      expect(JSON.parse(r.body)).toMatchObject({ errorCode: 'S22', httpStatus: 403, message: 'permission denied' });
    }
    expect(JSON.parse(reponses[1]!.body).jobPostingInfo.jobDescription.length).toBeGreaterThan(40);
  });

  it('collecte puis rejeu hors réseau : retenue WORKDAY_DETAIL_PERMISSION_DENIED avec sa preuve, fiche lue publiée, rejeu identique', async () => {
    const reponses = fixture();
    const { mock } = network(reponses, real(reponses));
    const { live, records } = await collect();
    // Prémisse : trois essais sur la fiche refusée, archivés en 403 avec leur corps.
    const refusedRows = records.filter((r) => r.requestUrl.endsWith(REFUSED));
    expect(refusedRows.map((r) => r.status)).toEqual([403, 403, 403]);
    const refused = byId(live.jobs, REFUSED);
    expect(refused.publicationHold).toBe(WORKDAY_DETAIL_PERMISSION_DENIED);
    expect(refused.raw.detailRefusal).toEqual({ status: 403, errorCode: 'S22', message: 'permission denied' });
    const read = byId(live.jobs, READ);
    expect(read.publicationHold).not.toBe('WORKDAY_DETAIL_FETCH_FAILED');
    expect(read.description.length).toBeGreaterThan(40);

    const queues = new Map<string, CaptureRecord[]>();
    for (const row of records) queues.set(row.requestHash, [...(queues.get(row.requestHash) ?? []), row]);
    const calls = mock.mock.calls.length;
    mock.mockImplementation(async () => { throw new Error('Replay tried to use the network'); });
    const replay = await withCaptureContext({ sequence: 0, observedAt, replay: async (hash) => {
      const row = queues.get(hash)?.shift(); if (!row) throw new Error('Offline replay request is absent from the capture'); return row;
    } }, () => fetchWorkdayJobs(config));
    expect(replay).toEqual(live);
    expect([...queues.values()].every((q) => q.length === 0)).toBe(true);
    expect(mock.mock.calls.length).toBe(calls);

    // Le lecteur hors ligne des publications conservées : même décision sur la preuve conservée.
    const context = { externalId: refused.externalId, url: refused.url, observedAt, config };
    expect(recoverRetainedPublication('workday', JSON.parse(JSON.stringify(refused.raw)), context)).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'PUBLICATION_HELD' });
    // Sans la preuve (échec de lecture ordinaire), rien n'est démontré : le refus de relire reste celui d'avant.
    const { detailRefusal: _proof, ...withoutProof } = JSON.parse(JSON.stringify(refused.raw));
    expect(recoverRetainedPublication('workday', withoutProof, context)).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'DETAIL_IDENTITY_MISMATCH' });
    const altered = { ...withoutProof, detailRefusal: { status: 403, errorCode: 'S23', message: 'permission denied' } };
    expect(recoverRetainedPublication('workday', altered, context)).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'DETAIL_IDENTITY_MISMATCH' });
  });

  it('un 403 SANS le corps S22 (page HTML de pare-feu, autre code) reste WORKDAY_DETAIL_FETCH_FAILED, à instruire', async () => {
    const reponses = fixture();
    const autres = [
      { status: 403, body: '<html><body>Access denied</body></html>', type: 'text/html' },
      { status: 403, body: JSON.stringify({ errorCode: 'S23', httpStatus: 403, message: 'permission denied' }), type: 'application/json' },
      { status: 403, body: JSON.stringify({ errorCode: 'S22', httpStatus: 403, message: 'forbidden' }), type: 'application/json' },
      { status: 403, body: '', type: 'application/json' },
    ];
    for (const autre of autres) {
      network(reponses, () => autre);
      const { live } = await collect();
      expect(byId(live.jobs, REFUSED).publicationHold).toBe('WORKDAY_DETAIL_FETCH_FAILED');
      expect(byId(live.jobs, REFUSED).raw.detailRefusal).toBeUndefined();
    }
  });

  it('le corps S22 sous un autre statut (500) n’est pas la preuve : à instruire', async () => {
    const reponses = fixture();
    network(reponses, () => ({ status: 500, body: reponses[2]!.body, type: 'application/json' }));
    const { live } = await collect();
    expect(byId(live.jobs, REFUSED).publicationHold).toBe('WORKDAY_DETAIL_FETCH_FAILED');
  });
});
