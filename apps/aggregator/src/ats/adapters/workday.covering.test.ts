import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { coveringFacet, facetProof, fetchWorkdayJobs, WORKDAY_TOTAL_CAP, type FacetProofInput } from './workday.js';
import { PROVING_TERMINATIONS } from '../../pipeline/refreshPlan.js';
import { normalizeAdapterResult } from '../index.js';

/**
 * D-520, liste non prouvée, famille Workday : le PLAFOND DE L'API. knitwell-us-retail, sondé le 02/10/2026 : `total`
 * 2 000 ; offsets 2 000, 3 000, 3 500 et 3 520 servent la même page ; facettes à plat jobFamilyGroup (6 valeurs, max
 * 1 758), Location_Region_State_Province (50, max 327), workerSubType (3, max 3 456) et timeType (2, max 3 184), toutes
 * à 3 515 ; locationMainGroup imbriquée (5 280). Le jeu ci-dessous a la même forme, réduit : 2 100 offres.
 */
const posting = (id: number) => ({ title: `Sales ${id}`, externalPath: `/job/NY/Sales_R-${id}`, locationsText: 'New York', postedOn: 'Posted Today', bulletFields: [`R-${id}`] });
const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
const config = { tenant: 'knitwellgroup', site: 'US_Retail_Jobs', origin: 'https://knitwellgroup.wd1.myworkdayjobs.com', withDescriptions: false };

type Facet = { facetParameter: string; descriptor?: string; values: Array<Record<string, unknown>> };
/** The real shape: flat facets agree on the site's true total, the nested one counts more. */
const facetsFor = (families: Record<string, number[]>, states: Record<string, number[]>, extra: Facet[] = []): Facet[] => [
  { facetParameter: 'jobFamilyGroup', descriptor: 'Job Family', values: Object.entries(families).map(([name, list]) => ({ descriptor: name, id: `fam-${name}`, count: list.length })) },
  { facetParameter: 'Location_Region_State_Province', descriptor: 'State/Province', values: Object.entries(states).map(([name, list]) => ({ descriptor: name, id: `st-${name}`, count: list.length })) },
  { facetParameter: 'workerSubType', descriptor: 'Job Type', values: [{ descriptor: 'Regular', id: 'wst-r', count: Object.values(families).flat().length }] },
  { facetParameter: 'locationMainGroup', values: [{ facetParameter: 'locationCountry', values: [{ descriptor: 'US', id: 'us', count: 9_999 }] }] },
  ...extra,
];

/** Serves the capped site (2 000 at most, the page beyond re-served) and every facet value as its own board. */
function server(site: number[], boards: Record<string, number[]>, facets: Facet[]) {
  vi.mocked(fetchJson).mockImplementation(async (_url: unknown, init: unknown) => {
    const body = JSON.parse(String((init as { body: string }).body)) as { offset: number; appliedFacets: Record<string, string[]> };
    const applied = Object.values(body.appliedFacets).flat()[0];
    if (!applied) {
      const list = body.offset >= WORKDAY_TOTAL_CAP ? site.slice(WORKDAY_TOTAL_CAP, WORKDAY_TOTAL_CAP + 20) : site.slice(body.offset, body.offset + 20);
      return { total: body.offset === 0 ? Math.min(site.length, WORKDAY_TOTAL_CAP) : 0, facets: body.offset === 0 ? facets : undefined, jobPostings: list.map(posting) };
    }
    const list = boards[applied] ?? [];
    return { total: body.offset === 0 ? list.length : 0, jobPostings: list.slice(body.offset, body.offset + 20).map(posting) };
  });
}

beforeEach(() => vi.resetAllMocks());

