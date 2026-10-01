import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchText: vi.fn() }));
import { fetchText } from '../../lib/http.js';
import { fetchGenericJsonLdJobs, parseJobPostings, parseListingCount } from './genericJsonLd.js';
import { joinSpontaneousApplicationCards, SPONTANEOUS_APPLICATION_CARD } from './joinSpontaneousCard.js';
import { EXPLAINED_NATIVE_ROWS } from '../../connectors/sourceValidation.js';
import { normalizeAdapterResult } from '../index.js';
import { readEnumeration } from '../../pipeline/enumerationReading.js';

/*
 * Réponses réelles de join.com pour Gemmyo, corps archivés par les collectes de production : la liste du 29/09/2026
 * (lot 98a4c3bd : la page 1, puis la réponse à `page=2`, qui rend encore la page 1), la page de la carte « Candidature
 * spontanée » du même lot, et la page 2 du 23/09 (lot 2510a117 : 6 offres, la carte en fin de seconde page). Les fiches
 * d'offre sont simulées (un JobPosting minimal par lien) : la preuve porte sur la LISTE.
 */
const fixture = (name: string) => gunzipSync(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))).toString('utf8');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const page1 = fixture('join-gemmyo-liste-20260929.html.gz');
const page2 = fixture('join-gemmyo-liste-page2-20260929.html.gz');
const cardPage = fixture('join-gemmyo-candidature-spontanee-20260929.html.gz');
const sept23Page2 = fixture('join-gemmyo-liste-page2-20260923.html.gz');
const card = 'https://join.com/companies/gemmyo/spontaneous-application';
/** La configuration du registre, telle quelle ; seul le délai de relecture est raccourci pour le test. */
const config = { maxPages: 3, pageStart: 1, listingUrl: 'https://join.com/companies/gemmyo', linkPattern: '/companies/gemmyo/',
  countPattern: '"total":', detailRetryDelayMs: 1 };
const detail = (url: string) => `<html><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: `Offre ${url.split('/').pop()}`,
  datePosted: '2026-09-20', description: 'Les fiches réelles ne font pas partie de cette preuve.', hiringOrganization: { '@type': 'Organization', name: 'Gemmyo' },
  jobLocation: { '@type': 'Place', address: { addressLocality: 'Paris', addressCountry: 'FR' } } })}</script></html>`;
const links = (html: string) => [...html.matchAll(/href="([^"]*\/companies\/gemmyo\/[^"]*)"/g)].map(m => m[1]);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchText).mockImplementation(async (url: string) =>
    url === `${config.listingUrl}?page=1` ? page1 : url.startsWith(`${config.listingUrl}?page=`) ? page2 : url === card ? cardPage : detail(url));
});

describe('join.com : la carte « Candidature spontanée » comptée par l\'éditeur (Gemmyo, 29/09/2026)', () => {
  it('prémisse : ce sont les réponses archivées ; l\'éditeur compte 5 pour 4 offres et la carte, dont la page n\'a aucun JobPosting', () => {
    expect(sha256(page1)).toBe('25d05703591d63d386031b03f026f9393b44d8f2fdc40acc21f66c6ec5fdd084');
    expect(sha256(page2)).toBe('08d54b03a13a8380e575f98925c5efe4d9e13ebd2319e34c046530ebac68c31a');
    expect(sha256(cardPage)).toBe('a3cb94f6536b0fdea3f81eff1e16aaaba302d252534fb333f745912fdcc1d821');
    expect(sha256(sept23Page2)).toBe('3fb4881477d3578369c1d473ecec33ebb2215fcb0e162592bf6ba5e4c7a4d6c9');
    expect(parseListingCount(page1, config.countPattern)).toBe(5);
    expect(new Set(links(page1)).size).toBe(5);
    expect(links(page1)).toContain(card);
    expect(page1).toContain('"pagination":{"page":1,"pageCount":1,"pageSize":4,"perPage":5,"total":5}');
    expect(parseJobPostings(cardPage, card)).toEqual([]);
  });

  it('la carte est un lien compté, jamais lu comme une fiche : 4 offres sur 4 déclarées, énumération prouvée', async () => {
    const r = await fetchGenericJsonLdJobs(config);
    expect(vi.mocked(fetchText).mock.calls.map(([url]) => url)).not.toContain(card);
    expect(r.jobs).toHaveLength(4);
    expect(r.declaredTotal).toBe(4);
    expect(r.complete).toBe(true); expect(r.truncated).toBe(false);
    expect(r.enumeration?.termination).toBe('PUBLISHER_COUNT_REACHED');
    expect(r.enumeration?.issues).toEqual([]);
    expect(r.rejectedRows).toEqual([{ reason: SPONTANEOUS_APPLICATION_CARD, raw: { url: card } }]);
    expect(r.enumeration?.scopes).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'publisherCount', declaredTotal: 5, uniqueIds: 5, complete: true }),
      expect.objectContaining({ scope: 'publisherNonPostingCards', declaredTotal: 1, uniqueIds: 1, complete: true }),
      expect.objectContaining({ scope: 'postingsParsed', declaredTotal: 4, uniqueIds: 4, complete: true })]));
    // La ligne nommée est expliquée : la validation ne la compte pas parmi les lignes non qualifiées.
    expect(r.rejectedRows!.every(row => EXPLAINED_NATIVE_ROWS.has(row.reason))).toBe(true);
    // Et la lecture du RUN, après la normalisation commune des adaptateurs, reste « prouvée ».
    const normalized = normalizeAdapterResult(r);
    expect(normalized).toMatchObject({ complete: true, enumerationVerdict: 'PROVEN' });
    expect(readEnumeration(normalized)).toEqual({ enumerationReading: 'PROVEN' });
  });

  it('reconnaît la carte en fin de seconde page, total réconcilié (23/09 : 7 = 5 + 1 offres + la carte)', () => {
    expect(sept23Page2).toContain('"pagination":{"page":2,"pageCount":2,"pageSize":1,"perPage":5,"total":7}');
    expect(joinSpontaneousApplicationCards(sept23Page2, `${config.listingUrl}?page=2`, links(sept23Page2))).toEqual([card]);
  });

  it('ne reconnaît rien sans chacune des preuves de la page : le lien reste lu comme une fiche', () => {
    const url = `${config.listingUrl}?page=1`;
    const recognise = (html: string, pageUrl = url, pageLinks = links(html)) => joinSpontaneousApplicationCards(html, pageUrl, pageLinks);
    const edit = (from: string, to: string) => { expect(page1.split(from)).toHaveLength(2); return page1.replace(from, to); };
    expect(recognise(page1)).toEqual([card]);
    expect(recognise(edit('"isSpontaneousApplicationEnabled":true', '"isSpontaneousApplicationEnabled":false'))).toEqual([]);
    expect(recognise(edit('"total":5', '"total":4'))).toEqual([]);             // la carte n'est pas comptée
    expect(recognise(edit('"total":5', '"total":6'))).toEqual([]);             // une offre manque à la page
    expect(recognise(edit('"idParam":"16743474-charge-e-de-service-client"', '"idParam":"spontaneous-application"'))).toEqual([]);
    expect(recognise(edit('"domain":"gemmyo"', '"domain":"autre"'))).toEqual([]);
    expect(recognise(page1, url, links(page1).filter(link => link !== card))).toEqual([]);
    expect(recognise(page1, 'https://careers.example/companies/gemmyo?page=1')).toEqual([]);
    expect(recognise(edit('<script id="__NEXT_DATA__" type="application/json"', '<script id="__NEXT_DATA__" type="application/json">{'))).toEqual([]);
  });

  it('sans preuve de la page, rien ne change : la carte lue fait toujours une fiche en échec', async () => {
    vi.mocked(fetchText).mockImplementation(async (url: string) =>
      url.startsWith(`${config.listingUrl}?page=`) ? page1.replace('"total":5', '"total":4') : url === card ? cardPage : detail(url));
    const r = await fetchGenericJsonLdJobs(config);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['DETAIL_FAILURES=1', 'ENUMERATION_NOT_PROVEN']));
    expect(r).not.toHaveProperty('rejectedRows');
  });
});

