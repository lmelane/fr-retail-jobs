import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
vi.mock('../../observability/logger.js', () => ({ log: { error: vi.fn(async () => {}), info: vi.fn(async () => {}), warn: vi.fn(async () => {}) } }));
import { fetchText } from '../../lib/http.js';
import { fetchSwatchGroupJobs } from './swatchgroup.js';

/** Le pager Drupal réel : le lien « Dernier » porte l'icône `icon--last`. */
const pager = (last: number) => `<a class="page-link" href="?page=${last}" aria-label="Dernier"> <span aria-hidden="true"><i class="icon--last"></i></span></a>`;
const listing = (ids: number[], last?: number) => ids.map((i) => `<a href="/en/job/${i}">x</a><a href="/en/job/${i}">y</a>`).join('') + (last === undefined ? '' : pager(last));
const detail = (id: number) => `<html><body><h1>Vendeur ${id}</h1><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: `Vendeur ${id}`, datePosted: '2026-09-01', description: 'Poste réel et complet pour la boutique.', hiringOrganization: { name: 'Swatch' } })}</script><div id="jl">Genève</div></body></html>`;
const details = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), detail(i + 1)]));
/** Chaque page rend, lecture après lecture, ce que prévoit sa liste ; la dernière réponse se répète. */
function route(pages: Record<string, string[]>, detailPages: Record<string, string | Error>) {
  const reads = new Map<string, number>();
  vi.mocked(fetchText).mockImplementation(async (url: string) => {
    const page = /page=(\d+)/.exec(url)?.[1];
    if (page !== undefined) {
      const n = reads.get(page) ?? 0; reads.set(page, n + 1);
      const plan = pages[page] ?? [''];
      return plan[Math.min(n, plan.length - 1)];
    }
    const id = /\/job\/(\d+)/.exec(url)?.[1]!; const d = detailPages[id]; if (d instanceof Error) throw d; return d ?? '';
  });
  return reads;
}
const run = () => fetchSwatchGroupJobs({ origin: 'https://www.swatchgroup.com', lang: 'fr' });
beforeEach(() => vi.resetAllMocks());

describe('Swatch Group — le total publié par le pager, sur les pages réelles du 30/09/2026', () => {
  const fixture = (name: string) => gunzipSync(readFileSync(new URL(`./__fixtures__/swatchgroup-liste-${name}-20260930.html.gz`, import.meta.url))).toString('utf8');
  const [p0, p34, p35] = ['p0', 'p34', 'p35'].map(fixture);
  const idsOf = (html: string) => [...new Set([...html.matchAll(/href="\/[a-z]{2}\/job\/(\d+)"/g)].map((m) => m[1]))];

  it('prémisse : pages archivées de la collecte de 05:13 ; « Dernier » vers la page 34, 10 liens par page, 8 sur la dernière, 0 au-delà', () => {
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    expect([p0, p34, p35].map(sha)).toEqual(['5a4ad5321129e282e5c9d632188087229ccebc37d857a1defb907d79f9476295',
      '76bd1c7ffd1e626c1d24bbef9ffe8b1b62ee95d36e15b6a0daf4e45e3e04fc72', '556802d2953b707e3c728e98a79a96636f770fdedf8f8b11aefba35672e23450']);
    expect(/href="\?page=(\d+)"[^>]*>\s*<span[^>]*>\s*<i class="icon--last"/.exec(p0)?.[1]).toBe('34');
    expect([p0, p34, p35].map((html) => idsOf(html).length)).toEqual([10, 8, 0]);
  });

  it('le listing réel annonce 348 offres ; 328 liens distincts, comme le 30/09, ne sont pas une preuve', async () => {
    // Pages réelles 0, 34 et 35 ; pages 1 à 33 de 10 liens, dont une répétition sur chacune des 20 premières :
    // 10 + 20 × 9 + 13 × 10 + 8 = 328 liens distincts, 20 répétés, comme la collecte de 05:13.
    const repeated = Number(idsOf(p0)[0]);
    const pages: Record<string, string[]> = { '0': [p0], '34': [p34], '35': [p35] };
    let next = 100_000;
    for (let page = 1; page <= 33; page += 1) {
      const fresh = Array.from({ length: page <= 20 ? 9 : 10 }, () => next++);
      pages[String(page)] = [listing(page <= 20 ? [repeated, ...fresh] : fresh)];
    }
    route(pages, {});
    const r = await run();
    expect(r.declaredTotal).toBe(348);
    expect(r.enumeration?.rawCount).toBe(328);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['PUBLISHER_TOTAL_NOT_REACHED', 'ENUMERATION_NOT_PROVEN']));
  });
});

