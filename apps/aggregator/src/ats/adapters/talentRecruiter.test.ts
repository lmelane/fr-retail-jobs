import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn(), DEFAULT_DETAIL_CONCURRENCY: 4 }));
import { fetchJson, fetchText } from '../../lib/http.js';
import { fetchTalentRecruiterJobs, talentRecruiterDate } from './talentRecruiter.js';
const api = vi.mocked(fetchJson), text = vi.mocked(fetchText);
const position = (Id: number, overrides: Record<string, unknown> = {}) => ({
  Id, Name: 'Client Advisor', CustomerAlias: 'ganni', CustomerName: 'GANNI A/S', ProjectType: 'RecruitmentProject',
  Published: '/Date(1788294884000+0200)/', Created: '/Date(1788294816000+0200)/',
  AdvertisementUrlSecure: `https://candidate.hr-manager.net/ApplicationInit.aspx?cid=1970&ProjectId=${Id}&MediaId=5`,
  Advertisements: [{ Id: 1, Content: '<p>Join the store team.</p>' }],
  WorkPlaceCoordinates: '48.873224, 2.3323863', PositionLocation: { Name: 'Paris' },
  DepartmentTree: { Country: 'Danmark' }, ProjectParticipants: ['Not needed for public job evidence'], ...overrides,
});
const feed = (Items: ReturnType<typeof position>[], total = Items.length, skip = 0) => ({
  Items, CustomerAlias: 'ganni', CustomerName: 'GANNI A/S', TransactionStatus: { StatusCode: 0 },
  PositionCountCustomer: total, PositionCountSearch: total, PositionCountList: Items.length, PositionCountSkipped: skip,
});
beforeEach(() => { vi.resetAllMocks(); text.mockResolvedValue('<iframe src="https://www.google.com/maps/embed/v1/place?q=40%20Bd%20Haussmann,75008%20Paris,Frankrig"></iframe>'); });

