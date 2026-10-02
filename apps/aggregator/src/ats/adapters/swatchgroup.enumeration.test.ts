import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
vi.mock('../../observability/logger.js', () => ({ log: { error: vi.fn(async () => {}), info: vi.fn(async () => {}), warn: vi.fn(async () => {}) } }));
import { fetchText } from '../../lib/http.js';
import { announcedLastPage, fetchSwatchGroupJobs, selectOptionValues } from './swatchgroup.js';
import { deriveAccessScopes, type ObservedRequest } from '../../connectors/accessScopeDerivation.js';
import { matchingAccessScope, type AccessScope } from '../../connectors/accessScope.js';
import { CRAWLER_IDENTITY } from '../../lib/crawlerIdentity.js';

/*
 * D-493 (02/10/2026) — le listing complet, puis le même listing partitionné par le filtre public `time` du formulaire.
 * Mesures et lectures archivées : `audits/2026-10-02/d493-swatch/`.
 */

const ORIGIN = 'https://www.swatchgroup.com';
const FORM = 'search_api_fulltext=&jf_country=All&domain=All&position=All&contract=All';
/** L'URL exacte d'une page de listing, telle que l'adaptateur doit la demander. */
const listUrl = (time: string, page: number) => `${ORIGIN}/fr/job-finder?page=${page}&${FORM}&time=${time}`;
const LISTING = new RegExp(`^${ORIGIN}/fr/job-finder\\?page=(\\d+)&${FORM}&time=(\\w+)$`);

/** Le lien « Dernier » réel : Drupal recopie la requête du formulaire, `page` en dernier. */
const pager = (time: string, last: number) => `<a class="page-link" href="?search_api_fulltext=&amp;jf_country=All&amp;domain=All&amp;position=All&amp;contract=All&amp;time=${time}&amp;page=${last}" aria-label="Dernier"> <span aria-hidden="true"><i class="icon--last"></i></span></a>`;
/** Le `<select name="time">` réel du formulaire (page 0 du 02/10/2026). */
const TIME_SELECT = '<select data-drupal-selector="edit-time" id="edit-time" name="time" class="custom-select"><option value="All" selected="selected">- Tout -</option><option value="20">Plein temps</option><option value="21">Temps partiel</option></select>';
/** Une page de cartes : `links` au format « langue:identifiant » ou identifiants seuls (préfixe en), chaque lien deux fois. */
const cards = (links: Array<string | number>) => links.map((l) => {
  const [lang, id] = String(l).includes(':') ? String(l).split(':') : ['en', String(l)];
  return `<a href="/${lang}/job/${id}">x</a><a href="/${lang}/job/${id}">y</a>`;
}).join('');
const detail = (id: number | string) => `<html><body><h1>Vendeur ${id}</h1><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: `Vendeur ${id}`, datePosted: '2026-09-01', description: 'Poste réel et complet pour la boutique.', hiringOrganization: { name: 'Swatch' } })}</script><div id="jl">Genève</div></body></html>`;

type Plan = Record<string, Record<number, string>>;
/**
 * Sert les pages de listing prévues pour chaque valeur de `time` ; une page non prévue est vide. Toute autre URL de
 * listing fait échouer le test : l'ensemble exact des requêtes est une partie du contrat (périmètre d'accès).
 */
function serve(plan: Plan, details: Record<string, string | Error> = {}) {
  vi.mocked(fetchText).mockImplementation(async (url: string) => {
    const listing = LISTING.exec(url);
    if (listing) return plan[listing[2]]?.[Number(listing[1])] ?? '';
    if (url.includes('job-finder')) throw new Error(`requête de listing inattendue : ${url}`);
    const id = /\/job\/(\d+)$/.exec(url)?.[1];
    if (!id) throw new Error(`requête inattendue : ${url}`);
    const d = details[id];
    if (d instanceof Error) throw d;
    return d ?? detail(id);
  });
}
/**
 * Un listing synthétique, page après page (une page vide finale est la page « au-delà ») : « Dernier » sur chaque page
 * avant la dernière, comme les pages réelles, et le formulaire sur la page 0 du listing complet.
 */