describe('Workday — un site plafonné à 2 000 lu par sa facette couvrante (D-520, knitwell-us-retail)', () => {
  const families = { Stores: ids(0, 1_300), Corporate: ids(1_300, 1_900), DC: ids(1_900, 2_100) };
  // More values than the families: the families win the tie on the total (fewer requests), as on knitwell (6 against 50).
  const states = { NY: ids(0, 600), NJ: ids(600, 1_200), CT: ids(1_200, 1_700), PA: ids(1_700, 2_100) };
  const stateBoards = Object.fromEntries(Object.entries(states).map(([name, list]) => [`st-${name}`, list]));
  const all = ids(0, 2_100);

  it('prémisse : le site annonce 2 000 et sert des offres jamais vues au-delà — c’est le plafond, pas la fin', () => {
    expect(all).toHaveLength(2_100);
    expect(Object.values(families).flat()).toEqual(all);
    expect(Math.max(...Object.values(families).map((list) => list.length))).toBeLessThan(WORKDAY_TOTAL_CAP);
  });

  it('lit chaque valeur de la facette sous le plafond : 2 100 offres sur 2 100, comptes concordants, preuve ADOPTÉE (D-520 §4 a), aucun employeur tiré de la facette', async () => {
    server(all, { 'fam-Stores': families.Stores, 'fam-Corporate': families.Corporate, 'fam-DC': families.DC }, facetsFor(families, states));
    const r = await fetchWorkdayJobs(config);
    // Avant ce lot : 2 020 offres (les 2 000 du site et la page sondée au-delà), complete: false, PUBLISHER_TOTAL_CAPPED.
    expect(r.jobs).toHaveLength(2_100);
    expect(new Set(r.jobs.map((job) => job.externalId)).size).toBe(2_100);
    expect(r.declaredTotal).toBe(2_100);
    // D-520 §4 a: the three conditions hold, the proof is adopted. Before this lot: complete false (proof not adopted).
    expect(r.complete).toBe(true); expect(r.truncated).toBe(false);
    expect(r.enumeration).toMatchObject({ method: 'PUBLISHER_TOTAL_COUNT_JSON_PAGINATION_COVERING_FACET', termination: 'COVERING_FACET_RECONCILED',
      enumerationTraversalComplete: true });
    expect(r.enumeration?.scopes?.[0]).toMatchObject({ scope: 'jobs', declaredTotal: 2_100, uniqueIds: 2_100, complete: true });
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['PUBLISHER_TOTAL_CAPPED', 'COVERED_BY_FACET=jobFamilyGroup', 'COVERING_FACET_PROOF_ADOPTED']));
    expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(true);
    expect(r.enumeration?.issues).not.toContain('ENUMERATION_NOT_PROVEN');
    // Through the dispatcher's normalisation: the canonical contract holds on every page, nothing turns the lot into a broken contract.
    const normalized = normalizeAdapterResult(r);
    expect(normalized.complete).toBe(true);
    expect(normalized.enumeration?.issues).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
    // A job family is not a Maison: the employer stays the detail's to name.
    expect(r.jobs.every((job) => job.company === undefined && job.employerEvidence === undefined)).toBe(true);
    // Every page of a covering board carries its ids, so the canonical contract holds.
    expect(r.enumeration?.pageEvidence?.some((p) => p.componentCounters.includes('cover=jobFamilyGroup=DC') && p.canonicalIds!.length > 0)).toBe(true);
    expect(r.enumeration?.pageEvidence?.find((p) => p.url.includes('#coveringFacet='))?.componentCounters).toEqual(
      ['jobFamilyGroup=Stores:1300', 'jobFamilyGroup=Corporate:600', 'jobFamilyGroup=DC:200', 'sum=2100', 'agreeing=3']);
  });

  it('la lecture prouvée est probante pour le refresh ; la lecture non prouvée ne l’est jamais', () => {
    expect(PROVING_TERMINATIONS.has('COVERING_FACET_RECONCILED')).toBe(true);
    expect(PROVING_TERMINATIONS.has('COVERING_FACET_UNPROVEN')).toBe(false);
  });

  it('une erreur pendant la lecture couvrante ne coûte pas la source : le site plafonné reste collecté, l’échec est nommé', async () => {
    server(all, { 'fam-Stores': families.Stores, 'fam-Corporate': families.Corporate, 'fam-DC': families.DC }, facetsFor(families, states));
    const served = vi.mocked(fetchJson).getMockImplementation()!;
    vi.mocked(fetchJson).mockImplementation(async (url: unknown, init: unknown) => {
      if (String((init as { body: string }).body).includes('fam-Corporate')) throw new Error('HTTP 502 for …');
      return served(url as never, init as never);
    });
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs.length).toBeGreaterThanOrEqual(2_020);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues?.some((issue) => issue.startsWith('COVERING_FACET_READ_FAILED:'))).toBe(true);
  });

  it('une offre servie par le site mais absente des tableaux de la facette : tout est collecté, rien n’est prouvé', async () => {
    // 1 999 n'a aucune famille : le site la sert, la facette ne la compte pas, et une autre facette compte 2 100.
    const partial = { Stores: ids(0, 1_300), Corporate: ids(1_300, 1_900), DC: ids(1_900, 2_100).filter((id) => id !== 1_999) };
    server(all, { 'fam-Stores': partial.Stores, 'fam-Corporate': partial.Corporate, 'fam-DC': partial.DC, ...stateBoards }, facetsFor(partial, states));
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(2_100);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.termination).toBe('COVERING_FACET_UNPROVEN');
    // The state facet (2 100) counts the posting the families (2 099) miss: the families are not the covering facet any more.
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['COVERED_BY_FACET=Location_Region_State_Province', 'ENUMERATION_NOT_PROVEN']));
  });

  it('une seule facette à ce total : collectée en entier, NON prouvée (aucun accord)', async () => {
    const facets: Facet[] = [{ facetParameter: 'jobFamilyGroup', values: Object.entries(families).map(([name, list]) => ({ descriptor: name, id: `fam-${name}`, count: list.length })) },
      { facetParameter: 'timeType', values: [{ descriptor: 'Full time', id: 'tt-f', count: 1_500 }, { descriptor: 'Part time', id: 'tt-p', count: 590 }] }];
    server(all, { 'fam-Stores': families.Stores, 'fam-Corporate': families.Corporate, 'fam-DC': families.DC }, facets);
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(2_100);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['COVERING_FACET_WITHOUT_AGREEMENT', 'ENUMERATION_NOT_PROVEN']));
  });

  it('un tableau dont le total ne correspond pas au compte de la facette : NON prouvé', async () => {
    server(all, { 'fam-Stores': families.Stores, 'fam-Corporate': families.Corporate.slice(1), 'fam-DC': families.DC }, facetsFor(families, states));
    const r = await fetchWorkdayJobs(config);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues?.some((issue) => issue.startsWith('COVERING_FACET_TOTAL_MISMATCH='))).toBe(true);
  });

  it('sans facette couvrante (une valeur atteint le plafond) : la lecture reste celle d’avant, nommée', async () => {
    const facets: Facet[] = [{ facetParameter: 'workerSubType', values: [{ descriptor: 'Regular', id: 'wst-r', count: 2_100 }] }];
    server(all, {}, facets);
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(2_020); expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['PUBLISHER_TOTAL_CAPPED', 'COVERING_FACET_ABSENT', 'ENUMERATION_NOT_PROVEN']));
    expect(r.enumeration?.termination).toBe('PUBLISHER_TOTAL_REACHED');
  });

  it('knitwell, collecte locale du 02/10 à 15:13 UTC : la page au-delà du plafond ressert des offres déjà lues — les facettes disent quand même le plafond', async () => {
    // The capped site re-serves its last page beyond 2 000: the probe sees no new id. Before this lot: 2 000 « prouvées ».
    vi.mocked(fetchJson).mockImplementation(async (_url: unknown, init: unknown) => {
      const body = JSON.parse(String((init as { body: string }).body)) as { offset: number; appliedFacets: Record<string, string[]> };
      if (Object.keys(body.appliedFacets).length) return { total: 0, jobPostings: [] };
      const list = body.offset >= WORKDAY_TOTAL_CAP ? all.slice(1_980, 2_000) : all.slice(body.offset, body.offset + 20);
      return { total: body.offset === 0 ? WORKDAY_TOTAL_CAP : 0, jobPostings: list.map(posting),
        facets: body.offset === 0 ? [{ facetParameter: 'workerSubType', values: [{ descriptor: 'Regular', id: 'wst-r', count: 2_100 }] }] : undefined };
    });
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(2_000);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['PUBLISHER_TOTAL_CAPPED', 'FACETS_COUNT_BEYOND_TOTAL=2100', 'ENUMERATION_NOT_PROVEN']));
  });

  it('un site sous le plafond n’envoie aucune requête de plus', async () => {
    server(ids(0, 30), {}, facetsFor({ A: ids(0, 30) }, { NY: ids(0, 30) }));
    const r = await fetchWorkdayJobs(config);
    expect(r.complete).toBe(true); expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(r.enumeration?.issues).not.toContain('COVERING_FACET_ABSENT');
  });
});

