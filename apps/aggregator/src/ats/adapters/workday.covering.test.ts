import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { coveringFacet, fetchWorkdayJobs, WORKDAY_TOTAL_CAP } from './workday.js';
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

  it('lit chaque valeur de la facette sous le plafond : 2 100 offres sur 2 100, comptes concordants, preuve archivée mais NON adoptée, aucun employeur tiré de la facette', async () => {
    server(all, { 'fam-Stores': families.Stores, 'fam-Corporate': families.Corporate, 'fam-DC': families.DC }, facetsFor(families, states));
    const r = await fetchWorkdayJobs(config);
    // Avant ce lot : 2 020 offres (les 2 000 du site et la page sondée au-delà), complete: false, PUBLISHER_TOTAL_CAPPED.
    expect(r.jobs).toHaveLength(2_100);
    expect(new Set(r.jobs.map((job) => job.externalId)).size).toBe(2_100);
    expect(r.declaredTotal).toBe(2_100);
    // Reconciled and archived as such, but never handed on as complete: canAttestAbsence, D-484 §2 and availability holds
    // read `complete`, not the termination. Adopting this proof is the owner's decision.
    expect(r.complete).toBe(false); expect(r.truncated).toBe(false);
    expect(r.enumeration).toMatchObject({ method: 'PUBLISHER_TOTAL_COUNT_JSON_PAGINATION_COVERING_FACET', termination: 'COVERING_FACET_RECONCILED',
      enumerationTraversalComplete: true });
    expect(r.enumeration?.scopes?.[0]).toMatchObject({ scope: 'jobs', declaredTotal: 2_100, uniqueIds: 2_100, complete: true });
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['PUBLISHER_TOTAL_CAPPED', 'COVERED_BY_FACET=jobFamilyGroup', 'COVERING_FACET_PROOF_NOT_ADOPTED']));
    expect(r.enumeration?.issues).not.toContain('ENUMERATION_NOT_PROVEN');
    // Through the dispatcher's normalisation: the canonical contract holds on every page, nothing turns the lot into a broken contract.
    const normalized = normalizeAdapterResult(r);
    expect(normalized.complete).toBe(false);
    expect(normalized.enumeration?.issues).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
    // A job family is not a Maison: the employer stays the detail's to name.
    expect(r.jobs.every((job) => job.company === undefined && job.employerEvidence === undefined)).toBe(true);
    // Every page of a covering board carries its ids, so the canonical contract holds.
    expect(r.enumeration?.pageEvidence?.some((p) => p.componentCounters.includes('cover=jobFamilyGroup=DC') && p.canonicalIds!.length > 0)).toBe(true);
    expect(r.enumeration?.pageEvidence?.find((p) => p.url.includes('#coveringFacet='))?.componentCounters).toEqual(
      ['jobFamilyGroup=Stores:1300', 'jobFamilyGroup=Corporate:600', 'jobFamilyGroup=DC:200', 'sum=2100', 'agreeing=3']);
  });

  it('la lecture prouvée n’ouvre pas la fermeture : sa terminaison n’est pas probante pour le refresh', () => {
    expect(PROVING_TERMINATIONS.has('COVERING_FACET_RECONCILED')).toBe(false);
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
