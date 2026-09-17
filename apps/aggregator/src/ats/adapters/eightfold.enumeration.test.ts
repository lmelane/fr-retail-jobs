import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchWithRetry: vi.fn() }));
vi.mock('../../lib/browser.js', () => ({ fetchRenderedHtml: vi.fn() }));
import { fetchJson, fetchWithRetry } from '../../lib/http.js';
import { fetchEightfoldJobs } from './eightfold.js';
import { normalizeAdapterResult } from '../index.js';

/** Kering, 2026-09-09 : 1 030 lues pour 1 031 annoncées, run après run — le déficit doit être nommé. */
const position = (id: number) => ({ id, name: `Client Advisor ${id}`, positionUrl: `/careers/job/${id}`, locations: ['Paris, IDF, FR'] });
const page = (ids: number[], count: number) => ({ data: { positions: ids.map(position), count } });
const config = { origin: 'https://careers.example.com', domain: 'example.com', withDescriptions: false };
beforeEach(() => { vi.mocked(fetchJson).mockReset(); vi.mocked(fetchWithRetry).mockReset(); vi.mocked(fetchWithRetry).mockRejectedValue(new Error('no session')); });

describe('Eightfold — enumeration proof against the announced count', () => {
  it('proves a board read to its count, page by page', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 13)).mockResolvedValueOnce(page([11, 12, 13], 13));
    const r = await fetchEightfoldJobs(config);
    expect(r.jobs).toHaveLength(13); expect(r.declaredTotal).toBe(13); expect(r.complete).toBe(true); expect(r.truncated).toBe(false);
    expect(r.enumeration).toMatchObject({ pages: 2, termination: 'PUBLISHER_TOTAL_REACHED', issues: [] });
    expect(r.enumeration?.pageEvidence?.map((p) => p.publisherCounter)).toEqual(['count=13', 'count=13']);
  });
  it('names a position repeated across pages: the announced posting that never appeared is the deficit', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 13)).mockResolvedValueOnce(page([10, 11, 12], 13));
    const r = await fetchEightfoldJobs(config);
    expect(r.jobs).toHaveLength(12); expect(r.complete).toBe(false); expect(r.truncated).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['REPEATED_IDS_ACROSS_PAGES', 'ENUMERATION_NOT_PROVEN'])); expect(r.enumeration?.termination).toBe('PUBLISHER_TOTAL_ROWS_READ');
    expect(r.enumeration?.pageEvidence?.[1]?.componentCounters).toContain('repeated=1');
  });
  it('keeps reading a short page while the count announces more, and counts positions the mapper rejects', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 15)).mockResolvedValueOnce({ data: { positions: [position(11), { id: 12 } as any], count: 15 } }).mockResolvedValueOnce(page([13, 14, 15], 15));
    const r = await fetchEightfoldJobs(config);
    expect(r.jobs).toHaveLength(14); expect(fetchJson).toHaveBeenCalledTimes(3); expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['POSITIONS_WITHOUT_ID_OR_TITLE']));
  });
});

/**
 * LE CONTRAT DES IDENTIFIANTS CANONIQUES — témoin.
 *
 * Il ÉCHOUE si `canonicalIds` est retiré de la preuve (contrat absent, plus aucune absence démontrable) et il
 * échoue si une position refusée par le mappeur perd son `canonicalId` : `normalizeAdapterResult` voit alors
 * un identifiant observé sans disposition et réfute la preuve.
 */
describe('Eightfold — contrat des identifiants canoniques', () => {
  it('déclare, page par page, exactement les id natifs observés', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 13)).mockResolvedValueOnce(page([11, 12, 13], 13));
    const r = await fetchEightfoldJobs(config);
    const pages = r.enumeration!.pageEvidence!;
    // TOUTES les pages déclarent : un contrat partiel n'est pas un contrat.
    expect(pages.every((p) => Object.hasOwn(p, 'canonicalIds'))).toBe(true);
    expect(pages.map((p) => p.canonicalIds)).toEqual([['1','2','3','4','5','6','7','8','9','10'], ['11','12','13']]);
    // Même vocabulaire des deux côtés : la preuve et les offres produites.
    expect(pages.flatMap((p) => p.canonicalIds!).sort()).toEqual(r.jobs.map((j) => j.externalId).sort());
    expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(true);
  });

  it('une position vue puis refusée par le mappeur reste dans la preuve, nommée comme disposition', async () => {
    // `{ id: 12 }` : identifiant natif exploitable, aucun `name` — vue, refusée, jamais un trou.
    vi.mocked(fetchJson).mockResolvedValueOnce({ data: { positions: [position(11), { id: 12 } as any], count: 2 } });
    const r = await fetchEightfoldJobs(config);
    expect(r.jobs.map((j) => j.externalId)).toEqual(['11']);
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(['11', '12']);
    // Sans ce `canonicalId`, « 12 » serait un identifiant observé sans disposition : contrat ROMPU.
    expect(r.rejectedRows).toEqual([expect.objectContaining({ reason: 'POSITION_WITHOUT_TITLE', canonicalId: '12' })]);
  });

  it('un identifiant répété entre deux pages n\'est déclaré qu\'une fois', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(page([1, 2], 3)).mockResolvedValueOnce(page([2, 3], 3));
    const r = await fetchEightfoldJobs(config);
    expect(r.enumeration!.pageEvidence!.map((p) => p.canonicalIds)).toEqual([['1', '2'], ['3']]);
  });

  it('une position sans id ni displayJobId est comptée, jamais inventée, et retire le droit d\'attester', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({ data: { positions: [position(1), { name: 'Sans identifiant' } as any], count: 2 } });
    const r = await fetchEightfoldJobs(config);
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(['1']);
    expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(false);
    expect(r.enumeration?.issues).toContain('ROW_WITHOUT_CANONICAL_ID');
    expect(r.enumeration!.pageEvidence![0].componentCounters).toContain('anonymousRows=1');
  });

  /**
   * Un TITRE n'est pas un identifiant canonique. `toNormalized` se rabat pourtant dessus : l'offre produite
   * n'est alors couverte par aucun identifiant observé, et la preuve DOIT tomber plutôt que de laisser passer
   * une fausse absence. C'est le comportement sûr, mesuré ici.
   */
  it('un titre en guise d\'identité réfute la preuve au lieu de fabriquer une absence', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({ data: { positions: [{ name: 'Sans identifiant' } as any], count: 1 } });
    const r = normalizeAdapterResult(await fetchEightfoldJobs(config));
    expect(r.complete).toBe(false);
    expect(r.enumerationVerdict).toBe('REFUTED');
    expect(r.enumeration?.issues).toContain('CANONICAL_ID_CONTRACT_BROKEN');
  });

  /** Le contrat tel que la chaîne le juge réellement : la preuve doit survivre à `normalizeAdapterResult`. */
  it('le contrat passe la vérification centrale : aucune violation, preuve conservée', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce({ data: { positions: [position(11), { id: 12 } as any], count: 2 } })
      .mockResolvedValueOnce({ data: { positions: [], count: 2 } });
    const r = normalizeAdapterResult(await fetchEightfoldJobs(config));
    expect(r.enumeration?.canonicalIdViolations).toBeUndefined();
    expect(r.enumeration?.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
  });
});