describe('coveringFacet — le choix de la facette, pur', () => {
  it('écarte une facette imbriquée et une facette dont une valeur atteint le plafond ; préfère le plus grand total, puis le moins de valeurs', () => {
    const facets = [
      { facetParameter: 'locationMainGroup', values: [{ facetParameter: 'x', values: [{ id: 'a', descriptor: 'A', count: 10 }] }] },
      { facetParameter: 'workerSubType', values: [{ id: 'r', descriptor: 'Regular', count: 3_456 }, { id: 'o', descriptor: 'Other', count: 59 }] },
      { facetParameter: 'state', values: Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, descriptor: `S${i}`, count: i < 15 ? 71 : 70 })) },
      { facetParameter: 'jobFamilyGroup', values: [{ id: 'f1', descriptor: 'F1', count: 1_758 }, { id: 'f2', descriptor: 'F2', count: 1_757 }] },
    ] as never;
    const chosen = coveringFacet(facets)!;
    expect(chosen.parameter).toBe('jobFamilyGroup'); expect(chosen.sum).toBe(3_515);
    // workerSubType and state agree on 3 515: three flat facets in all.
    expect(chosen.agreeing).toBe(3); expect(chosen.exceeded).toBe(false);
  });
  it('rien sous le plafond : aucune facette', () => {
    expect(coveringFacet([{ facetParameter: 'a', values: [{ id: '1', descriptor: 'x', count: 1_500 }] }] as never)).toBeUndefined();
    expect(coveringFacet(undefined)).toBeUndefined();
  });
});

