import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockJson = vi.fn();
vi.mock('../../lib/http.js', () => ({ fetchJson: (...args: unknown[]) => mockJson(...args) }));
import { attachWorkdayDescriptions, fetchWorkdayJobs } from './workday.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
/** Real Tapestry responses of 2026-09-10: site page 1 (total 2 000, facet Brand), page 1 of each Brand value, the full id list per value (2 085 ids). */
const SITE_P1 = fixture('lot4-tapestry-listing-p1-nofacet.json');
const BRAND_P1: Record<string, any> = { Coach: fixture('lot4-tapestry-brand-Coach-p1.json'), 'Kate Spade': fixture('lot4-tapestry-brand-Kate_Spade-p1.json'), Tapestry: fixture('lot4-tapestry-brand-Tapestry-p1.json') };
const BRAND_IDS: Record<string, string[]> = fixture('lot4-tapestry-brand-ids.json');
const FACET = SITE_P1.facets.find((f: any) => f.facetParameter === 'Brand');
const idOf = (v: any) => FACET.values.find((x: any) => x.descriptor === v).id;
const CONFIG = { tenant: 'tapestry', site: 'Tapestry_Careers', origin: 'https://tapestry.wd108.myworkdayjobs.com', partitionFacet: 'Brand', withDescriptions: false };

/** Serves a board from an ordered id list the way Workday does: 20 rows per offset, `total` on page 1 only, the site capped at 2 000 ids and the same page re-served beyond. */
function server(opts: { site: string[]; siteTotal: number; boards: Record<string, string[]>; extraBoard?: (brandId: string, offset: number) => any[] | undefined }) {
  const rows = (paths: string[], offset: number) => paths.slice(offset, offset + 20).map((externalPath) => ({ title: `Posting ${externalPath.split('_').pop()}`, externalPath, locationsText: 'Somewhere', postedOn: 'Posted Today', bulletFields: [externalPath.split('_').pop()!] }));
  mockJson.mockImplementation(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { offset: number; appliedFacets: Record<string, string[]> };
    const brandId = body.appliedFacets.Brand?.[0];
    if (!brandId) {
      const served = body.offset >= 2000 ? opts.site.slice(1980, 2000) : opts.site.slice(body.offset, body.offset + 20);
      return { total: body.offset === 0 ? opts.siteTotal : 0, facets: body.offset === 0 ? SITE_P1.facets : undefined, jobPostings: rows(served, 0) };
    }
    const custom = opts.extraBoard?.(brandId, body.offset);
    const list = opts.boards[brandId] ?? [];
    return { total: body.offset === 0 ? list.length : 0, jobPostings: custom ?? rows(list, body.offset) };
  });
}

beforeEach(() => { mockJson.mockReset(); });

