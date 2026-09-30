import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { fetchPhenomJobs } from './phenom.js';

/** Foot Locker, 2026-09-09 : 2 836 lues pour 2 847 déclarées — une page courte au milieu du board arrêtait la lecture. */
const entry = (id: number) => ({ data: { jobId: String(id), title: `Sales Associate ${id}`, city: 'Paris', country: 'France', country_code: 'FR', applyUrl: `https://careers.example.com/job/${id}` } });
const page = (ids: number[], total: number) => ({ jobs: ids.map(entry), totalCount: total });
beforeEach(() => vi.resetAllMocks());

/** CareerConnect (/widgets) : Hugo Boss au RUN du 29/09/2026, 775 lignes servies pour 546 identifiants. */
const cc = (ids: number[], total: number) => ({ refineSearch: { totalHits: total, data: { jobs: ids.map((i) => ({ jobSeqNo: `SEQ${i}`, title: `Client Advisor ${i}`, country: 'France' })) } } });
const ccConfig = { origin: 'https://careers.hugoboss.com', dialect: 'CAREER_CONNECT_WIDGETS' };

describe('Phenom CareerConnect — ordre instable, relecture de réconciliation', () => {
  it('une offre servie deux fois en cachait une autre : la relecture la retrouve, le tableau est prouvé, la répétition reste nommée', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce(cc([1, 2, 3, 4], 6)).mockResolvedValueOnce(cc([3, 4], 6)).mockResolvedValueOnce(cc([], 6))
      // relecture : l'ordre a bougé, 5 et 6 apparaissent
      .mockResolvedValueOnce(cc([5, 6, 1, 2], 6));
    const r = await fetchPhenomJobs(ccConfig);
    // Prémisse : la première lecture seule ne voit que 4 identifiants sur 6.
    expect(r.enumeration?.pageEvidence?.slice(0, 3).flatMap((p) => p.ids)).toEqual(['SEQ1', 'SEQ2', 'SEQ3', 'SEQ4', 'SEQ3', 'SEQ4']);
    expect(r.jobs).toHaveLength(6); expect(r.complete).toBe(true); expect(fetchJson).toHaveBeenCalledTimes(4);
    expect(r.enumeration?.termination).toBe('SECOND_SWEEP_RECONCILED');
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['REPEATED_IDS_ACROSS_PAGES', 'RECONCILED_BY_SECOND_SWEEP']));
    expect(r.enumeration?.issues).not.toContain('ENUMERATION_NOT_PROVEN');
    expect(r.enumeration?.pageEvidence?.at(-1)?.componentCounters).toEqual(expect.arrayContaining(['pass=2', 'fresh=2']));
  });
  it('trois relectures sans l’offre manquante : jamais prouvé', async () => {
    const mock = vi.mocked(fetchJson);
    mock.mockResolvedValueOnce(cc([1, 2, 3], 4)).mockResolvedValueOnce(cc([3], 4)).mockResolvedValueOnce(cc([], 4));
    for (let pass = 0; pass < 3; pass++) mock.mockResolvedValueOnce(cc([1, 2, 3], 4)).mockResolvedValueOnce(cc([2], 4));
    const r = await fetchPhenomJobs(ccConfig);
    expect(r.jobs).toHaveLength(3); expect(r.complete).toBe(false); expect(fetchJson).toHaveBeenCalledTimes(9);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['REPEATED_IDS_ACROSS_PAGES', 'ENUMERATION_NOT_PROVEN']));
    expect(r.enumeration?.issues).not.toContain('RECONCILED_BY_SECOND_SWEEP');
  });
});