/**
 * D-520 §4 a — LA PREUVE PAR FACETTE, ADOPTÉE SOUS TROIS CONDITIONS. Un témoin par condition qui manque : chacun échoue
 * sur une version qui adopte la lecture couvrante sans vérifier (`adopted: true` quel que soit le constat), parce qu'il
 * exige `complete: false` et une terminaison non probante. Chaque prémisse est affirmée d'abord : le jeu d'essai remplit
 * bien la condition du défaut, et les deux autres conditions tiennent quand c'est possible.
 */
describe('Workday — la preuve par facette n’est adoptée que sous ses trois conditions (D-520 §4 a)', () => {
  const site = ids(0, 2_100);
  const states = { NY: ids(0, 600), NJ: ids(600, 1_200), CT: ids(1_200, 1_700), PA: ids(1_700, 2_100) };
  const unproven = (r: Awaited<ReturnType<typeof fetchWorkdayJobs>>) => {
    expect(r.complete).toBe(false);
    expect(r.enumeration?.termination).toBe('COVERING_FACET_UNPROVEN');
    expect(PROVING_TERMINATIONS.has(r.enumeration!.termination!)).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['ENUMERATION_NOT_PROVEN']));
    expect(r.enumeration?.issues).not.toContain('COVERING_FACET_PROOF_ADOPTED');
  };

  it('condition 1, facette NON OBLIGATOIRE : 50 offres sans famille, servies au-delà du plafond, ne sont jamais lues — aucune absence attestée', async () => {
    // Families count 2 050: postings 2 050 to 2 099 carry none. The state facet counts all 2 100 but one of its values
    // reaches the cap, so it cannot be the covering facet; it only says the families miss postings.
    const families = { Stores: ids(0, 1_300), Corporate: ids(1_300, 1_900), DC: ids(1_900, 2_050) };
    const facets: Facet[] = [
      { facetParameter: 'jobFamilyGroup', values: Object.entries(families).map(([name, list]) => ({ descriptor: name, id: `fam-${name}`, count: list.length })) },
      { facetParameter: 'Location_Region_State_Province', values: [{ descriptor: 'NY', id: 'st-NY', count: 2_050 }, { descriptor: 'NJ', id: 'st-NJ', count: 50 }] },
    ];
    // Prémisse : the missing postings are all beyond the cap (the site never serves them), so no site posting is missed.
    expect(site.filter((id) => !Object.values(families).flat().includes(id))).toEqual(ids(2_050, 2_100));
    expect(Math.min(...ids(2_050, 2_100))).toBeGreaterThanOrEqual(WORKDAY_TOTAL_CAP);
    server(site, { 'fam-Stores': families.Stores, 'fam-Corporate': families.Corporate, 'fam-DC': families.DC }, facets);
    const r = await fetchWorkdayJobs(config);
    // The other two conditions hold: every value read in full, union = sum of the counts (2 050).
    expect(r.enumeration?.scopes?.[0]).toMatchObject({ declaredTotal: 2_050, uniqueIds: 2_050 });
    expect(r.enumeration?.issues?.some((issue) => /^COVERING_(BOARD_|FACET_VALUES_|FACET_TOTAL_)/.test(issue))).toBe(false);
    expect(r.enumeration?.issues).toContain('COVERING_FACET_WITHOUT_AGREEMENT');
    unproven(r);
  });

  it('condition 1, facette qui NE PARTITIONNE PAS : une offre sous deux familles — aucune absence attestée', async () => {
    const families = { Stores: ids(0, 1_301), Corporate: ids(1_300, 1_900), DC: ids(1_900, 2_100) };
    // Prémisse : posting 1 300 carries two values, the facet counts 2 101 for 2 100 postings.
    expect(families.Stores.filter((id) => families.Corporate.includes(id))).toEqual([1_300]);
    server(site, { 'fam-Stores': families.Stores, 'fam-Corporate': families.Corporate, 'fam-DC': families.DC }, facetsFor(families, states));
    const r = await fetchWorkdayJobs(config);
    expect(r.jobs).toHaveLength(2_100);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['COVERED_BY_FACET=jobFamilyGroup', 'COVERING_FACET_OVERLAP=1']));
    unproven(r);
  });

  it('condition 2, une valeur NON LUE EN ENTIER : son tableau annonce 601 offres et en sert 600 — aucune absence attestée', async () => {
    const families = { Stores: ids(0, 1_300), Corporate: ids(1_300, 1_900), DC: ids(1_900, 2_100) };
    server(site, { 'fam-Stores': families.Stores, 'fam-Corporate': families.Corporate, 'fam-DC': families.DC }, facetsFor(families, states));
    const served = vi.mocked(fetchJson).getMockImplementation()!;
    vi.mocked(fetchJson).mockImplementation(async (url: unknown, init: unknown) => {
      const page = await served(url as never, init as never) as { total: number };
      return String((init as { body: string }).body).includes('fam-Corporate') && page.total ? { ...page, total: 601 } : page;
    });
    const r = await fetchWorkdayJobs(config);
    // Prémisse : every posting was still read (union = 2 100 = sum of the counts) and the facet partitions the list.
    expect(new Set(r.jobs.map((job) => job.externalId)).size).toBe(2_100);
    expect(r.enumeration?.issues?.some((issue) => /^COVERING_FACET_(TOTAL_MISMATCH|OVERLAP|MISSES|WITHOUT)/.test(issue))).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['COVERING_BOARD_UNPROVEN', 'COVERING_FACET_VALUES_MISMATCH=2101/2100']));
    unproven(r);
  });

  it('condition 2, une valeur lue AU PLAFOND : son tableau annonce 2 000 et la page au-delà ne dit rien — aucune absence attestée', async () => {
    // At the facet read the value counted 1 999; when its board is read it announces 2 000, the cap, where Workday says
    // nothing more. Another value lost one posting meanwhile, so the sums still agree.
    const families = { Stores: ids(0, 2_000), DC: ids(2_000, 2_100) };
    const facets = facetsFor({ Stores: ids(0, 1_999), DC: ids(1_999, 2_100) }, states);
    server(site, { 'fam-Stores': families.Stores, 'fam-DC': families.DC }, facets);
    const r = await fetchWorkdayJobs(config);
    // Prémisse : the board itself reports complete (its probe beyond 2 000 serves nothing new), every count adds up.
    const board = r.enumeration?.scopes?.find((scope) => scope.scope === 'jobFamilyGroup=Stores');
    expect(board).toMatchObject({ declaredTotal: WORKDAY_TOTAL_CAP, uniqueIds: WORKDAY_TOTAL_CAP, complete: true });
    expect(r.enumeration?.issues?.some((issue) => /^COVERING_(BOARD_UNPROVEN|FACET_)/.test(issue))).toBe(false);
    expect(r.enumeration?.issues).toContain('COVERING_BOARD_AT_CAP=jobFamilyGroup=Stores');
    unproven(r);
  });

  it('condition 3, l’UNION LUE ne fait pas la somme des comptes : une offre lue en moins — aucune absence attestée', async () => {
    const families = { Stores: ids(0, 1_300), Corporate: ids(1_300, 1_900), DC: ids(1_900, 2_100) };
    server(site, { 'fam-Stores': families.Stores, 'fam-Corporate': families.Corporate.slice(1), 'fam-DC': families.DC }, facetsFor(families, states));
    const r = await fetchWorkdayJobs(config);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['COVERING_FACET_TOTAL_MISMATCH=2099/2100']));
    unproven(r);
  });
});