const sweepOf = (time: string, pages: Array<Array<string | number>>, opts: { form?: boolean; lastOn?: Record<number, number> } = {}) => {
  const last = pages.length - 1 - (pages.length > 1 && pages[pages.length - 1].length === 0 ? 1 : 0);
  return Object.fromEntries(pages.map((ids, page) => {
    const announced = opts.lastOn?.[page] ?? (page < last && last > 0 ? last : undefined);
    return [page, cards(ids) + (announced === undefined ? '' : pager(time, announced)) + (page === 0 && opts.form !== false && time === 'All' ? TIME_SELECT : '')];
  }));
};
const run = (config: Record<string, unknown> = {}) => fetchSwatchGroupJobs({ origin: ORIGIN, lang: 'fr', ...config });
const listingCalls = () => vi.mocked(fetchText).mock.calls.map(([url]) => String(url)).filter((u) => u.includes('/job-finder'));
beforeEach(() => vi.resetAllMocks());

describe('Swatch Group — lectures réelles du 02/10/2026 : le listing complet en cache deux, ses deux partitions les rendent', () => {
  const listesRaw = gunzipSync(readFileSync(new URL('./__fixtures__/swatchgroup-listes-partitions-20261002.json.gz', import.meta.url)));
  const pagesRaw = brotliDecompressSync(readFileSync(new URL('./__fixtures__/swatchgroup-pages-reelles-20261002.json.br', import.meta.url)));
  type Lecture = Record<'All' | '20' | '21', { at: string; last: number; pages: string[][] }>;
  const listes = JSON.parse(listesRaw.toString('utf8')) as { lectures: Record<'1' | '2', Lecture> };
  const reelles = JSON.parse(pagesRaw.toString('utf8')) as Record<string, string>;
  const idsOf = (html: string) => [...new Set([...html.matchAll(/href="\/[a-z]{2}\/job\/(\d+)"/g)].map((m) => m[1]))];
  const distinct = (pages: string[][]) => new Set(pages.flat().map((l) => l.split(':')[1]));
  /** Sert une lecture : pages réelles quand elles sont archivées (seconde lecture), sinon reconstruites depuis leurs liens. */
  const serveLecture = (n: '1' | '2', withReal: boolean, alter: (time: string, page: number, html: string) => string = (_t, _p, h) => h) => {
    const lecture = listes.lectures[n];
    const plan: Plan = {};
    for (const time of ['All', '20', '21'] as const) {
      const synthetic = sweepOf(time, lecture[time].pages);
      plan[time] = Object.fromEntries(Object.entries(synthetic).map(([page, html]) => [page, alter(time, Number(page), (withReal ? reelles[`${time}-p${page}`] : undefined) ?? html)]));
    }
    serve(plan);
  };

  it('prémisse : fixtures intactes ; 331 annoncées (33 × 10 + 1) ; 329 distinctes au listing complet, 274 + 57 aux partitions, disjointes', () => {
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    expect(sha(listesRaw)).toBe('eb43073234167d94d0c5c0b6b2ba520dc37d2e39ac87cc04f1e0f970f28a21fa');
    expect(sha(pagesRaw)).toBe('edb8ef68f7b9f790a60a54ad0392fbba8a2693930268aac2b5952c2247e1885c');
    for (const n of ['1', '2'] as const) {
      const l = listes.lectures[n];
      expect([l.All.last, l['20'].last, l['21'].last]).toEqual([33, 27, 5]);
      expect(l.All.pages.map((p) => p.length)).toEqual([...Array(33).fill(10), 1, 0]);
      expect(distinct(l.All.pages).size).toBe(329);
      expect([distinct(l['20'].pages).size, distinct(l['21'].pages).size]).toEqual([274, 57]);
      const [p20, p21] = [distinct(l['20'].pages), distinct(l['21'].pages)];
      expect([...p20].filter((id) => p21.has(id))).toEqual([]);
      // Les deux offres que le listing complet ne sert jamais sont dans les partitions.
      const all = distinct(l.All.pages);
      expect([...p20, ...p21].filter((id) => !all.has(id)).sort()).toEqual(['33253', '33295']);
    }
    // Les pages réelles archivées sont bien celles de la seconde lecture, et le pager réel se lit.
    expect(idsOf(reelles['All-p0'])).toEqual(listes.lectures['2'].All.pages[0].map((l) => l.split(':')[1]));
    expect(idsOf(reelles['All-p33'])).toEqual(['18551']);
    expect([reelles['All-p34'], reelles['20-p28'], reelles['21-p6']].map((h) => idsOf(h).length)).toEqual([0, 0, 0]);
    expect(announcedLastPage(reelles['All-p0'])).toEqual({ lastIndex: 33, viaLastLink: true });
    expect(announcedLastPage(reelles['21-p0'])).toEqual({ lastIndex: 5, viaLastLink: true });
    // Cinq pages ou moins : pas de lien « Dernier », le plus grand numéro du pager (position=64, pages 0 à 4).
    expect(announcedLastPage(reelles['position64-p0'])).toEqual({ lastIndex: 4, viaLastLink: false });
    expect(selectOptionValues(reelles['All-p0'], 'time')).toEqual(['20', '21']);
  });

  it('seconde lecture (05:06–05:09 UTC), pages réelles : prouvée, 331 offres sur 331, PARTITIONS_RECONCILED', async () => {
    serveLecture('2', true);
    const r = await run();
    expect(r).toMatchObject({ declaredTotal: 331, complete: true, truncated: false, rejectedRows: [] });
    expect(r.enumeration).toMatchObject({ rawCount: 331, termination: 'PARTITIONS_RECONCILED', issues: [] });
    expect(r.jobs).toHaveLength(331);
    expect(r.jobs.map((j) => j.externalId)).toEqual(expect.arrayContaining(['33253', '33295']));
    // 35 + 29 + 7 requêtes de listing, dans cet ordre : complet, puis 20, puis 21.
    expect(listingCalls()).toEqual([...Array.from({ length: 35 }, (_, p) => listUrl('All', p)), ...Array.from({ length: 29 }, (_, p) => listUrl('20', p)),
      ...Array.from({ length: 7 }, (_, p) => listUrl('21', p))]);
  });

  it('première lecture (04:56–05:05 UTC) : prouvée aussi, et la même union de 331 que la seconde', async () => {
    serveLecture('1', false);
    const first = await run();
    vi.resetAllMocks();
    serveLecture('2', true);
    const second = await run();
    expect([first.complete, second.complete]).toEqual([true, true]);
    const ids = (r: typeof first) => r.jobs.map((j) => j.externalId).sort();
    expect(ids(first)).toHaveLength(331);
    expect(ids(first)).toEqual(ids(second));
  });

  it('sans le filtre du formulaire, la même lecture réelle n\'est pas prouvée : 329 sur 331, PARTITION_FILTER_ABSENT', async () => {
    // Prémisse : seul le `<select name="time">` est retiré de la page 0 réelle ; le reste est servi tel quel.
    expect(selectOptionValues(reelles['All-p0'].replace(/<select[^>]*name="time"[\s\S]*?<\/select>/, ''), 'time')).toEqual([]);
    serveLecture('2', true, (time, page, html) => (time === 'All' && page === 0 ? html.replace(/<select[^>]*name="time"[\s\S]*?<\/select>/, '') : html));
    const r = await run();
    expect(r).toMatchObject({ declaredTotal: 331, complete: false });
    expect(r.enumeration?.rawCount).toBe(329);
    expect(r.enumeration?.issues).toEqual(['PARTITION_FILTER_ABSENT', 'PUBLISHER_TOTAL_NOT_REACHED', 'ENUMERATION_NOT_PROVEN']);
    expect(listingCalls()).toHaveLength(35);
  });

  it('une page servie d\'un autre état du listing (cache Akamai, mesuré le 02/10 à 04:53) : non prouvé', async () => {
    // Le 02/10 à 04:53, les pages 3 et 7 annonçaient 32 pages quand la page 0 en annonçait 33. Ici, la seule page 3
    // réannonce 32 ; tout le reste est la seconde lecture réelle, qui serait prouvée.
    serveLecture('2', true, (time, page, html) => (time === 'All' && page === 3 ? html.replace(/time=All&amp;page=33" aria-label/, 'time=All&amp;page=32" aria-label') : html));
    const r = await run();
    // Prémisse : la page altérée annonce bien 32, et l'union atteint quand même 331.
    expect(r.enumeration?.pageEvidence?.find((p) => p.url === listUrl('All', 3))?.publisherCounter).toBe('lastPage=32');
    expect(r.enumeration?.rawCount).toBe(331);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(['LAST_PAGE_ANNOUNCEMENT_CHANGED', 'ENUMERATION_NOT_PROVEN']);
  });
});

describe('Swatch Group — la preuve tombe dès que les lectures ne se recoupent plus', () => {
  it('un ordre stable, partitions comprises : prouvé, PARTITIONS_RECONCILED, aucune requête hors du jeu attendu', async () => {
    serve({ All: sweepOf('All', [[1, 2], [3], []]), 20: sweepOf('20', [[1, 2], []]), 21: sweepOf('21', [[3], []]) });
    const r = await run();
    expect(r).toMatchObject({ declaredTotal: 3, complete: true });
    expect(r.enumeration).toMatchObject({ rawCount: 3, pages: 7, termination: 'PARTITIONS_RECONCILED', issues: [] });
    expect(listingCalls()).toEqual([listUrl('All', 0), listUrl('All', 1), listUrl('All', 2), listUrl('20', 0), listUrl('20', 1), listUrl('21', 0), listUrl('21', 1)]);
  });

  it('partitions dont la somme ne fait pas le total (une offre hors du filtre, ou ajoutée entre deux lectures) : PARTITION_TOTALS_DIFFER', async () => {
    // Total 4, toutes vues par le listing complet ; partitions 2 + 1 = 3.
    serve({ All: sweepOf('All', [[1, 2], [3, 4], []]), 20: sweepOf('20', [[1, 2], []]), 21: sweepOf('21', [[3], []]) });
    const r = await run();
    // Prémisse : l'union atteint le total, toutes les formes tiennent ; seul le recoupement des totaux manque.
    expect(r.enumeration?.rawCount).toBe(4);
    expect(r.enumeration?.scopes?.filter((s) => s.scope.startsWith('listing:')).map((s) => [s.scope, s.declaredTotal, s.complete])).toEqual([
      ['listing:time=All', 4, true], ['listing:time=20', 2, true], ['listing:time=21', 1, true]]);
    expect(r).toMatchObject({ declaredTotal: 4, complete: false });
    expect(r.enumeration?.issues).toEqual(['PARTITION_TOTALS_DIFFER', 'ENUMERATION_NOT_PROVEN']);
  });

  it('une offre servie dans deux partitions : PARTITION_OVERLAP, non prouvé', async () => {
    // Total 4 ; partitions 2 + 2 = 4, union 4 : seule l'offre 2, dans les deux, trahit des lectures incohérentes.
    serve({ All: sweepOf('All', [[1, 2], [3, 4], []]), 20: sweepOf('20', [[1, 2], []]), 21: sweepOf('21', [[2, 4], []]) });
    const r = await run();
    expect(r.enumeration?.rawCount).toBe(4);
    expect(r.enumeration?.scopes?.find((s) => s.scope === 'listing:time=21')).toMatchObject({ declaredTotal: 2, complete: true });
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(['PARTITION_OVERLAP', 'ENUMERATION_NOT_PROVEN']);
  });

  it('une offre cachée partout (complet et partition) : PUBLISHER_TOTAL_NOT_REACHED, non prouvé', async () => {
    // Total 6 ; l'offre 4 est cachée par le listing complet ET par sa partition (2 servie deux fois dans les deux).
    serve({ All: sweepOf('All', [[1, 2], [2, 3], [5, 6], []]), 20: sweepOf('20', [[1, 2], [2, 3], []]), 21: sweepOf('21', [[5, 6], []]) });
    const r = await run();
    expect(r.enumeration?.scopes?.filter((s) => s.scope.startsWith('listing:')).map((s) => s.declaredTotal)).toEqual([6, 4, 2]);
    expect(r).toMatchObject({ declaredTotal: 6, complete: false });
    expect(r.enumeration?.rawCount).toBe(5);
    expect(r.enumeration?.issues).toEqual(['PUBLISHER_TOTAL_NOT_REACHED', 'ENUMERATION_NOT_PROVEN']);
  });

  it('une union qui dépasse le total (listing changé pendant la collecte) : UNION_ABOVE_PUBLISHER_TOTAL', async () => {
    serve({ All: sweepOf('All', [[1, 2], [3, 4], []]), 20: sweepOf('20', [[1, 5], [2], []]), 21: sweepOf('21', [[3], []]) });
    const r = await run();
    expect(r.enumeration?.scopes?.filter((s) => s.scope.startsWith('listing:')).map((s) => s.declaredTotal)).toEqual([4, 3, 1]);
    expect(r).toMatchObject({ declaredTotal: 4, complete: false });
    expect(r.enumeration?.issues).toEqual(['UNION_ABOVE_PUBLISHER_TOTAL', 'ENUMERATION_NOT_PROVEN']);
  });

  it('une page au-delà de la dernière qui porte encore des liens : aucun total, non prouvé, partitions lues quand même', async () => {
    // « Dernier » annonce la page 1 ; la page 2 porte pourtant l'offre 4.
    serve({ All: { 0: cards([1, 2]) + pager('All', 1) + TIME_SELECT, 1: cards([3]), 2: cards([4]) }, 20: sweepOf('20', [[1, 2], []]), 21: sweepOf('21', [[3, 4], []]) });
    const r = await run();
    expect(r.enumeration?.pageEvidence?.find((p) => p.url === listUrl('All', 2))?.ids).toEqual(['4']);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.termination).toBe('PAGE_BEYOND_LAST_NOT_EMPTY');
    expect(r.enumeration?.issues).toEqual(['PAGE_BEYOND_LAST_NOT_EMPTY', 'ENUMERATION_NOT_PROVEN']);
    expect(listingCalls().filter((u) => !u.endsWith('time=All'))).toHaveLength(4);
  });

  it('une page intermédiaire plus courte que la première : non prouvé', async () => {
    serve({ All: sweepOf('All', [[1, 2], [3], [4], []]), 20: sweepOf('20', [[1, 2], []]), 21: sweepOf('21', [[3, 4], []]) });
    const r = await run();
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(['PAGE_SIZE_INCONSISTENT', 'ENUMERATION_NOT_PROVEN']);
  });

  it('au-delà du budget de pages : tronqué, non prouvé', async () => {
    serve({ All: sweepOf('All', [[1, 2], [3, 4], [5, 6], [7], []]), 20: sweepOf('20', [[1, 2], []]), 21: sweepOf('21', [[3], []]) });
    const r = await run({ maxPages: 3 });
    expect(r).toMatchObject({ complete: false, truncated: true });
    expect(r.enumeration?.termination).toBe('PAGE_BUDGET_EXHAUSTED');
  });

  it('names an unparsed and a failed detail as rejected rows and refuses the proof', async () => {
    serve({ All: sweepOf('All', [[1, 2], [3], []]), 20: sweepOf('20', [[1, 2], []]), 21: sweepOf('21', [[3], []]) },
      { 1: detail(1), 2: '<html><body>no title, no id</body></html>', 3: new Error('HTTP 503') });
    const r = await run();
    expect(r.jobs).toHaveLength(1); expect(r.declaredTotal).toBe(3); expect(r.complete).toBe(false); expect(r.truncated).toBe(false);
    expect(r.rejectedRows?.map((x) => x.reason).sort()).toEqual(['DETAIL_FETCH_FAILED', 'DETAIL_UNPARSED']);
    expect(r.enumeration?.issues).toEqual(['DETAILS_REJECTED', 'ENUMERATION_NOT_PROVEN']);
  });

  it('aucun lien au listing complet : échec franc, jamais un board vide', async () => {
    serve({ All: { 0: '<html>maintenance</html>' } });
    await expect(run()).rejects.toThrow(/aucun lien \/job\//);
  });
});

describe('Swatch Group — deux captures, le même ensemble de requêtes de listing (ACCESS_SCOPE, RUN du 30/09/2026)', () => {
  const observed = (urls: string[]): ObservedRequest[] => urls.map((u) => ({ method: 'GET', url: new URL(u), contentType: 'text/html; charset=UTF-8' }));
  const outside = (scopes: AccessScope[], urls: string[]) => urls.filter((url) => {
    try { matchingAccessScope(scopes, { url, method: 'GET', format: 'HTTP_RESPONSE', userAgent: CRAWLER_IDENTITY } as never); return false; }
    catch { return true; }
  });
  const capture = async (plan: Plan) => {
    vi.resetAllMocks();
    serve(plan);
    const r = await run();
    const urls = vi.mocked(fetchText).mock.calls.map(([url]) => String(url));
    return { r, urls, listing: urls.filter((u) => u.includes('/job-finder')) };
  };

  it('validation et ingestion servies dans un autre ordre : mêmes requêtes de listing, périmètre de la première couvrant la seconde', async () => {
    // L'offre 4 est cachée par le listing complet ; la validation la trouve dans « 20 », l'ingestion dans « 21 ».
    const validation = await capture({ All: sweepOf('All', [[1, 2], [2, 3], []]), 20: sweepOf('20', [[1, 4], []]), 21: sweepOf('21', [[2, 3], []]) });
    const ingestion = await capture({ All: sweepOf('All', [[1, 2], [2, 3], []]), 20: sweepOf('20', [[1, 2], []]), 21: sweepOf('21', [[4, 3], []]) });
    // Prémisse : les deux captures sont prouvées, par des pages différentes.
    for (const { r } of [validation, ingestion]) expect(r).toMatchObject({ declaredTotal: 4, complete: true, enumeration: { termination: 'PARTITIONS_RECONCILED' } });
    expect(ingestion.listing).toEqual(validation.listing);
    const scopes = deriveAccessScopes('swatchgroup', observed(validation.urls));
    const listingScope = scopes.find((s) => s.path.value === '/fr/job-finder');
    expect(listingScope).toMatchObject({ path: { kind: 'EXACT' }, query: { fixed: { search_api_fulltext: '', jf_country: 'All', domain: 'All', position: 'All', contract: 'All' } } });
    expect([...(listingScope?.query.variable ?? [])].sort()).toEqual(['page', 'time']);
    expect(outside(scopes, ingestion.urls)).toEqual([]);
    // Contre-témoins : une autre langue, un paramètre jamais observé, un filtre autrement fixé, un chemin voisin.
    expect(outside(scopes, [`${ORIGIN}/en/job-finder?page=0&${FORM}&time=All`, `${listUrl('All', 0)}&sort=date`,
      `${ORIGIN}/fr/job-finder?page=0&search_api_fulltext=&jf_country=79&domain=All&position=All&contract=All&time=All`,
      `${ORIGIN}/fr/job-finder-archive?page=0&${FORM}&time=All`])).toHaveLength(4);
  });
});

describe('Swatch Group — le pager de l\'ancien listing (30/09/2026) se lit toujours', () => {
  it('page 0 réelle sans champs de formulaire : « Dernier » vers la page 34', () => {
    const p0 = gunzipSync(readFileSync(new URL('./__fixtures__/swatchgroup-liste-p0-20260930.html.gz', import.meta.url))).toString('utf8');
    expect(createHash('sha256').update(p0).digest('hex')).toBe('5a4ad5321129e282e5c9d632188087229ccebc37d857a1defb907d79f9476295');
    expect(announcedLastPage(p0)).toEqual({ lastIndex: 34, viaLastLink: true });
    expect(selectOptionValues(p0, 'time')).toEqual(['20', '21']);
  });
});
