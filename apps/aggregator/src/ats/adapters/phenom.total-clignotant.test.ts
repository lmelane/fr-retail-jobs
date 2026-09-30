import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { fetchPhenomJobs } from './phenom.js';

/*
 * Foot Locker (careers.footlocker.com, dialecte /api/jobs), RUN du 28/09/2026. Réponses réelles archivées en
 * production, verbatim, avec l'adresse réelle de la requête et la clé de leur RawBlob (SHA-256 vérifié ci-dessous) :
 *  - la capture d'ingestion du RUN (lot c27a4ce6, 19:24, 31 pages) : les pages 11, 21 et 23 annoncent 3 031
 *    entrées, les 28 autres 3 033. La lecture atteint 3 021 offres + 12 variantes de langue = 3 033, sans doublon —
 *    mais SOURCE_TOTAL_CHANGED refusait la preuve : foot-locker-france en DEGRADED « énumération réfutée » ;
 *  - les pages 11, 21 et 23 de la capture de requalification du même RUN (lot 6a7065c7, 19:22, séquences 10, 20,
 *    22), qui annonçaient 3 033 : ce que rend une relecture quand le compteur revient.
 * Fixtures : `scripts/ops/mesures/exporter-reponse-archivee.mts --lot=<lot> [--sequences=…]`.
 */
