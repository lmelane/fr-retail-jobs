import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockJson = vi.fn();
vi.mock('../../lib/http.js', () => ({ fetchJson: (...args: unknown[]) => mockJson(...args) }));
import { attachWorkdayDescriptions, brandFromLocationPrefix, fetchWorkdayJobs, locationPrefixRule } from './workday.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
/** Real Saks tenant rows of 2026-09-10 (saks / careers_at_saks): 747 postings, banner coded in locationsText. */
const ROWS: Array<{ externalPath: string; title: string; locationsText?: string; bulletFields?: string[] }> = fixture('lot4-workday-saks-rows.json');
const P1 = fixture('lot4-workday-saks-listing-p1.json');
const MAP = { NM: 'Neiman Marcus', SF: 'Saks Fifth Avenue', BG: 'Bergdorf Goodman', O5: 'Saks OFF 5TH' };
const CONFIG = { tenant: 'saks', site: 'careers_at_saks', origin: 'https://saks.wd1.myworkdayjobs.com', brandFromLocationPrefix: { map: MAP, otherwise: 'Exemplar Luxury Group' }, withDescriptions: false };

beforeEach(() => { mockJson.mockReset(); });

describe('Workday brand from the tenant store code in locationsText — Saks, 2026-09-10', () => {
  it('reads the banner from the prefix, the group when the row has none, and nothing without a rule', () => {
    const rule = locationPrefixRule(CONFIG)!;
    expect(brandFromLocationPrefix('NM_0114_Houston', rule)).toEqual({ brand: 'Neiman Marcus', prefix: 'NM' });
    expect(brandFromLocationPrefix('BG_9066_BG CORPORATE', rule)).toEqual({ brand: 'Bergdorf Goodman', prefix: 'BG' });
    expect(brandFromLocationPrefix('O5_0842_BUCKHEAD', rule)).toEqual({ brand: 'Saks OFF 5TH', prefix: 'O5' });
    expect(brandFromLocationPrefix('Remote_New York', rule)).toEqual({ brand: 'Exemplar Luxury Group', prefix: null });
    expect(brandFromLocationPrefix('SG_0560_ECDC', rule)).toEqual({ brand: 'Exemplar Luxury Group', prefix: null });
    expect(brandFromLocationPrefix('NM_0114_Houston', { map: MAP })).toEqual({ brand: 'Neiman Marcus', prefix: 'NM' });
    expect(brandFromLocationPrefix('Remote_New York', { map: MAP })).toBeUndefined();
    expect(locationPrefixRule({})).toBeUndefined();
    expect(locationPrefixRule({ brandFromLocationPrefix: { map: { 'n m': 'x', NM: '' } } })).toBeUndefined();
  });

  it('attributes the 747 real rows: 701 by banner code, 46 to the group, and keeps the code in the raw row', async () => {
    mockJson.mockImplementation(async (_url: string, init: { body: string }) => {
      const { offset } = JSON.parse(init.body) as { offset: number };
      return { total: offset === 0 ? ROWS.length : 0, facets: offset === 0 ? P1.facets : undefined, jobPostings: ROWS.slice(offset, offset + 20) };
    });
    const result = await fetchWorkdayJobs(CONFIG);
    expect(result.jobs).toHaveLength(747); expect(result.complete).toBe(true);
    const by = new Map<string, number>();
    for (const j of result.jobs) by.set(j.company ?? '∅', (by.get(j.company ?? '∅') ?? 0) + 1);
    expect(Object.fromEntries(by)).toEqual({ 'Neiman Marcus': 420, 'Saks Fifth Avenue': 188, 'Bergdorf Goodman': 66, 'Saks OFF 5TH': 27, 'Exemplar Luxury Group': 46 });
    const nm = result.jobs.find((j) => (j.raw as any).locationsText === 'NM_0114_Houston')!;
    expect(nm.employerEvidence).toEqual({ rawName: 'Neiman Marcus', path: 'listing.locationsText.prefix', rule: 'LOCATION_CODE_PREFIX' });
    expect((nm.raw as any).locationPrefix).toBe('NM');
    const remote = result.jobs.find((j) => String((j.raw as any).locationsText).startsWith('Remote_'))!;
    expect(remote.employerEvidence).toEqual({ rawName: 'Exemplar Luxury Group', path: 'listing.locationsText.prefix', rule: 'LOCATION_CODE_PREFIX_ABSENT' });
    expect((remote.raw as any).locationPrefix).toBeNull();
    // Without the option the same rows carry no employer claim from the listing (the detail decides, as before).
    mockJson.mockImplementation(async (_url: string, init: { body: string }) => { const { offset } = JSON.parse(init.body) as { offset: number }; return { total: offset === 0 ? 40 : 0, jobPostings: ROWS.slice(offset, Math.min(offset + 20, 40)) }; });
    const plain = await fetchWorkdayJobs({ ...CONFIG, brandFromLocationPrefix: undefined });
    expect(plain.jobs.every((j) => j.company === undefined && j.employerEvidence === undefined)).toBe(true);
  });

  it('keeps the banner through the detail pass: the legal entity "060 SAKS & CO LLC" stays in the raw', async () => {
    mockJson.mockResolvedValueOnce({ jobPostingInfo: { jobDescription: 'Sell', location: 'NM_0114_Houston' }, hiringOrganization: { name: '060 SAKS & CO LLC' } } as never);
    const [job] = await attachWorkdayDescriptions([{ externalId: 'R-109041', title: 'Seasonal Selling Associate (FOH)', url: 'https://saks.wd1.myworkdayjobs.com/careers_at_saks/job/x', company: 'Neiman Marcus', employerEvidence: { rawName: 'Neiman Marcus', path: 'listing.locationsText.prefix', rule: 'LOCATION_CODE_PREFIX' }, raw: { externalPath: '/job/x', locationsText: 'NM_0114_Houston', locationPrefix: 'NM' } }], 'https://saks.wd1.myworkdayjobs.com/wday/cxs/saks/careers_at_saks');
    expect(job.company).toBe('Neiman Marcus');
    expect(job.employerEvidence?.rule).toBe('LOCATION_CODE_PREFIX');
    expect((job.raw as any).detail.hiringOrganization.name).toBe('060 SAKS & CO LLC');
    expect(job.publicationHold).toBeUndefined();
  });
});
