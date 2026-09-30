import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withCaptureContext, type CaptureRecord } from '../../capture/context.js';

vi.mock('../../lib/hostGate.js', () => ({ withHostGate: async (_url: string, run: () => Promise<unknown>) => run(), reportThrottle: () => {}, reportSuccess: () => {} }));
// Les attentes du transport (0,5 s, 1 s) et de la fenêtre du pare-feu (4 min) sont sautées ; le rejeu, lui, n'attend jamais.
vi.mock('../../lib/sourceBudget.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/sourceBudget.js')>()), sourceDelay: vi.fn(async () => undefined) }));

import { fetchEightfoldJobs, NATIVE_DESCRIPTION_EMPTY } from './eightfold.js';
import { recoverRetainedPublication, retainedPublicationIdentity } from '../../publication/recovery.js';

/**
 * LA RELECTURE APRÈS LA FENÊTRE DU PARE-FEU SE REJOUE HORS RÉSEAU, ET LA RETENUE D-481 §3 AUSSI (30/09/2026).
 *
 * La qualification d'une source rejoue sa capture avec le lecteur du jour (`sourceValidation.ts`) : toute requête
 * de la collecte doit y être relue dans le même ordre, et rien d'autre. Ce témoin passe par le VRAI transport
 * (`fetchWithRetry`, archivage de chaque réponse) sur un réseau simulé qui rend, pour une fiche, trois 405 du
 * pare-feu (`x-amzn-waf-action: captcha`, en-tête archivé comme en production le 29/09) puis la fiche ; puis il
 * rejoue les réponses archivées par file d'adresse, comme `capture/batch.ts`, et exige le même résultat, sans
 * réseau et sans réponse laissée de côté. Enfin le lecteur de rejeu des publications conservées
 * (`publication/recovery.ts`) doit reposer la même retenue sur la fiche vide.
 */
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'));
const search = fixture('l2-eightfold-elc-search.json');
const detail = fixture('l2-eightfold-elc-detail.json');
const origin = 'https://elcompanies.eightfold.ai';
const config = { origin, domain: 'elcompanies.com' };
const observedAt = new Date('2026-09-29T16:10:43.932Z');
const [lostId, emptyId, plainId] = search.data.positions.map((p: { id: number }) => String(p.id));
/** Le gabarit « Description / Qualifications » sans contenu, tel que la fiche 1168275706359 le rend (30/09). */
const HEADINGS_ONLY = '<div><div style="padding: 10px 0px;border: 1px solid transparent;"><div style="font-size:16px;word-wrap: break-word;"><h2 style="font-size: 1em; margin: 0px">Description</h2>\r</div><div></div></div><div style="padding: 10px 0px;border: 1px solid transparent;"><div style="font-size:16px;word-wrap: break-word;"><h2 style="font-size: 1em; margin: 0px">Qualifications</h2>\r</div><div></div></div></div>';

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const captcha = () => new Response('<html><body>captcha</body></html>', { status: 405, headers: { 'content-type': 'text/html; charset=UTF-8', 'x-amzn-waf-action': 'captcha' } });

function network() {
  let refusals = 0;
  const mock = vi.fn(async (url: string) => {
    const target = new URL(url);
    expect(target.origin).toBe(origin);
    if (target.pathname === '/careers') return new Response('<html></html>', { headers: { 'content-type': 'text/html', 'set-cookie': 'sid=abc; Path=/' } });
    if (target.pathname === '/api/pcsx/search') return json({ data: { ...search.data, count: search.data.positions.length } });
    const id = target.searchParams.get('position_id');
    // La fenêtre du pare-feu : les trois essais du transport sur cette fiche sont refusés, la relecture passe.
    if (id === lostId && refusals < 3) { refusals++; return captcha(); }
    return json({ data: { ...detail.data, id: Number(id), jobDescription: id === emptyId ? HEADINGS_ONLY : detail.data.jobDescription } });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => vi.stubEnv('PIPELINE_PAUSED', '0'));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Eightfold — capture, rejeu hors réseau, rejeu des publications conservées', () => {
  it('la fiche relue après la fenêtre et la fiche vide chez l’éditeur se rejouent à l’identique', async () => {
    const fetch = network();
    const records: CaptureRecord[] = [];
    const live = await withCaptureContext({ sequence: 0, observedAt, write: async (row) => { records.push(row); } },
      () => fetchEightfoldJobs(config));

    // Prémisse : la fiche a bien pris trois refus du pare-feu, archivés avec leur signature, avant d'être lue.
    const lostRows = records.filter((row) => new URL(row.requestUrl).pathname.endsWith('/position_details')
      && JSON.stringify(row.requestData).includes(lostId));
    expect(lostRows.map((row) => row.status)).toEqual([405, 405, 405, 200]);
    expect(lostRows[0].headers).toMatchObject({ 'x-amzn-waf-action': 'captcha' });

    const byId = new Map(live.jobs.map((job) => [job.externalId, job]));
    expect(byId.get(lostId)).toMatchObject({ company: 'Estée Lauder Companies', contract: 'Fulltime-Regular' });
    expect(byId.get(lostId)?.description?.length).toBeGreaterThan(40);
    expect(byId.get(lostId)?.publicationHold).toBeUndefined();
    expect(byId.get(emptyId)?.publicationHold).toBe(NATIVE_DESCRIPTION_EMPTY);
    expect(byId.get(plainId)?.publicationHold).toBeUndefined();

    // Le rejeu : les réponses d'une même adresse, dans l'ordre de leur capture ; aucune ne doit rester.
    const queues = new Map<string, CaptureRecord[]>();
    for (const row of records) queues.set(row.requestHash, [...(queues.get(row.requestHash) ?? []), row]);
    const calls = fetch.mock.calls.length;
    fetch.mockImplementation(async () => { throw new Error('Replay tried to use the network'); });
    const replay = await withCaptureContext({ sequence: 0, observedAt, replay: async (hash) => {
      const row = queues.get(hash)?.shift(); if (!row) throw new Error('Offline replay request is absent from the capture'); return row;
    } }, () => fetchEightfoldJobs(config));
    expect(replay).toEqual(live);
    expect([...queues.values()].every((queue) => queue.length === 0)).toBe(true);
    expect(fetch.mock.calls.length).toBe(calls);

    // Le lecteur des publications conservées : même description, même retenue, jamais une fiche vide republiée.
    const context = (job: typeof live.jobs[number]) => ({ externalId: job.externalId, url: job.url, observedAt, config });
    const retained = (id: string) => JSON.parse(JSON.stringify(byId.get(id)!.raw));
    const recovered = recoverRetainedPublication('eightfold', retained(lostId), context(byId.get(lostId)!));
    expect(recovered.status).toBe('RECOVERABLE');
    if (recovered.status === 'RECOVERABLE') expect(recovered.job.description).toBe(byId.get(lostId)!.description);
    expect(recoverRetainedPublication('eightfold', retained(emptyId), context(byId.get(emptyId)!))).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'PUBLICATION_HELD' });
    expect(retainedPublicationIdentity('eightfold', retained(emptyId), context(byId.get(emptyId)!))).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'PUBLICATION_HELD' });
    // Sans fiche conservée (lecture en échec), aucune preuve de vide : refusée pour contenu manquant, comme avant.
    const { eightfoldDetail: _read, ...listingOnly } = retained(lostId);
    expect(recoverRetainedPublication('eightfold', listingOnly, context(byId.get(lostId)!))).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'CONTENT_MISSING' });
  });
});