describe('Phenom — énumération prouvée contre le total éditeur', () => {
  it('continue après une page courte tant que le total n’est pas atteint, puis prouve l’énumération', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => i), 205))
      .mockResolvedValueOnce(page(Array.from({ length: 95 }, (_, i) => 100 + i), 205))   // page allégée : 5 entrées de moins
      .mockResolvedValueOnce(page(Array.from({ length: 10 }, (_, i) => 195 + i), 205));
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.jobs).toHaveLength(205); expect(r.declaredTotal).toBe(205); expect(r.complete).toBe(true); expect(r.truncated).toBe(false);
    expect(r.enumeration?.termination).toBe('PUBLISHER_TOTAL_REACHED'); expect(r.enumeration?.pages).toBe(3);
  });
  it('n’annonce pas complet quand le board se répète avant le total, ni quand le total change', async () => {
    const same = page(Array.from({ length: 100 }, (_, i) => i), 300);
    vi.mocked(fetchJson).mockResolvedValueOnce(same).mockResolvedValueOnce({ ...same, totalCount: 301 });
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.jobs).toHaveLength(100); expect(r.complete).toBe(false); expect(r.truncated).toBe(true);
    expect(r.enumeration?.termination).toBe('REPEATED_PAGE'); expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['SOURCE_TOTAL_CHANGED', 'ENUMERATION_NOT_PROVEN']));
  });
  it('sans total éditeur, une page courte termine la lecture et rien n’est prouvé', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({ jobs: [entry(1), entry(2)] });
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.jobs).toHaveLength(2); expect(r.complete).toBe(false); expect(r.enumeration?.termination).toBe('SHORT_PAGE');
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
  it('Foot Locker: as many entries served as announced, but ids repeated across pages — the cause is named, the proof refused', async () => {
    vi.mocked(fetchJson)
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, i) => i), 150))
      .mockResolvedValueOnce(page([99, ...Array.from({ length: 49 }, (_, i) => 100 + i)], 150))   // 50 entries, one already served
      .mockResolvedValueOnce(page([], 150));
    const r = await fetchPhenomJobs({ origin: 'https://careers.example.com' });
    expect(r.jobs).toHaveLength(149); expect(r.declaredTotal).toBe(150); expect(r.complete).toBe(false);
    expect(r.enumeration?.rawCount).toBe(150); expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['REPEATED_IDS_ACROSS_PAGES', 'ENUMERATION_NOT_PROVEN']));
    expect(r.enumeration?.pageEvidence).toHaveLength(3); expect(r.enumeration?.termination).toBe('EMPTY_PAGE'); expect(r.enumeration?.pageEvidence?.[1]?.componentCounters).toContain('repeated=1');
  });
});

describe('Phenom — variantes de langue (Foot Locker, réponses réelles du 2026-09-10)', () => {
  it('une même réquisition servie dans une seconde langue est une ligne annoncée et comptée, pas un identifiant répété : énumération prouvée', async () => {
    const { readFileSync } = await import('node:fs');
    const real = JSON.parse(readFileSync(new URL('./fixtures/lot4-phenom-footlocker-language-variant.json', import.meta.url), 'utf8'));
    vi.mocked(fetchJson).mockResolvedValueOnce(real.page1).mockResolvedValueOnce(real.page2);
    const r = await fetchPhenomJobs({ origin: 'https://careers.footlocker.com' });
    // page 1: req 71489 (fr-fr) + 2 others ; page 2: req 71489 (en-us) + 1 other → 4 requisitions, 1 language variant, 5 announced
    expect(r.declaredTotal).toBe(5); expect(r.jobs).toHaveLength(4); expect(r.complete).toBe(true); expect(r.truncated).toBe(false);
    expect(r.enumeration?.issues).toEqual(['LANGUAGE_VARIANTS_DEDUPLICATED']); expect(r.enumeration?.termination).toBe('PUBLISHER_TOTAL_REACHED');
    expect(r.jobs.filter((j) => j.externalId === '71489')).toHaveLength(1);
    expect(r.enumeration?.scopes?.find((s) => s.scope === 'languageVariants')).toMatchObject({ declaredTotal: 1 });
  });
  it('la même réquisition servie deux fois dans la MÊME langue reste un identifiant répété qui refuse la preuve', async () => {
    const { readFileSync } = await import('node:fs');
    const real = JSON.parse(readFileSync(new URL('./fixtures/lot4-phenom-footlocker-language-variant.json', import.meta.url), 'utf8'));
    const sameLanguage = { ...real.page2, jobs: [{ data: { ...real.page1.jobs[0].data } }, ...real.page2.jobs.slice(1)] };
    vi.mocked(fetchJson).mockResolvedValueOnce(real.page1).mockResolvedValueOnce(sameLanguage).mockResolvedValueOnce({ totalCount: 5, jobs: [] });
    const r = await fetchPhenomJobs({ origin: 'https://careers.footlocker.com' });
    expect(r.jobs).toHaveLength(4); expect(r.complete).toBe(false); expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['REPEATED_IDS_ACROSS_PAGES', 'ENUMERATION_NOT_PROVEN']));
  });
});
