import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchWithRetry: vi.fn() }));
vi.mock('../../lib/browser.js', () => ({ fetchRenderedHtml: vi.fn() }));
import { fetchJson, fetchWithRetry } from '../../lib/http.js';
import { fetchEightfoldJobs } from './eightfold.js';
import { readEnumeration } from '../../pipeline/enumerationReading.js';

/**
 * KERING, RUN DU 02/10/2026 (D-522 §6) : « énumération réfutée (REPEATED_IDS_ACROSS_PAGES) », 1 098 positions lues pour
 * 1 099 annoncées.
 *
 * Cause lue dans les deux captures du RUN : le tri par défaut du portail (`sortBy: "hot"`) n'est pas stable entre
 * positions de même date. La position 563705892206374 est servie en dernière ligne utile de start=600, puis de nouveau en
 * tête de start=610, à la place de 563705887980440 (même date de publication) ; le total annoncé ne bouge pas (1 099).
 * La lecture précédente du même RUN servait 563705887980440 à cette place. Aucun autre tri ne règle le problème : `timestamp`
 * et `relevance` laissent aussi des égalités sans ordre garanti (relu en ligne le 03/10).
 *
 * Correctif : comme Phenom et Workday, une répétition qui laisse le total annoncé non atteint déclenche une relecture de
 * réconciliation ; la liste n'est prouvée que si l'union des lectures atteint exactement le total annoncé, sans qu'il change.
 */
const real = JSON.parse(readFileSync(new URL('./__fixtures__/d522-6-eightfold-kering-tri-instable.json', import.meta.url), 'utf8'));
/** Le tableau réduit à ces deux pages réelles : 19 positions distinctes servies au RUN, plus celle qui a été cachée. */
const COUNT = 20;
const page = (positions: unknown[]) => ({ data: { positions, count: COUNT, sortBy: 'hot' } });
const config = { origin: 'https://careers.kering.com', domain: 'kering.com', withDescriptions: false };
const REPEATED = '563705892206374';
const HIDDEN = '563705887980440';

beforeEach(() => { vi.mocked(fetchJson).mockReset(); vi.mocked(fetchWithRetry).mockReset(); vi.mocked(fetchWithRetry).mockRejectedValue(new Error('no session')); });

describe('Eightfold — tri instable entre positions de même date, relecture de réconciliation (Kering, 02/10/2026)', () => {
  it('prémisse : les pages réelles répètent une position et en cachent une autre, à total inchangé', () => {
    const ids = (positions: Array<{ id: number }>) => positions.map((p) => String(p.id));
    const run = [...ids(real.run0210_start600), ...ids(real.run0210_start610)];
    expect(run.filter((id) => id === REPEATED)).toHaveLength(2);
    expect(run).not.toContain(HIDDEN);
    expect(new Set(run).size).toBe(COUNT - 1);
    // La même page, lue plus tôt dans le RUN, servait la position cachée à la place de la répétée.
    expect(ids(real.earlier_start610)[0]).toBe(HIDDEN);
    expect(ids(real.earlier_start610).slice(1)).toEqual(ids(real.run0210_start610).slice(1));
  });

  it('relit la page de la répétition, retrouve la position cachée et prouve la liste ; la répétition reste nommée', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce(page(real.run0210_start600))
      .mockResolvedValueOnce(page(real.run0210_start610))
      .mockResolvedValueOnce(page([]))
      // relecture : la page start=10 sert de nouveau l'ordre de la lecture précédente
      .mockResolvedValueOnce(page(real.earlier_start610));
    const r = await fetchEightfoldJobs(config);
    // Prémisse de la collecte : la première lecture a bien vu la répétition, et pas la position cachée.
    expect(r.enumeration?.pageEvidence?.[1]?.componentCounters).toContain('repeated=1');
    expect(r.enumeration?.pageEvidence?.slice(0, 3).flatMap((p) => p.ids)).not.toContain(HIDDEN);

    expect(r.jobs.map((j) => j.externalId)).toContain(HIDDEN);
    expect(new Set(r.jobs.map((j) => j.externalId)).size).toBe(COUNT);
    expect(r.complete).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.enumeration?.termination).toBe('SECOND_SWEEP_RECONCILED');
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['REPEATED_IDS_ACROSS_PAGES', 'RECONCILED_BY_SECOND_SWEEP']));
    expect(r.enumeration?.issues).not.toContain('ENUMERATION_NOT_PROVEN');
    // Une seule relecture : la page où la répétition a été servie.
    expect(fetchJson).toHaveBeenCalledTimes(4);
    expect(vi.mocked(fetchJson).mock.calls[3]![0]).toContain('start=10&');
    expect(r.enumeration?.pageEvidence?.at(-1)?.componentCounters).toEqual(expect.arrayContaining(['pass=2', 'fresh=1']));
    // La position nouvellement vue entre dans la preuve canonique, une seule fois.
    expect(r.enumeration?.pageEvidence?.flatMap((p) => p.canonicalIds ?? []).filter((id) => id === HIDDEN)).toHaveLength(1);
    expect(readEnumeration(r).enumerationReading).toBe('PROVEN');
  });

  it('une relecture qui ne retrouve jamais la position cachée ne prouve rien, et reste bornée', async () => {
    const mock = vi.mocked(fetchJson);
    mock.mockResolvedValueOnce(page(real.run0210_start600)).mockResolvedValueOnce(page(real.run0210_start610)).mockResolvedValueOnce(page([]));
    mock.mockResolvedValue(page(real.run0210_start610));
    const r = await fetchEightfoldJobs(config);
    expect(r.complete).toBe(false);
    expect(r.jobs).toHaveLength(COUNT - 1);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['REPEATED_IDS_ACROSS_PAGES', 'ENUMERATION_NOT_PROVEN']));
    expect(r.enumeration?.issues).not.toContain('RECONCILED_BY_SECOND_SWEEP');
    expect(readEnumeration(r).enumerationReading).toBe('REFUTED');
    // Bornée : pages ciblées puis relectures complètes, jamais une boucle.
    expect(mock.mock.calls.length).toBeLessThan(20);
  });

  it('un total qui change pendant la relecture refuse la preuve, même quand l’union l’atteint', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce(page(real.run0210_start600))
      .mockResolvedValueOnce(page(real.run0210_start610))
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce({ data: { positions: real.earlier_start610, count: COUNT + 1 } })
      .mockResolvedValue(page([]));
    const r = await fetchEightfoldJobs(config);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['SOURCE_TOTAL_CHANGED', 'ENUMERATION_NOT_PROVEN']));
    expect(r.enumeration?.termination).not.toBe('SECOND_SWEEP_RECONCILED');
  });
});