describe('Talent Recruiter public job portal API', () => {
  it('refuses a configured portal pointing to a different customer before any request', async () => {
    await expect(fetchTalentRecruiterJobs({ customer: 'ganni', portalUrl: 'https://candidate.hr-manager.net/vacancies/list.aspx?customer=kimdemo' })).rejects.toThrow('PORTAL_CUSTOMER_CONFLICT');
    expect(api).not.toHaveBeenCalled(); expect(text).not.toHaveBeenCalled();
  });
  it('reads native publication, public content, explicit map address and preserves source coordinates', async () => {
    api.mockResolvedValue(feed([position(144697)])); const r = await fetchTalentRecruiterJobs({ customer: 'ganni' });
    expect(r.complete).toBe(true); expect(r.jobs[0]).toMatchObject({ company: 'GANNI A/S', country: 'Frankrig', latitude: 48.873224, longitude: 2.3323863, opportunityType: 'JOB_OPENING', postedAt: new Date(1788294884000) });
    expect((r.jobs[0].raw as any).position).not.toHaveProperty('ProjectParticipants');
    expect((r.jobs[0].raw as any).position).not.toHaveProperty('DepartmentTree');
  });
  it('uses documented take/skip and all four counters, without geographic or project-type filtering', async () => {
    api.mockResolvedValueOnce(feed([position(1), position(2)], 3)).mockResolvedValueOnce(feed([position(3)], 3, 2));
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' }); expect(r.complete).toBe(true); expect(r.jobs).toHaveLength(3);
    const urls = api.mock.calls.map(([url]) => new URL(url));
    expect(urls.map(u => u.searchParams.get('skip'))).toEqual(['0','2']);
    expect(urls.every(u => u.searchParams.get('take') === '100' && u.searchParams.get('incads') === 'true' && !u.searchParams.has('protype'))).toBe(true);
    expect(r.enumeration?.pageEvidence?.[1].componentCounters).toContain('skipped=2');
  });
  it('retains native open applications, including their absence of specific vacancy content', async () => {
    api.mockResolvedValue(feed([position(143570, { ProjectType: 'OpenApplication', Advertisements: [], Published: undefined, WorkPlaceCoordinates: '', PositionLocation: null })])); text.mockResolvedValue('');
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' }); expect(r.complete).toBe(true); expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0].opportunityType).toBe('OPEN_APPLICATION'); expect(r.jobs[0].postedAt).toBeUndefined(); expect(r.jobs[0].description).toBeUndefined();
  });
  it('does not use the corporate country or a maps place identifier as the physical country/address', async () => {
    api.mockResolvedValue(feed([position(144687, { PositionLocation: { Name: 'Boston' }, WorkPlaceCoordinates: '42.3502433,-71.0792053' })]));
    text.mockResolvedValue('<iframe src="https://www.google.com/maps/embed/v1/place?q=place_id:abc"></iframe>');
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' }); expect(r.jobs[0].country).toBeUndefined(); expect(r.jobs[0].location).toBe('Boston');
    expect((r.jobs[0].raw as any).fieldEvidence.country).toMatchObject({ status: 'NOT_EXPLICIT_IN_PUBLIC_ADDRESS', hasSourceCoordinates: true });
  });
  it('preserves a listing and API description when a detail request fails, and exposes the failed proof', async () => {
    api.mockResolvedValue(feed([position(1)])); text.mockRejectedValue(Error('HTTP 403'));
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' }); expect(r.jobs).toHaveLength(1); expect(r.complete).toBe(false); expect(r.enumeration?.issues).toContain('DETAIL_READ_FAILED:1');
  });
  it('refuses API errors, a different customer and malformed counters instead of reporting a healthy empty feed', async () => {
    for (const response of [{ ...feed([]), TransactionStatus: { StatusCode: 5 } }, { ...feed([]), CustomerAlias: 'kimdemo' }, { ...feed([]), PositionCountCustomer: '0' }]) {
      api.mockResolvedValue(response); await expect(fetchTalentRecruiterJobs({ customer: 'ganni' })).rejects.toThrow('INVALID_FEED');
    }
  });
  it('detects duplicate IDs, scope mismatch, moving totals and a page budget', async () => {
    api.mockResolvedValueOnce(feed([position(1)], 2)).mockResolvedValueOnce(feed([position(1)], 2, 1));
    expect((await fetchTalentRecruiterJobs({ customer: 'ganni' })).enumeration?.issues).toContain('REPEATED_POSTING_ID:1');
    api.mockResolvedValue({ ...feed([position(1)]), PositionCountCustomer: 2 });
    expect((await fetchTalentRecruiterJobs({ customer: 'ganni' })).enumeration?.issues).toContain('UNFILTERED_CUSTOMER_SCOPE_MISMATCH');
    api.mockResolvedValueOnce(feed([position(1)], 2)).mockResolvedValueOnce(feed([position(2)], 3, 1));
    expect((await fetchTalentRecruiterJobs({ customer: 'ganni' })).enumeration?.issues).toContain('DECLARED_TOTAL_CHANGED');
    api.mockResolvedValue(feed([position(1)], 2)); expect((await fetchTalentRecruiterJobs({ customer: 'ganni', maxPages: 1 })).complete).toBe(false);
  });
  it('records invalid source rows and unknown opportunity types without inventing an accepted job', async () => {
    api.mockResolvedValue(feed([position(1), position(2, { AdvertisementUrlSecure: 'https://unrelated.example/2' })]));
    const r = await fetchTalentRecruiterJobs({ customer: 'ganni' }); expect(r.jobs).toHaveLength(1); expect(r.rejectedRows).toHaveLength(1); expect(r.complete).toBe(false);
    api.mockResolvedValue(feed([position(3, { ProjectType: 'NewProjectType' })])); expect((await fetchTalentRecruiterJobs({ customer: 'ganni' })).jobs[0].publicationHold).toBe('UNRECOGNISED_OPPORTUNITY_TYPE');
  });
});
it('interprets .NET UTC milliseconds exactly once and never treats Created as Published', () => {
  expect(talentRecruiterDate('/Date(1788294884000+0200)/')).toEqual(new Date(1788294884000));
  expect(talentRecruiterDate('/Date(1788294884000-0500)/')).toEqual(new Date(1788294884000));
  for (const value of [undefined, '', 'invalid', '/Date(not-a-date)/']) expect(talentRecruiterDate(value)).toBeUndefined();
});