/*
 * RUN du 01/10/2026 : 5 offres remplissent la page de 5, la carte passe seule en page 2, que join.com ne sert jamais (la
 * réponse à `page=2` est la page 1, mêmes 139 075 octets dans la capture). Pièce : la page 1 archivée par le RUN
 * (lot 18f6c805, empreinte du corps ci-dessous).
 */
const oct1 = fixture('join-gemmyo-liste-20261001.html.gz');
const serve = (listing: string) => vi.mocked(fetchText).mockImplementation(async (url: string) =>
  url.startsWith(`${config.listingUrl}?page=`) ? listing : url === card ? cardPage : detail(url));

describe('join.com : la carte seule sur une dernière page que l\'éditeur ne sert pas (Gemmyo, RUN du 01/10/2026)', () => {
  it('prémisse : la page archivée annonce 6 éléments sur 2 pages de 5, montre 5 offres et pas la carte', () => {
    expect(sha256(oct1)).toBe('718d8dff4d5749b21529ae028cf699676b4219e80618836e75831cc8cdc3fc43');
    expect(oct1).toContain('"pagination":{"page":1,"pageCount":2,"pageSize":5,"perPage":5,"total":6}');
    expect(oct1).toContain('"isSpontaneousApplicationEnabled":true');
    expect(new Set(links(oct1)).size).toBe(5);
    expect(links(oct1)).not.toContain(card);
  });

  it('compte la carte sans la lire ni la visiter : 5 offres sur 5, énumération prouvée', async () => {
    serve(oct1);
    const r = await fetchGenericJsonLdJobs(config);
    expect(vi.mocked(fetchText).mock.calls.map(([url]) => url)).not.toContain(card);
    expect(r.jobs).toHaveLength(5); expect(r.declaredTotal).toBe(5);
    expect(r.complete).toBe(true); expect(r.truncated).toBe(false);
    expect(r.enumeration?.termination).toBe('PUBLISHER_COUNT_REACHED');
    expect(r.rejectedRows).toEqual([{ reason: SPONTANEOUS_APPLICATION_CARD, raw: { url: card, unreadLastPage: true } }]);
    expect(readEnumeration(normalizeAdapterResult(r)).enumerationReading).toBe('PROVEN');
  });

  it.each([
    ['un sixième élément qui serait une offre (total 7)', (html: string) => html.replace('"pageCount":2,"pageSize":5,"perPage":5,"total":6', '"pageCount":2,"pageSize":5,"perPage":5,"total":7')],
    ['une entreprise qui ne prend pas de candidature spontanée', (html: string) => html.replace('"isSpontaneousApplicationEnabled":true', '"isSpontaneousApplicationEnabled":false')],
    ['une offre de l\'état absente des liens lus', (html: string) => html.replace(/href="[^"]*16743474-charge-e-de-service-client"/g, 'href="/autre"')],
  ])('ne reconnaît rien devant %s : la source reste tronquée', async (_label, mutate) => {
    const mutated = mutate(oct1);
    // Prémisse : la mutation a bien porté.
    expect(mutated).not.toBe(oct1);
    serve(mutated);
    const r = await fetchGenericJsonLdJobs(config);
    expect(r.complete).toBe(false); expect(r.truncated).toBe(true);
    expect(r.rejectedRows ?? []).toEqual([]);
  });
});