/** Les trois conditions, pures, isolées : chaque témoin ne fait manquer qu'un contrôle, les autres tiennent. */
describe('facetProof — chaque condition, isolée', () => {
  const ok: FacetProofInput = { cover: { sum: 2_100, agreeing: 3, exceeded: false }, unionIds: 2_100, sitePostingsMissed: 0,
    boards: [{ scope: 'f=A', total: 1_300, complete: true, overlap: 0, withoutPath: 0 }, { scope: 'f=B', total: 800, complete: true, overlap: 0, withoutPath: 0 }] };
  const only = (input: FacetProofInput, failure: RegExp, condition: keyof ReturnType<typeof facetProof>['conditions']) => {
    const proof = facetProof(input);
    expect(proof.adopted).toBe(false);
    expect(proof.failures).toHaveLength(1);
    expect(proof.failures[0]).toMatch(failure);
    expect(Object.entries(proof.conditions).filter(([, held]) => !held).map(([name]) => name)).toEqual([condition]);
  };

  it('toutes les conditions : adoptée', () => {
    expect(facetProof(ok)).toEqual({ adopted: true, failures: [], conditions: { mandatoryPartition: true, everyValueRead: true, unionEqualsCounts: true } });
  });
  it('1 : une offre du site plafonné absente des valeurs', () => only({ ...ok, sitePostingsMissed: 1 }, /^COVERING_FACET_MISSES_SITE_POSTINGS=1$/, 'mandatoryPartition'));
  it('1 : une seule facette à ce total', () => only({ ...ok, cover: { ...ok.cover, agreeing: 1 } }, /^COVERING_FACET_WITHOUT_AGREEMENT$/, 'mandatoryPartition'));
  it('1 : une facette compte davantage', () => only({ ...ok, cover: { ...ok.cover, exceeded: true } }, /^COVERING_FACET_WITHOUT_AGREEMENT$/, 'mandatoryPartition'));
  it('1 : une offre lue sous deux valeurs', () => {
    // Under condition 2 an overlap also breaks the union: both are named, the proof is refused.
    const proof = facetProof({ ...ok, unionIds: 2_099, boards: [ok.boards[0]!, { ...ok.boards[1]!, overlap: 1 }] });
    expect(proof.adopted).toBe(false);
    expect(proof.failures).toEqual(['COVERING_FACET_OVERLAP=1', 'COVERING_FACET_TOTAL_MISMATCH=2099/2100']);
  });
  it('2 : un tableau non prouvé', () => only({ ...ok, boards: [ok.boards[0]!, { ...ok.boards[1]!, complete: false }] }, /^COVERING_BOARD_UNPROVEN$/, 'everyValueRead'));
  it('2 : un tableau au plafond', () => only({ ...ok, cover: { ...ok.cover, sum: 2_800 }, unionIds: 2_800,
    boards: [{ ...ok.boards[0]!, total: WORKDAY_TOTAL_CAP }, ok.boards[1]!] }, /^COVERING_BOARD_AT_CAP=f=A$/, 'everyValueRead'));
  it('2 : les totaux des tableaux ne font pas le compte de la facette', () => only({ ...ok, boards: [ok.boards[0]!, { ...ok.boards[1]!, total: 801 }] },
    /^COVERING_FACET_VALUES_MISMATCH=2101\/2100$/, 'everyValueRead'));
  it('2 : aucune valeur lue', () => only({ ...ok, cover: { ...ok.cover, sum: 0 }, unionIds: 0, boards: [] }, /^COVERING_FACET_NO_VALUE_READ$/, 'everyValueRead'));
  it('3 : l’union lue ne fait pas la somme des comptes', () => only({ ...ok, unionIds: 2_099 }, /^COVERING_FACET_TOTAL_MISMATCH=2099\/2100$/, 'unionEqualsCounts'));
  it('3 : les lignes sans chemin comptent dans l’union', () => {
    expect(facetProof({ ...ok, unionIds: 2_099, boards: [ok.boards[0]!, { ...ok.boards[1]!, withoutPath: 1 }] }).adopted).toBe(true);
  });
});
