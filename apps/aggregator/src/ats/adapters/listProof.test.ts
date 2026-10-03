import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { listProof } from './listProof.js';
import { fetchLvmhJobs } from './lvmhAlgolia.js';
import { fetchWttjJobs } from './wttj.js';
import { fetchWttjSectorJobs } from './wttjSector.js';
import { fetchSmartRecruitersJobs } from './smartrecruiters.js';
import { normalizeAdapterResult } from '../index.js';
import { PROVING_TERMINATIONS } from '../../pipeline/refreshPlan.js';

/**
 * D-522 §6 (03/10/2026) : lvmh, wttj-sector et les quatre sources SmartRecruiters lisaient tout ce que leur source annonce
 * et restaient « énumération inconnue » (aucune attestation d'absence) parce que leurs lecteurs ne déclaraient jamais
 * `complete`. Les jeux ci-dessous ont la forme des réponses réelles du 03/10 (fixtures réduites : en-tête Algolia et trois
 * offres réelles, identifiants démultipliés) ; SmartRecruiters n'a pas été relu (robots.txt de l'API : `Disallow: /`
 * pour `*`, accès fondé sur la décision du propriétaire D62, hors politique de lecture manuelle de ce lot) : enveloppe
 * documentée `{ offset, limit, totalFound, content }` et offre réelle du lot l2.
 */
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const LVMH = fixture('d522-lvmh-algolia-page0.json');
const WTTJ = fixture('d522-wttj-algolia-hermes-page0.json');
const SR_POSTING = JSON.parse(readFileSync(new URL('./__fixtures__/l2-smartrecruiters-hmgroup-posting.json', import.meta.url), 'utf8'));

const mocked = vi.mocked(fetchJson);
beforeEach(() => { mocked.mockReset(); });

type AlgoliaOpts = { total: number; template: Record<string, unknown>[]; idKey: 'objectID' | 'reference'; paginationLimitedTo?: number;
  nbHitsOnPage?: (page: number) => number; exhaustive?: boolean; dropOnPage?: number };
/** Serves an Algolia index the way it answers: `nbHits`, `nbPages` bounded by `paginationLimitedTo`, an error past it. */
function algolia(opts: AlgoliaOpts) {
  const records = Array.from({ length: opts.total }, (_, i) => ({ ...opts.template[i % opts.template.length], [opts.idKey]: `id-${i}`, ...(opts.idKey === 'reference' ? { slug: `slug-${i}` } : {}) }));
  return async (_url: unknown, init: unknown) => {
    const body = JSON.parse((init as { body: string }).body) as { page?: number; hitsPerPage: number; facets?: string[] };
    const page = body.page ?? 0, size = body.hitsPerPage;
    const limit = opts.paginationLimitedTo ?? 1_000_000;
    if (page * size >= limit && size > 0) return { message: `you can only fetch the ${limit} hits for this query`, status: 400 };
    const nbHits = opts.nbHitsOnPage?.(page) ?? opts.total;
    let hits = records.slice(page * size, Math.min((page + 1) * size, limit));
    if (opts.dropOnPage === page) hits = hits.slice(1);
    return { hits, nbHits, page, nbPages: Math.min(Math.ceil(nbHits / size), Math.ceil(limit / size)), hitsPerPage: size,
      exhaustiveNbHits: opts.exhaustive ?? true, exhaustive: { nbHits: opts.exhaustive ?? true } };
  };
}

describe('listProof — la fin d’une liste paginée sous un total annoncé', () => {
  const pages = (total: number, size: number, extra: Partial<{ nbPages: number; exhaustive: boolean }> = {}) =>
    Array.from({ length: Math.max(1, Math.ceil(total / size)) }, (_, index) => ({ index, total, rows: Math.min(size, total - index * size), nbPages: Math.ceil(total / size), ...extra }));
  it('prouve une lecture entière, et un total nul lu sur une page vide', () => {
    expect(listProof({ pages: pages(250, 100), pageSize: 100, distinctIds: 250, rowsWithoutId: 0, requiresPageCount: true })).toEqual({ complete: true, total: 250, failures: [] });
    expect(listProof({ pages: [{ index: 0, total: 0, rows: 0, nbPages: 0 }], pageSize: 100, distinctIds: 0, rowsWithoutId: 0, requiresPageCount: true }).complete).toBe(true);
  });
  it('nomme chaque condition manquante', () => {
    expect(listProof({ pages: pages(250, 100).map((p, i) => ({ ...p, total: i === 2 ? 249 : 250 })), pageSize: 100, distinctIds: 250, rowsWithoutId: 0 }).failures).toContain('LIST_TOTAL_CHANGED=250/249');
    expect(listProof({ pages: pages(2033, 100, { nbPages: 10 }).slice(0, 10), pageSize: 100, distinctIds: 1000, rowsWithoutId: 0, requiresPageCount: true }).failures).toEqual(expect.arrayContaining(['LIST_PAGINATION_CAPPED=10x100/2033', 'LIST_END_NOT_REACHED']));
    expect(listProof({ pages: pages(250, 100, { exhaustive: false }), pageSize: 100, distinctIds: 250, rowsWithoutId: 0 }).failures).toContain('LIST_TOTAL_APPROXIMATE');
    expect(listProof({ pages: pages(250, 100), pageSize: 100, distinctIds: 249, rowsWithoutId: 0 }).failures).toContain('LIST_REPEATED_IDS=249/250');
    expect(listProof({ pages: pages(250, 100).map(({ total: _t, ...p }) => p), pageSize: 100, distinctIds: 250, rowsWithoutId: 0 }).failures).toContain('LIST_TOTAL_MISSING');
    expect(listProof({ pages: [pages(250, 100)[0]!, { ...pages(250, 100)[2]!, index: 2 }], pageSize: 100, distinctIds: 150, rowsWithoutId: 0 }).failures).toContain('LIST_PAGES_NOT_CONTIGUOUS');
  });
});

