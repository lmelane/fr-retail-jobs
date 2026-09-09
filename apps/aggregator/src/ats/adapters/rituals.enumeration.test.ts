import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { fetchRitualsJobs } from './rituals.js';

/**
 * Rituals, 2026-09-09 : 1 250 « hits » déclarés sur l'ensemble des locales,
 * 1 122 postes uniques — le même `_id` est servi dans plusieurs langues. Le
 * total déclaré compte des REPRÉSENTATIONS ; l'énumération est prouvée locale
 * par locale et l'union est le nombre d'offres.
 */
const hit = (id: number, lang: string) => ({ _id: `${id}`, _source: { jobAdId: `${id}`, title: `Shop Advisor ${id} (${lang})`, city: 'Amsterdam', country: 'Netherlands', language: lang, releasedDate: 1757000000000, jobDescriptionPlain: 'A real position.' } });
const response = (ids: number[], lang: string) => ({ hits: { total: { value: ids.length }, hits: ids.map((i) => hit(i, lang)) } });
beforeEach(() => vi.resetAllMocks());

describe('Rituals — union des locales', () => {
  it('prouve chaque locale et rend l’union comme total déclaré', async () => {
    vi.mocked(fetchJson).mockImplementation(async (url, init) => {
      const lang = /"language":"([^"]+)"/.exec(String((init as any)?.body ?? ''))?.[1];
      return lang === 'fr-FR' ? response([1, 2, 3], 'fr-FR') : response([2, 3, 4, 5], 'en-GB');
    });
    const r = await fetchRitualsJobs({ origin: 'https://careers.rituals.com', languages: ['fr-FR', 'en-GB'] });
    expect(r.jobs.map((j) => j.externalId).sort()).toEqual(['1', '2', '3', '4', '5']);
    expect(r.complete).toBe(true); expect(r.truncated).toBe(false); expect(r.declaredTotal).toBe(5);
    const union = r.enumeration?.scopes?.find((s) => s.scope === 'union')!;
    expect(union).toMatchObject({ declaredTotal: 7, uniqueIds: 5, complete: true });
    expect(r.enumeration?.scopes?.filter((s) => s.scope.startsWith('locale:'))).toHaveLength(2);
  });
  it('une locale incomplète laisse le total déclaré à la somme des représentations et refuse la preuve', async () => {
    vi.mocked(fetchJson).mockImplementation(async () => ({ hits: { total: { value: 40 }, hits: [1, 2].map((i) => hit(i, 'fr')) } }));
    const r = await fetchRitualsJobs({ origin: 'https://careers.rituals.com', languages: ['fr-FR'] });
    expect(r.complete).toBe(false); expect(r.truncated).toBe(true); expect(r.declaredTotal).toBe(40);
  });
});
