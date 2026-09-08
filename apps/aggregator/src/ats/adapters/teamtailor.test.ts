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
  });
  it('retains observations but never attests when the page budget is reached', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([captured.items[0]],captured.next_url));
    const r = await fetchTeamtailorJobs({origin,maxPages:1});
    expect(r).toMatchObject({complete:false,truncated:true});expect(r.jobs).toHaveLength(1);
  });
  it('distinguishes an explicit empty feed from malformed JSON', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([]));
    expect(await fetchTeamtailorJobs({origin})).toMatchObject({jobs:[],complete:true,truncated:false});
    for(const response of [{}, {items:[]}, {...page([]),items:null}]){
      vi.mocked(fetchJson).mockResolvedValueOnce(response);
      await expect(fetchTeamtailorJobs({origin})).rejects.toThrow('shape');
    }
  });
  it('refuses duplicate pages even if they provide a next link', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([captured.items[0]],captured.next_url)).mockResolvedValueOnce(page([captured.items[0]],origin+'/jobs.json?page=3'));
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