describe('lvmh — index Algolia public (5 980 lues sur nbHits 5 980 au RUN du 02/10, « énumération inconnue »)', () => {
  it('prouve le parcours quand chaque page annonce le même nbHits exact et que tout est lu', async () => {
    // Prémisse : la forme réelle de l'index — nbPages couvre nbHits, total exact.
    expect(LVMH.meta.nbPages * LVMH.meta.hitsPerPage).toBeGreaterThanOrEqual(LVMH.meta.nbHits);
    expect(LVMH.meta.exhaustiveNbHits).toBe(true);
    mocked.mockImplementation(algolia({ total: 250, template: LVMH.hits, idKey: 'objectID' }) as never);
    const result = normalizeAdapterResult(await fetchLvmhJobs({ country: null }));
    expect(result.jobs).toHaveLength(250);
    expect(result.enumerationVerdict).toBe('PROVEN');
    expect(result.complete).toBe(true);
    expect(result.enumeration!.termination).toBe('SHORT_PAGE');
    expect(PROVING_TERMINATIONS.has(result.enumeration!.termination)).toBe(true);
    expect(result.enumeration!.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
  });
  it('ne prouve rien quand nbHits change pendant la lecture, ou n’est pas exact', async () => {
    mocked.mockImplementation(algolia({ total: 250, template: LVMH.hits, idKey: 'objectID', nbHitsOnPage: (p) => (p === 1 ? 251 : 250) }) as never);
    const changed = normalizeAdapterResult(await fetchLvmhJobs({ country: null }));
    expect(changed.complete).not.toBe(true);
    expect(changed.enumeration!.issues).toContain('LIST_TOTAL_CHANGED=250/251');
    mocked.mockImplementation(algolia({ total: 250, template: LVMH.hits, idKey: 'objectID', exhaustive: false }) as never);
    const approximate = normalizeAdapterResult(await fetchLvmhJobs({ country: null }));
    expect(approximate.complete).not.toBe(true);
    expect(approximate.enumeration!.issues).toContain('LIST_TOTAL_APPROXIMATE');
  });
  it('ne prouve rien quand une ligne manque sous un total inchangé', async () => {
    mocked.mockImplementation(algolia({ total: 250, template: LVMH.hits, idKey: 'objectID', dropOnPage: 1 }) as never);
    const result = normalizeAdapterResult(await fetchLvmhJobs({ country: null }));
    expect(result.complete).not.toBe(true);
    expect(result.enumeration!.issues!.some((i) => i.startsWith('LIST_'))).toBe(true);
  });
});

describe('wttj — une organisation par l’index Algolia (Hermès, 684 offres le 03/10)', () => {
  it('prouve le parcours d’une organisation lue en entier', async () => {
    expect(WTTJ.meta.nbPages * WTTJ.meta.hitsPerPage).toBeGreaterThanOrEqual(WTTJ.meta.nbHits);
    mocked.mockImplementation(algolia({ total: 684, template: WTTJ.hits, idKey: 'reference' }) as never);
    const result = normalizeAdapterResult(await fetchWttjJobs({ slug: 'hermes', withDescriptions: false }));
    expect(result.jobs).toHaveLength(684);
    expect(result.complete).toBe(true);
    expect(result.enumerationVerdict).toBe('PROVEN');
  });
  it('ne prouve rien au plafond de pagination (paginationLimitedTo 1 000 : 2 033 offres, nbPages 10 le 02/10)', async () => {
    mocked.mockImplementation(algolia({ total: 2033, template: WTTJ.hits, idKey: 'reference', paginationLimitedTo: 1000 }) as never);
    // Le lecteur lit 10 pages pleines puis la page 10 est refusée par Algolia : la source échoue, bruyamment.
    await expect(fetchWttjJobs({ slug: 'grosse-maison', withDescriptions: false })).rejects.toThrow(/WTTJ refused/);
  });
});

describe('wttj-sector — les organisations d’un secteur (2 144 lues sur 2 144 au RUN du 02/10)', () => {
  const sectorServer = (orgs: Record<string, number>, facetOpts: { exhaustive?: boolean } = {}) => {
    const byOrg = Object.fromEntries(Object.entries(orgs).map(([slug, n]) => [slug, algolia({ total: n, template: WTTJ.hits.map((h: object) => ({ ...h, organization: { slug, name: slug } })), idKey: 'reference' })]));
    return async (url: unknown, init: unknown) => {
      const body = JSON.parse((init as { body: string }).body) as { filters: string; hitsPerPage: number };
      if (body.hitsPerPage === 0) return { nbHits: Object.values(orgs).reduce((a, b) => a + b, 0), hits: [], exhaustiveFacetsCount: facetOpts.exhaustive ?? true,
        exhaustive: { facetsCount: facetOpts.exhaustive ?? true }, facets: { 'organization.slug': orgs, 'offices.country_code': { FR: 1 } } };
      const slug = /organization\.slug:"([^"]+)"/.exec(body.filters)![1]!;
      const served = await byOrg[slug]!(url, init) as { hits: Array<Record<string, unknown>> };
      // Each organization serves distinct ids.
      return { ...served, hits: served.hits.map((h) => ({ ...h, reference: `${slug}-${h.reference}`, slug: `${slug}-${h.slug}` })) };
    };
  };
  it('prouve le secteur quand la liste des organisations est exacte et chaque organisation prouvée', async () => {
    mocked.mockImplementation(sectorServer({ hermes: 150, diptyque: 26 }) as never);
    const result = normalizeAdapterResult(await fetchWttjSectorJobs({ sectors: ['luxury-1'], withDescriptions: false }));
    expect(result.jobs).toHaveLength(176);
    expect(result.complete).toBe(true);
    expect(result.enumerationVerdict).toBe('PROVEN');
    // Prouvé, mais pas probant pour le refresh tant que la terminaison n'est pas promue par une lecture écrite.
    expect(result.enumeration!.termination).toBe('ORGANIZATIONS_RECONCILED');
    expect(PROVING_TERMINATIONS.has('ORGANIZATIONS_RECONCILED')).toBe(false);
  });
  it('ne prouve rien quand le compte des facettes est approché (la liste des organisations n’est pas démontrée)', async () => {
    mocked.mockImplementation(sectorServer({ hermes: 150, diptyque: 26 }, { exhaustive: false }) as never);
    const result = normalizeAdapterResult(await fetchWttjSectorJobs({ sectors: ['luxury-1'], withDescriptions: false }));
    expect(result.jobs).toHaveLength(176);
    expect(result.complete).not.toBe(true);
    expect(result.enumeration!.issues).toContain('ORGANIZATION_LIST_UNPROVEN');
  });
});