describe('Workday partition by facet — Tapestry, 2026-09-10 (site total capped at 2 000, facet Brand = 1 514 + 502 + 69)', () => {
  it('reads every partition under the cap, credits each posting to its facet value and names the cap', async () => {
    const all = [...BRAND_IDS.Coach!, ...BRAND_IDS['Kate Spade']!, ...BRAND_IDS.Tapestry!];
    expect(new Set(all).size).toBe(2085);
    // The real site serves 2 000 of them (91 invisible in the real sweep: Coach 78, Kate Spade 13) plus 6 postings without any Brand value.
    const unbranded = ['/job/Malaysia/Sales-Associate--Various-Locations-_JR2334', '/job/Indonesia/Sr-Manager--On-site-Product-Engineering_JR12279'];
    // 2 unbranded + 1 998 branded = exactly the 2 000 rows the capped site serves (87 branded postings invisible).
    const site = [...unbranded, ...all.filter((_, i) => i >= 87)];
    expect(site).toHaveLength(2000);
    server({ site, siteTotal: 2000, boards: { [idOf('Coach')]: BRAND_IDS.Coach!, [idOf('Kate Spade')]: BRAND_IDS['Kate Spade']!, [idOf('Tapestry')]: BRAND_IDS.Tapestry! } });

    const result = await fetchWorkdayJobs(CONFIG);
    const byBrand = new Map<string, number>();
    for (const job of result.jobs) byBrand.set(job.company ?? '∅', (byBrand.get(job.company ?? '∅') ?? 0) + 1);
    expect(byBrand.get('Coach')).toBe(1514); expect(byBrand.get('Kate Spade')).toBe(502); expect(byBrand.get('Tapestry')).toBe(69); expect(byBrand.get('∅')).toBe(2);
    expect(result.jobs).toHaveLength(2087);
    expect(result.declaredTotal).toBe(2087);
    const coach = result.jobs.find((j) => j.company === 'Coach')!;
    expect(coach.employerEvidence).toEqual({ rawName: 'Coach', path: 'listing.facets.Brand', rule: 'PARTITION_FACET_VALUE' });
    expect((coach.raw as any).facet).toEqual({ parameter: 'Brand', value: 'Coach', id: idOf('Coach') });
    const scopes = Object.fromEntries(result.enumeration!.scopes!.map((s) => [s.scope, s]));
    expect(scopes['Brand=Coach']!).toMatchObject({ declaredTotal: 1514, uniqueIds: 1514, complete: true });
    expect(scopes['Brand=Kate Spade']!).toMatchObject({ declaredTotal: 502, complete: true });
    expect(scopes['Brand=Tapestry']!).toMatchObject({ declaredTotal: 69, complete: true });
    expect(scopes['jobs:unpartitioned']!).toMatchObject({ declaredTotal: 2, uniqueIds: 2, complete: true });
    expect(result.enumeration!.issues).toEqual(expect.arrayContaining(['PUBLISHER_TOTAL_CAPPED', 'UNPARTITIONED_POSTINGS=2', 'UNPARTITIONED_UNDER_CAP', 'ENUMERATION_NOT_PROVEN']));
    // Under a capped site total, unbranded postings beyond the cap are unobservable: honest, not proven.
    expect(result.complete).toBe(false); expect(result.enumeration!.termination).toBe('UNPARTITIONED_UNDER_CAP');
    expect(result.enumeration!.method).toBe('PUBLISHER_TOTAL_COUNT_JSON_PAGINATION_PARTITIONED');
    // Page evidence names the partition of every page, and the facet inventory is archived.
    expect(result.enumeration!.pageEvidence![0]!.url).toMatch(/#facets$/);
    expect(result.enumeration!.pageEvidence![0]!.componentCounters).toEqual(['Brand=Coach:1514', 'Brand=Kate Spade:502', 'Brand=Tapestry:69']);
    expect(result.enumeration!.pageEvidence!.some((p) => p.componentCounters.includes('partition=Brand=Kate Spade'))).toBe(true);
  });

  it('is proven when every posting of the site belongs to a partition (no unbranded remainder)', async () => {
    const all = [...BRAND_IDS.Coach!, ...BRAND_IDS['Kate Spade']!, ...BRAND_IDS.Tapestry!];
    server({ site: all.slice(0, 2000), siteTotal: 2000, boards: { [idOf('Coach')]: BRAND_IDS.Coach!, [idOf('Kate Spade')]: BRAND_IDS['Kate Spade']!, [idOf('Tapestry')]: BRAND_IDS.Tapestry! } });
    const result = await fetchWorkdayJobs(CONFIG);
    expect(result.jobs).toHaveLength(2085); expect(result.declaredTotal).toBe(2085);
    expect(result.complete).toBe(true); expect(result.enumeration!.termination).toBe('PARTITIONS_RECONCILED');
    expect(result.enumeration!.issues).toEqual(expect.arrayContaining(['PUBLISHER_TOTAL_CAPPED']));
    expect(result.enumeration!.issues).not.toContain('ENUMERATION_NOT_PROVEN');
  });

  it('refuses a posting served under two facet values (its employer would be a coin toss) and names the overlap', async () => {
    const coach = BRAND_IDS.Coach!.slice(0, 40), kate = [BRAND_IDS.Coach![0]!, ...BRAND_IDS['Kate Spade']!.slice(0, 19)];
    server({ site: [...coach, ...kate.slice(1)], siteTotal: 59, boards: { [idOf('Coach')]: coach, [idOf('Kate Spade')]: kate, [idOf('Tapestry')]: [] } });
    const result = await fetchWorkdayJobs(CONFIG);
    expect(result.jobs.filter((j) => j.externalId === BRAND_IDS.Coach![0]!.split('/').pop())).toHaveLength(1);
    expect(result.jobs.find((j) => j.externalId === BRAND_IDS.Coach![0]!.split('/').pop())!.company).toBe('Coach');
    expect(result.complete).toBe(false);
    expect(result.enumeration!.issues).toEqual(expect.arrayContaining(['PARTITION_OVERLAP', 'ENUMERATION_NOT_PROVEN']));
  });

  it('falls back to the whole site, named, when the tenant has no such facet', async () => {
    const site = BRAND_IDS.Tapestry!;
    mockJson.mockImplementation(async (_url: string, init: { body: string }) => {
      const { offset } = JSON.parse(init.body) as { offset: number };
      return { total: offset === 0 ? site.length : 0, facets: offset === 0 ? SITE_P1.facets.filter((f: any) => f.facetParameter !== 'Brand') : undefined, jobPostings: site.slice(offset, offset + 20).map((externalPath) => ({ title: 'T', externalPath, locationsText: 'X' })) };
    });
    const result = await fetchWorkdayJobs(CONFIG);
    expect(result.jobs).toHaveLength(69); expect(result.complete).toBe(true);
    expect(result.jobs.every((j) => j.company === undefined && j.employerEvidence === undefined)).toBe(true);
    expect(result.enumeration!.issues).toContain('PARTITION_FACET_ABSENT');
    expect(result.enumeration!.method).toBe('PUBLISHER_TOTAL_COUNT_JSON_PAGINATION');
  });

  it('keeps the facet attribution through the detail pass: the logo alt and the legal entity stay in the raw, never a second employer claim', async () => {
    mockJson.mockResolvedValueOnce({ jobPostingInfo: { jobDescription: 'Sell handbags', logoImage: { alt: 'Coach Logo' }, country: { descriptor: 'Japan' } }, hiringOrganization: { name: 'Tapestry Japan, LLC' } } as never);
    const [job] = await attachWorkdayDescriptions([{ externalId: 'JR1', title: 'Sales Associate', url: 'https://tapestry.wd108.myworkdayjobs.com/Tapestry_Careers/job/x', company: 'Kate Spade', employerEvidence: { rawName: 'Kate Spade', path: 'listing.facets.Brand', rule: 'PARTITION_FACET_VALUE' }, raw: { externalPath: '/job/x', facet: { parameter: 'Brand', value: 'Kate Spade', id: 'k' } } }], 'https://tapestry.wd108.myworkdayjobs.com/wday/cxs/tapestry/Tapestry_Careers');
    expect(job.company).toBe('Kate Spade');
    expect(job.employerEvidence).toEqual({ rawName: 'Kate Spade', path: 'listing.facets.Brand', rule: 'PARTITION_FACET_VALUE' });
    expect(job.description).toBe('Sell handbags'); expect(job.country).toBe('Japan');
    expect((job.raw as any).detail.hiringOrganization.name).toBe('Tapestry Japan, LLC');
    expect(job.publicationHold).toBeUndefined();
  });
});