type Archived = { capture: string; sequence: number; url: string; sha256: string; body: string };
type Page = { totalCount?: number; jobs?: Array<{ data?: { req_id?: string; slug?: string; language?: string } }> };
const load = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./__fixtures__/${name}.json.gz`, import.meta.url))).toString('utf8')) as Archived[];
const run = load('phenom-footlocker-liste-run-20260928');
const reread = load('phenom-footlocker-pages-3033-20260928');
const pageOf = (row: Archived) => Number(new URL(row.url).searchParams.get('page'));
const parsed = (row: Archived) => JSON.parse(row.body) as Page;
const config = { origin: 'https://careers.footlocker.com', brandTag: 'tags4' };

/** Chaque page répond, lecture après lecture, ce que prévoit sa file ; la dernière réponse se répète. */
function serve(plan: Map<number, Page[]>) {
  const reads = new Map<number, number>();
  vi.mocked(fetchJson).mockImplementation(async (url: string) => {
    const page = Number(new URL(url).searchParams.get('page'));
    const n = reads.get(page) ?? 0; reads.set(page, n + 1);
    const queue = plan.get(page);
    if (!queue) throw new Error(`page ${page} non archivée`);
    return structuredClone(queue[Math.min(n, queue.length - 1)]);
  });
  return reads;
}
const planOf = (extra: Map<number, Page[]> = new Map()) => new Map(run.map(row => [pageOf(row), [parsed(row), ...(extra.get(pageOf(row)) ?? [])]]));
beforeEach(() => vi.resetAllMocks());

describe('Phenom Foot Locker — le total qui clignote (RUN du 28/09/2026)', () => {
  it('prémisse : réponses archivées intactes ; trois pages à 3 031, la lecture complète à 3 033 ; relues à 3 033, les mêmes offres dans le même ordre', () => {
    for (const row of [...run, ...reread]) expect(createHash('sha256').update(row.body).digest('hex')).toBe(row.sha256);
    expect(run.map(pageOf)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(run.filter(row => parsed(row).totalCount === 3031).map(pageOf)).toEqual([11, 21, 23]);
    expect(run.filter(row => parsed(row).totalCount !== 3031).every(row => parsed(row).totalCount === 3033)).toBe(true);
    expect(run.reduce((n, row) => n + (parsed(row).jobs?.length ?? 0), 0)).toBe(3033);
    expect(reread.map(pageOf)).toEqual([11, 21, 23]);
    expect(reread.every(row => parsed(row).totalCount === 3033)).toBe(true);
    const ids = (page: Page) => (page.jobs ?? []).map(entry => `${entry.data?.req_id}:${entry.data?.language}`);
    for (const row of reread) expect(ids(parsed(row))).toEqual(ids(parsed(run.find(r => pageOf(r) === pageOf(row))!)));
  });

  it('les trois pages relues annoncent 3 033 : le listing est prouvé, le changement reste nommé', async () => {
    const reads = serve(planOf(new Map(reread.map(row => [pageOf(row), [parsed(row)]]))));
    const r = await fetchPhenomJobs(config);
    expect(r.complete).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.declaredTotal).toBe(3033);
    expect(r.jobs).toHaveLength(3021);
    expect(r.enumeration?.scopes?.find(s => s.scope === 'languageVariants')?.declaredTotal).toBe(12);
    expect(r.enumeration?.termination).toBe('TOTAL_RECONCILED_BY_PAGE_REREAD');
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['SOURCE_TOTAL_CHANGED', 'RECONCILED_BY_PAGE_REREAD']));
    expect(r.enumeration?.issues).not.toContain('ENUMERATION_NOT_PROVEN');
    expect([...reads.entries()].filter(([, n]) => n > 1).map(([page, n]) => [page, n])).toEqual([[11, 2], [21, 2], [23, 2]]);
    expect(r.enumeration?.pageEvidence?.map(p => p.publisherCounter)).toEqual(Array.from({ length: 31 }, () => 'total=3033'));
  });

  it('le compteur ne revient pas : trois relectures par page au plus, jamais prouvé', async () => {
    const reads = serve(planOf());
    const r = await fetchPhenomJobs(config);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['SOURCE_TOTAL_CHANGED', 'ENUMERATION_NOT_PROVEN']));
    expect(r.enumeration?.issues).not.toContain('RECONCILED_BY_PAGE_REREAD');
    expect([...reads.entries()].filter(([, n]) => n > 1)).toEqual([[11, 4], [21, 4], [23, 4]]);
  });
});

describe('Phenom Foot Locker — bornes de la relecture (listes construites)', () => {
  const entry = (id: number) => ({ data: { req_id: String(id), title: `Sales Associate ${id}`, city: 'Paris', country: 'France', language: 'fr-fr', applyUrl: `https://careers.example.com/job/${id}` } });
  const page = (ids: number[], total: number) => ({ jobs: ids.map(entry), totalCount: total });
  const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
  const route = (plan: Record<number, Page[]>) => serve(new Map(Object.entries(plan).map(([k, v]) => [Number(k), v])));

  it('un état en retard décale l\'ordre (doublon, dernière page courte) : relues au total de référence, les pages sont prouvées', async () => {
    // Référence 250 ; la page 2 vient de l'état à 249 (la 199e offre a disparu, 250 recule) : 150 répétée, 199 perdue.
    route({ 1: [page(range(0, 100), 250)], 2: [page([...range(100, 99), 150], 249), page(range(100, 100), 250)], 3: [page(range(200, 50), 250)], 4: [page([], 250)] });
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.complete).toBe(true); expect(r.jobs).toHaveLength(250);
    expect(r.enumeration?.issues).not.toContain('REPEATED_IDS_ACROSS_PAGES');
  });

  it('un vrai changement pendant la lecture (le total ne revient pas) n\'est jamais réconcilié', async () => {
    route({ 1: [page(range(0, 100), 250)], 2: [page(range(100, 100), 250)], 3: [page(range(200, 44), 244)] });
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['SOURCE_TOTAL_CHANGED', 'ENUMERATION_NOT_PROVEN']));
  });

  it('une réponse écartée nomme une offre absente du listing prouvé : les deux états divergent, jamais prouvé', async () => {
    // La page 2 à 249 sert 999, que l'état à 250 ne liste pas : la déclarer absente serait nier ce qu'on vient de lire.
    route({ 1: [page(range(0, 100), 250)], 2: [page([...range(100, 99), 999], 249), page(range(100, 100), 250)], 3: [page(range(200, 50), 250)], 4: [page([], 250)] });
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['TOTAL_STATES_DISAGREE', 'ENUMERATION_NOT_PROVEN']));
  });

  it('l\'état en retard est majoritaire : la référence est le plus grand total, l\'offre en ligne n\'est jamais déclarée absente', async () => {
    // État à jour : 251 offres (dont 999, page 2) ; état en retard : 250, sans 999. La page 1 est lue à jour, les pages
    // 2 et 3 en retard, et une relecture de la page 1 rend l'état en retard : la majorité dit 250.
    const fresh = [...range(0, 100), 999, ...range(100, 150)];
    // Prémisse : première lecture 251, 250, 250 — la majorité est l'état en retard, qui ne liste pas 999.
    expect(fresh).toHaveLength(251); expect(range(0, 250)).not.toContain(999);
    route({ 1: [page(range(0, 100), 251), page(range(0, 100), 250)], 2: [page(range(100, 100), 250), page(fresh.slice(100, 200), 251)],
      3: [page(range(200, 50), 250), page(fresh.slice(200), 251)], 4: [page([], 250), page([], 251)] });
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.jobs.map(j => j.externalId)).toContain('999');
    expect(r.complete).toBe(true); expect(r.declaredTotal).toBe(251);
  });

  it('l\'état en retard ne revient jamais au plus grand total : jamais prouvé', async () => {
    route({ 1: [page(range(0, 100), 251), page(range(0, 100), 250)], 2: [page(range(100, 100), 250)], 3: [page(range(200, 50), 250)], 4: [page([], 250)] });
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toContain('ENUMERATION_NOT_PROVEN');
  });

  it('une variante de langue servie deux fois est une répétition, pas une seconde variante', async () => {
    const variant = (id: number, language: string) => ({ data: { ...entry(id).data, language } });
    // 250 annoncées : 248 offres + la variante en-us de 7, servie deux fois ; l'offre 248 n'est jamais servie.
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      const n = Number(new URL(url).searchParams.get('page'));
      if (n === 1) return { jobs: range(0, 100).map(entry), totalCount: 250 };
      if (n === 2) return { jobs: [...range(100, 99).map(entry), variant(7, 'en-us')], totalCount: 250 };
      if (n === 3) return { jobs: [...range(199, 49).map(entry), variant(7, 'en-us')], totalCount: 250 };
      return { jobs: [], totalCount: 250 };
    });
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    // Prémisse : 250 entrées servies pour 250 annoncées — la règle des variantes seule atteignait le total.
    expect(r.enumeration?.rawCount).toBe(250); expect(r.declaredTotal).toBe(250);
    expect(r.jobs).toHaveLength(248);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toContain('REPEATED_IDS_ACROSS_PAGES');
  });

  it('une relecture en échec abandonne la réconciliation : la première lecture est rendue, non prouvée', async () => {
    const reads = new Map<number, number>();
    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      const n = Number(new URL(url).searchParams.get('page')); const k = reads.get(n) ?? 0; reads.set(n, k + 1);
      if (n === 1) return page(range(0, 100), 250);
      if (n === 2) { if (k > 0) throw new Error('HTTP 503 for ' + url); return page(range(100, 100), 249); }
      if (n === 3) return page(range(200, 50), 250);
      return page([], 250);
    });
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.jobs).toHaveLength(250); expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['RECONCILIATION_READ_FAILED', 'SOURCE_TOTAL_CHANGED', 'ENUMERATION_NOT_PROVEN']));
  });

  it('relues au même total, les pages ne rendent pas le compte : jamais prouvé', async () => {
    route({ 1: [page(range(0, 100), 250)], 2: [page(range(100, 100), 249), page([...range(100, 99), 0], 250)], 3: [page(range(200, 50), 250)] });
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toContain('ENUMERATION_NOT_PROVEN');
  });
});