describe('SmartRecruiters — API publique des annonces (hm-group 1 930 sur totalFound 1 930 au RUN du 02/10)', () => {
  const server = (total: number, opts: { totalOn?: (offset: number) => number; skipAt?: number } = {}) => async (url: unknown) => {
    const offset = Number(/offset=(\d+)/.exec(String(url))![1]);
    const n = Math.max(0, Math.min(100, total - offset));
    let content = Array.from({ length: n }, (_, i) => ({ ...SR_POSTING, id: String(744000000000000 + offset + i) }));
    if (opts.skipAt === offset) content = content.slice(1);
    return { offset, limit: 100, totalFound: opts.totalOn?.(offset) ?? total, content };
  };
  it('prouve le parcours quand totalFound est atteint, stable, chaque identifiant une fois', async () => {
    mocked.mockImplementation(server(230) as never);
    const result = normalizeAdapterResult(await fetchSmartRecruitersJobs({ company: 'HMGroup', withDescriptions: false }));
    expect(result.jobs).toHaveLength(230);
    expect(result.declaredTotal).toBe(230);
    expect(result.complete).toBe(true);
    expect(result.enumerationVerdict).toBe('PROVEN');
    expect(result.enumeration!.pageEvidence!.every((p) => Object.hasOwn(p, 'canonicalIds'))).toBe(true);
    expect(PROVING_TERMINATIONS.has(result.enumeration!.termination)).toBe(true);
  });
  it('ne prouve rien quand totalFound change pendant la lecture ou qu’une ligne manque', async () => {
    mocked.mockImplementation(server(230, { totalOn: (o) => (o === 100 ? 229 : 230) }) as never);
    const changed = normalizeAdapterResult(await fetchSmartRecruitersJobs({ company: 'HMGroup', withDescriptions: false }));
    expect(changed.complete).not.toBe(true);
    expect(changed.enumeration!.issues).toContain('LIST_TOTAL_CHANGED=230/229');
    mocked.mockImplementation(server(230, { skipAt: 100 }) as never);
    const short = normalizeAdapterResult(await fetchSmartRecruitersJobs({ company: 'HMGroup', withDescriptions: false }));
    expect(short.complete).not.toBe(true);
  });
});
