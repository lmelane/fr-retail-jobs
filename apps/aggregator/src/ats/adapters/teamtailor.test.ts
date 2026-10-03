import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fetchJson } from '../../lib/http.js';
import { fetchTeamtailorJobs } from './teamtailor.js';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn() }));
import { toNormalized } from './teamtailor.js';

/** Audit A5 (2026-09-06) : normal.eu publie son feed sur jobs.normal.eu, ses fiches n'existent que sur jobs.normal.{no,fr} — 478/478 liens en 404. */
describe('toNormalized — hôte des fiches', () => {
  const item = { id: '8288459', title: 'Sales Assistant', url: 'https://jobs.normal.eu/jobs/8288459-sales-assistant', date_published: '2026-09-01' } as never;
  it('rehéberge l’URL sur jobOrigin quand il est configuré', () => {
    expect(toNormalized(item, 'https://jobs.normal.fr')?.url).toBe('https://jobs.normal.fr/jobs/8288459-sales-assistant');
  });
  it('garde l’URL du feed sans jobOrigin', () => {
    expect(toNormalized(item)?.url).toBe('https://jobs.normal.eu/jobs/8288459-sales-assistant');
  });
});

const captured = JSON.parse(readFileSync(new URL('./__fixtures__/teamtailor-live-items.json', import.meta.url), 'utf8'));
const origin = 'https://carrieres.groupegalerieslafayette.com';
it('uses the actual hiring organization from the archived feed before the catalogue label', () => {
  const item = captured.items[0];
  const job = toNormalized(item)!;
  expect(job.company).toBe(item._jobposting.hiringOrganization.name);
  expect(job.employerEvidence).toEqual({ rawName: 'Groupe Galeries Lafayette', path: '_jobposting.hiringOrganization.name', rule: 'HIRING_ORGANIZATION_LABEL' });
  expect(job.raw).toEqual(item);
});
const page = (items: unknown[], next?: string) => ({version: captured.version, feed_url: captured.feed_url, items, ...(next === undefined ? {} : {next_url: next})});
beforeEach(() => vi.mocked(fetchJson).mockReset());
describe('Teamtailor enumeration evidence', () => {
  it('attests only after the final feed page and preserves the actual source items', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([captured.items[0]], captured.next_url)).mockResolvedValueOnce(page([captured.items[1]]));
    const r = await fetchTeamtailorJobs({origin});
    expect(r).toMatchObject({complete:true,truncated:false});
    expect(r.declaredTotal).toBeUndefined();
    expect(r.jobs.map(j=>j.raw)).toEqual(captured.items);
    expect(fetchJson).toHaveBeenNthCalledWith(2,captured.next_url,expect.anything());
    // Lot F3 : la preuve d'énumération nomme chaque page et ses identifiants canoniques, ceux de la sortie.
    expect(r.enumeration).toMatchObject({ method: 'DOCUMENTED_JSON_FEED', endpoint: `${origin}/jobs.json`, pages: 2, rawCount: 2, termination: 'NEXT_URL_NULL', canonicalAbsenceProofUsable: true, enumerationTraversalComplete: true });
    expect(r.enumeration!.blockers).toBeUndefined();
    expect(r.enumeration!.pageEvidence!.map(p => p.canonicalIds)).toEqual([[r.jobs[0].externalId], [r.jobs[1].externalId]]);
    expect(r.enumeration!.pageEvidence!.map(p => p.offset)).toEqual([0, 1]);
    expect(r.enumeration!.pageEvidence![1].url).toBe(captured.next_url);
    expect(r.enumeration!.pageEvidence!.every(p => /^[a-f0-9]{64}$/.test(p.sha256) && p.publisherCounter === '1')).toBe(true);
  });
  it('retains observations but never attests when the page budget is reached', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([captured.items[0]],captured.next_url));
    const r = await fetchTeamtailorJobs({origin,maxPages:1});
    expect(r).toMatchObject({complete:false,truncated:true});expect(r.jobs).toHaveLength(1);
    expect(r.enumeration).toMatchObject({ pages: 1, termination: 'PAGE_BUDGET_REACHED', enumerationTraversalComplete: false, blockers: ['PAGE_BUDGET_REACHED'] });
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual([r.jobs[0].externalId]);
  });
  it('distinguishes an explicit empty feed from malformed JSON', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([]));
    expect(await fetchTeamtailorJobs({origin})).toMatchObject({jobs:[],complete:true,truncated:false,declaredTotal:0});
    for(const response of [{}, {items:[]}, {...page([]),items:null}]){
      vi.mocked(fetchJson).mockResolvedValueOnce(response);
      await expect(fetchTeamtailorJobs({origin})).rejects.toThrow('shape');
    }
  });
  it('refuses a CONTRADICTORY duplicate across pages', async () => {
    /*
     * Ce témoin exigeait le refus de TOUT identifiant répété. Mesuré sur galeries-lafayette le
     * 2026-09-21 : 2 identifiants sur 157 sont servis deux fois avec une charge utile STRICTEMENT
     * IDENTIQUE — un recouvrement de pagination, et le refus coûtait 157 offres.
     *
     * Le refus porte désormais sur ce qui compromet réellement la preuve d'absence : deux
     * versions DIFFÉRENTES d'un même identifiant, où l'on ne sait plus laquelle fait foi. Le cas
     * identique est couvert par `__tests__/teamtailor-recouvrement.test.ts`.
     */
    const divergent = {...captured.items[0], title:'Autre intitulé'};
    vi.mocked(fetchJson).mockResolvedValueOnce(page([captured.items[0]],captured.next_url)).mockResolvedValueOnce(page([divergent],origin+'/jobs.json?page=3'));
    await expect(fetchTeamtailorJobs({origin})).rejects.toThrow('duplicate');
  });
  it('detects URL cycles before another fetch', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([captured.items[0]], origin+'/jobs.json?per_page=100'));
    await expect(fetchTeamtailorJobs({origin})).rejects.toThrow('cycle');expect(fetchJson).toHaveBeenCalledTimes(1);
  });
  it.each(['https://other.example/jobs.json?page=2',origin+'/jobs.json?page=2&country=FR',origin+'/other.json',origin+'/jobs.json#loop',''])('rejects untrusted continuation %s', async next => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([captured.items[0]],next));
    await expect(fetchTeamtailorJobs({origin})).rejects.toThrow();expect(fetchJson).toHaveBeenCalledTimes(1);
  });
  it('does not reinterpret a failed next page as a completed board', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([captured.items[0]],captured.next_url)).mockRejectedValueOnce(new Error('HTTP 403'));
    await expect(fetchTeamtailorJobs({origin})).rejects.toThrow('403');
  });
  it('rejects a dropped identity and an empty page with a next link', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([{...captured.items[0],id:undefined}]));
    await expect(fetchTeamtailorJobs({origin})).rejects.toThrow('identity');
    vi.mocked(fetchJson).mockResolvedValueOnce(page([],captured.next_url));
    await expect(fetchTeamtailorJobs({origin})).rejects.toThrow('empty page');
  });
  it('rejects a foreign feed identity and a filtered starting URL', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({...page([]),feed_url:'https://other.example/jobs.json'});
    await expect(fetchTeamtailorJobs({origin})).rejects.toThrow('identity');
    await expect(fetchTeamtailorJobs({origin:origin+'?country=FR'})).rejects.toThrow('unfiltered');
  });
});

