import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchWithRetry: vi.fn(), fetchText: vi.fn() }));
import { fetchText, fetchWithRetry } from '../../lib/http.js';
import { fetchGenericJsonLdJobs, parseJobPostings } from './genericJsonLd.js';
import { WORDPRESS_POST_TYPE_READER, readWordpressPostTypeRaw, wordpressPostTypeSettings } from './wordpressPostType.js';
import { readEnumeration } from '../../pipeline/enumerationReading.js';
import { recoverRetainedPublication } from '../../publication/recovery.js';

/**
 * KASTNER & ÖHLER, RUN DU 02/10/2026 (D-522 §6) : « énumération non prouvée », descriptions 0 %.
 *
 * Cause, relue le 03/10 : la source partait d'UNE fiche d'offre et suivait ses liens (12 offres, aucune fin démontrable),
 * et le JSON-LD des fiches ne porte qu'une accroche d'une ligne en description. Le site est un WordPress dont les offres
 * sont un type de billet public, `jobangebot` : `/wp-json/wp/v2/jobangebot` rend les 12 offres, le texte entier de chacune
 * et le total de l'éditeur (`x-wp-total: 12`, `x-wp-totalpages: 1`). Le lieu reste celui du JSON-LD de la fiche.
 */
const real = JSON.parse(readFileSync(new URL('./__fixtures__/d522-6-wordpress-kastner-oehler.json', import.meta.url), 'utf8'));
const config = { startUrl: 'https://www.kastner-oehler.at/job-karriere/offene-stellen/', reader: WORDPRESS_POST_TYPE_READER, postType: 'jobangebot' };
const page = (posts: unknown[], total: number, pages = 1) =>
  new Response(JSON.stringify(posts), { headers: { 'content-type': 'application/json', 'x-wp-total': String(total), 'x-wp-totalpages': String(pages) } });
const detailPage = (link: string) => `<html><head>${real.detailJsonLd[link]}</head><body></body></html>`;
beforeEach(() => {
  vi.mocked(fetchWithRetry).mockReset(); vi.mocked(fetchText).mockReset();
  vi.mocked(fetchText).mockImplementation(async (url) => detailPage(String(url)));
});

describe('WordPress, type de billet public lu par l’API REST (Kastner & Öhler, 03/10/2026)', () => {
  it('prémisse : le JSON-LD des fiches ne porte qu’une accroche, le billet porte le texte entier', () => {
    const [first] = real.posts;
    const [posting] = parseJobPostings(detailPage(first.link), first.link);
    expect(posting?.description?.length).toBeLessThan(200);
    expect(posting?.country).toBe('Österreich');
    expect(first.content.rendered.length).toBeGreaterThan(2000);
  });

  it('lit la liste entière contre le total de l’éditeur, le texte du billet et le lieu de la fiche', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(page(real.posts, 2));
    const r = await fetchGenericJsonLdJobs(config);
    expect(vi.mocked(fetchWithRetry).mock.calls[0]![0]).toBe('https://www.kastner-oehler.at/wp-json/wp/v2/jobangebot?per_page=100&page=1');
    expect(r.jobs.map((j) => j.externalId)).toEqual(real.posts.map((p: { id: number }) => String(p.id)));
    const [deko] = r.jobs;
    expect(deko!.description!.length).toBeGreaterThan(2000);
    expect(deko).toMatchObject({ title: 'Deko-Techniker*in, Graz, Vollzeit', country: 'Österreich', city: 'Graz', url: real.posts[0].link });
    expect(deko!.company).toBeTruthy();
    expect(r.complete).toBe(true);
    expect(r.declaredTotal).toBe(2);
    expect(r.enumeration).toMatchObject({ termination: 'DECLARED_PAGE_COUNT_REACHED', canonicalAbsenceProofUsable: true });
    expect(r.enumeration?.pageEvidence?.[0]?.canonicalIds).toEqual(real.posts.map((p: { id: number }) => String(p.id)));
    expect(readEnumeration(r).enumerationReading).toBe('PROVEN');
  });

  it('un total que la liste n’atteint pas refuse la preuve', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(page(real.posts, real.total));
    const r = await fetchGenericJsonLdJobs(config);
    expect(r.complete).toBe(false);
    expect(readEnumeration(r).enumerationReading).toBe('REFUTED');
  });

  it('une fiche illisible garde l’offre et son texte, sans lieu ; la liste reste prouvée', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(page(real.posts, 2));
    vi.mocked(fetchText).mockRejectedValueOnce(new Error('HTTP 503'));
    const r = await fetchGenericJsonLdJobs(config);
    expect(r.jobs).toHaveLength(2);
    expect(r.jobs.find((j) => !j.country)?.description?.length).toBeGreaterThan(1000);
    expect(r.complete).toBe(true);
    expect(r.enumeration?.scopes).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'detailJsonLd', uniqueIds: 1, declaredTotal: 2, complete: false })]));
  });

  it('le rejeu des publications conservées relit le RAW avec la même fonction que la collecte', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(page(real.posts, 2));
    const r = await fetchGenericJsonLdJobs(config);
    const [deko] = r.jobs;
    expect(readWordpressPostTypeRaw(deko!.raw)).toEqual(deko);
    const recovered = recoverRetainedPublication('generic-listing', deko!.raw, { externalId: deko!.externalId, url: deko!.url, observedAt: new Date('2026-10-03T08:00:00Z'), config });
    expect(recovered).toMatchObject({ status: 'RECOVERABLE', job: expect.objectContaining({ externalId: deko!.externalId, country: 'Österreich', description: deko!.description }) });
  });

  it('refuse une configuration qui sortirait du site ou nommerait un chemin', () => {
    expect(wordpressPostTypeSettings(config)).toEqual({ origin: 'https://www.kastner-oehler.at', postType: 'jobangebot' });
    expect(() => wordpressPostTypeSettings({ ...config, postType: '../users' })).toThrow();
    expect(() => wordpressPostTypeSettings({ ...config, startUrl: 'http://www.kastner-oehler.at/' })).toThrow();
  });
});