describe('Swatch Group — prouvé seulement quand l\'union des lectures atteint le total du pager', () => {
  it('un ordre stable : une lecture suffit, terminaison PUBLISHER_TOTAL_REACHED', async () => {
    const reads = route({ '0': [listing([1, 2], 1)], '1': [listing([3])], '2': [''] }, details(3));
    const r = await run();
    expect(r.jobs.map((j) => j.externalId).sort()).toEqual(['1', '2', '3']);
    expect(r).toMatchObject({ declaredTotal: 3, complete: true, truncated: false, rejectedRows: [] });
    expect(r.enumeration).toMatchObject({ pages: 3, termination: 'PUBLISHER_TOTAL_REACHED', issues: [] });
    expect([...reads.values()]).toEqual([1, 1, 1]);
  });

  it('le défaut du 30/09 : une offre servie deux fois en cache une autre ; la relecture la retrouve', async () => {
    // Total annoncé : 1 × 2 + 2 = 4. Première lecture : 2 répété, 4 caché. Seconde : 4 apparaît.
    const reads = route({ '0': [listing([1, 2], 1), listing([1, 4], 1)], '1': [listing([2, 3])], '2': [''] }, details(4));
    const r = await run();
    expect(r.jobs.map((j) => j.externalId).sort()).toEqual(['1', '2', '3', '4']);
    expect(r).toMatchObject({ declaredTotal: 4, complete: true });
    expect(r.enumeration).toMatchObject({ termination: 'SECOND_SWEEP_RECONCILED', issues: ['RECONCILED_BY_SECOND_SWEEP'] });
    expect(reads.get('0')).toBe(2);
  });

  it('une offre servie sous un autre préfixe de langue à la relecture reste une seule offre', async () => {
    // Prémisse : les pages réelles mêlent les préfixes (en, fr, de, it) d'une offre à l'autre.
    const fr = (ids: number[], last?: number) => listing(ids, last).replaceAll('/en/job/', '/fr/job/');
    route({ '0': [listing([1, 2], 1), fr([1, 4], 1)], '1': [listing([2, 3])], '2': [''] }, details(4));
    const r = await run();
    expect(r).toMatchObject({ declaredTotal: 4, complete: true });
    expect(r.enumeration).toMatchObject({ rawCount: 4, termination: 'SECOND_SWEEP_RECONCILED' });
  });

  it('une offre jamais servie en six lectures : non prouvé, relectures bornées à cinq', async () => {
    const reads = route({ '0': [listing([1, 2], 1)], '1': [listing([2, 3])], '2': [''] }, details(3));
    const r = await run();
    expect(r).toMatchObject({ declaredTotal: 4, complete: false });
    expect(r.enumeration?.issues).toEqual(['PUBLISHER_TOTAL_NOT_REACHED', 'RECONCILED_BY_SECOND_SWEEP', 'ENUMERATION_NOT_PROVEN']);
    expect(reads.get('0')).toBe(6);
    expect(reads.get('1')).toBe(6);
    expect(reads.get('2')).toBe(1);
  });

  it('une page au-delà de la dernière qui porte encore des liens : aucun total, non prouvé', async () => {
    route({ '0': [listing([1, 2], 1)], '1': [listing([3])], '2': [listing([4])] }, details(4));
    const r = await run();
    expect(r.complete).toBe(false);
    expect(r.enumeration?.termination).toBe('PAGE_BEYOND_LAST_NOT_EMPTY');
    expect(r.enumeration?.issues).toEqual(['PAGE_BEYOND_LAST_NOT_EMPTY', 'ENUMERATION_NOT_PROVEN']);
  });

  it('une page intermédiaire plus courte que la première : aucun total, non prouvé', async () => {
    route({ '0': [listing([1, 2], 2)], '1': [listing([3])], '2': [listing([4])], '3': [''] }, details(4));
    const r = await run();
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(['PAGE_SIZE_INCONSISTENT', 'ENUMERATION_NOT_PROVEN']);
  });

  it('une union qui dépasse le total (listing changé pendant la collecte) : non prouvé', async () => {
    // Total annoncé : 4. Première lecture : 1, 2, 3. Seconde : 5 et 6 apparaissent, l'union compte 5.
    route({ '0': [listing([1, 2], 1), listing([5, 6], 1)], '1': [listing([2, 3])], '2': [''] }, details(6));
    const r = await run();
    expect(r).toMatchObject({ declaredTotal: 4, complete: false });
    expect(r.enumeration?.issues).toEqual(['UNION_ABOVE_PUBLISHER_TOTAL', 'RECONCILED_BY_SECOND_SWEEP', 'ENUMERATION_NOT_PROVEN']);
  });

  it('sans lien « Dernier » : lecture jusqu\'à une page sans lien nouveau, jamais prouvée', async () => {
    route({ '0': [listing([1, 2])], '1': [listing([3])], '2': [listing([3])] }, details(3));
    const r = await run();
    expect(r.jobs).toHaveLength(3);
    expect(r).toMatchObject({ declaredTotal: 3, complete: false, truncated: false });
    expect(r.enumeration).toMatchObject({ pages: 3, termination: 'REPEATED_PAGE' });
    expect(r.enumeration?.issues).toEqual(['LAST_PAGE_LINK_ABSENT', 'ENUMERATION_NOT_PROVEN']);
  });

  it('names an unparsed and a failed detail as rejected rows and refuses the proof', async () => {
    route({ '0': [listing([1, 2], 1)], '1': [listing([3])], '2': [''] }, { '1': detail(1), '2': '<html><body>no title, no id</body></html>', '3': new Error('HTTP 503') });
    const r = await run();
    expect(r.jobs).toHaveLength(1); expect(r.declaredTotal).toBe(3); expect(r.complete).toBe(false); expect(r.truncated).toBe(false);
    expect(r.rejectedRows?.map((x) => x.reason).sort()).toEqual(['DETAIL_FETCH_FAILED', 'DETAIL_UNPARSED']);
    expect(r.enumeration?.issues).toEqual(['DETAILS_REJECTED', 'ENUMERATION_NOT_PROVEN']);
  });
});