/**
 * D-522 §6 (03/10/2026) : Fjällräven publie ses 22 offres nord-américaines sur le portail du groupe Fenix Outdoor
 * (`career.fenixoutdoor.se`), qui publie aussi Globetrotter, Friluftsland, Naturkompaniet (déjà collectée), Hanwag…
 * Une source limitée à une Maison lit le portail entier mais ne garde que l'employeur nommé par `employer`
 * (libellé natif exact de `_jobposting.hiringOrganization.name`) : couverture rétablie, aucun autre périmètre,
 * aucun doublon de Naturkompaniet. Fixture : le feed réel du 03/10, réduit à 5 offres.
 */
describe('Teamtailor — portail de groupe limité à un employeur (Fenix Outdoor → Fjällräven)', () => {
  const fenix = JSON.parse(readFileSync(new URL('./__fixtures__/teamtailor-fenix-outdoor-items.json', import.meta.url), 'utf8'));
  const fenixOrigin = 'https://career.fenixoutdoor.se';
  const feed = { version: fenix.version, feed_url: fenix.feed_url, items: fenix.items };
  const labels = (items: Array<{ _jobposting: { hiringOrganization: { name: string } } }>) => items.map(i => i._jobposting.hiringOrganization.name);
  it('ne garde que les offres de l’employeur configuré, et sa preuve ne nomme qu’elles', async () => {
    // Prémisse : le feed mêle bien plusieurs employeurs du groupe, dont Naturkompaniet (collectée ailleurs).
    expect(new Set(labels(fenix.items)).size).toBeGreaterThan(2);
    expect(labels(fenix.items)).toContain('Naturkompaniet');
    vi.mocked(fetchJson).mockResolvedValueOnce(feed);
    const r = await fetchTeamtailorJobs({ origin: fenixOrigin, employer: 'Fjällräven North America' });
    expect(r.jobs.map(j => j.company)).toEqual(['Fjällräven North America', 'Fjällräven North America']);
    expect(r).toMatchObject({ complete: true, truncated: false });
    expect(r.declaredTotal).toBeUndefined();
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(r.jobs.map(j => j.externalId));
    expect(r.enumeration!.pageEvidence![0].publisherCounter).toBe('5');
    expect(r.enumeration!.pageEvidence![0].componentCounters).toEqual(['employer=Fjällräven North America', 'outOfScopeEmployer=3']);
  });
  it('compare le libellé en forme normalisée (NFC), jamais par sous-chaîne', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(feed);
    const r = await fetchTeamtailorJobs({ origin: fenixOrigin, employer: 'Fjällräven North America'.normalize('NFD') });
    expect(r.jobs).toHaveLength(2);
    vi.mocked(fetchJson).mockResolvedValueOnce(feed);
    expect((await fetchTeamtailorJobs({ origin: fenixOrigin, employer: 'Fjällräven' })).jobs).toHaveLength(0);
  });
  it('un portail complet sans offre de l’employeur est le zéro prouvé de cet employeur (D-523 §2), jamais sur une liste incomplète', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(feed);
    const r = await fetchTeamtailorJobs({ origin: fenixOrigin, employer: 'Fjällräven Europe' });
    // Prémisse : le flux de l'éditeur porte des offres, aucune de cet employeur.
    expect(fenix.items.length).toBeGreaterThan(0);
    expect(r.jobs).toEqual([]);
    expect(r).toMatchObject({ complete: true, declaredTotal: 0 });
    vi.mocked(fetchJson).mockResolvedValueOnce({ ...feed, next_url: `${fenixOrigin}/jobs.json?page=2&per_page=100` });
    const partial = await fetchTeamtailorJobs({ origin: fenixOrigin, employer: 'Fjällräven Europe', maxPages: 1 });
    expect(partial).toMatchObject({ complete: false });
    expect(partial.declaredTotal).toBeUndefined();
  });
  it('refuse un employeur vide ou non textuel', async () => {
    for (const employer of ['', '  ', 42, ['Fjällräven North America']]) {
      await expect(fetchTeamtailorJobs({ origin: fenixOrigin, employer })).rejects.toThrow('employer');
    }
  });
  it('sans réglage, lit le portail entier comme avant', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(feed);
    expect((await fetchTeamtailorJobs({ origin: fenixOrigin })).jobs).toHaveLength(5);
  });
});
