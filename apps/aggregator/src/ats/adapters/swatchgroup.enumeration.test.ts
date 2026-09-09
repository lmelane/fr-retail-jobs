import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
vi.mock('../../observability/logger.js', () => ({ log: { error: vi.fn(async () => {}), info: vi.fn(async () => {}), warn: vi.fn(async () => {}) } }));
import { fetchText } from '../../lib/http.js';
import { fetchSwatchGroupJobs } from './swatchgroup.js';

/** Swatch Group, 2026-09-09 : 265 offres pour 267 liens — le déficit doit nommer les fiches rejetées. */
const listing = (ids: number[]) => ids.map((i) => `<a href="/fr/job/${i}">x</a><a href="/fr/job/${i}">y</a>`).join('');
const detail = (id: number) => `<html><body><h1>Vendeur ${id}</h1><script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: `Vendeur ${id}`, datePosted: '2026-09-01', description: 'Poste réel et complet pour la boutique.', hiringOrganization: { name: 'Swatch' } })}</script><div id="jl">Genève</div></body></html>`;
const route = (pages: Record<string, string>, details: Record<string, string | Error>) => vi.mocked(fetchText).mockImplementation(async (url: string) => {
  const page = /page=(\d+)/.exec(url)?.[1]; if (page !== undefined) return pages[page] ?? '';
  const id = /\/job\/(\d+)/.exec(url)?.[1]!; const d = details[id]; if (d instanceof Error) throw d; return d ?? '';
});
beforeEach(() => vi.resetAllMocks());

describe('Swatch Group — every listed link read, or the rejected details named', () => {
  it('proves the board when the pager repeats and every detail parses', async () => {
    route({ '0': listing([1, 2]), '1': listing([3]), '2': listing([3]) }, { '1': detail(1), '2': detail(2), '3': detail(3) });
    const r = await fetchSwatchGroupJobs({ origin: 'https://www.swatchgroup.com', lang: 'fr' });
    expect(r.jobs.map((j) => j.externalId).sort()).toEqual(['1', '2', '3']); expect(r.declaredTotal).toBe(3); expect(r.complete).toBe(true); expect(r.rejectedRows).toEqual([]);
    expect(r.enumeration).toMatchObject({ pages: 3, termination: 'REPEATED_PAGE', issues: [] });
  });
  it('names an unparsed and a failed detail as rejected rows and refuses the proof', async () => {
    route({ '0': listing([1, 2, 3]), '1': listing([3]) }, { '1': detail(1), '2': '<html><body>no title, no id</body></html>', '3': new Error('HTTP 503') });
    const r = await fetchSwatchGroupJobs({ origin: 'https://www.swatchgroup.com', lang: 'fr' });
    expect(r.jobs).toHaveLength(1); expect(r.declaredTotal).toBe(3); expect(r.complete).toBe(false); expect(r.truncated).toBe(false);
    expect(r.rejectedRows?.map((x) => x.reason).sort()).toEqual(['DETAIL_FETCH_FAILED', 'DETAIL_UNPARSED']);
    expect(r.enumeration?.issues).toEqual(['DETAILS_REJECTED', 'ENUMERATION_NOT_PROVEN']);
  });
});
