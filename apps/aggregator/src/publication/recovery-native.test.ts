import { describe, it, expect, vi, afterEach } from 'vitest';
import { recoverRetainedPublication } from './recovery.js';
const observedAt = new Date('2024-02-20T12:00:00Z');
const read = (kind: string, raw: unknown, url: string, externalId: string, config: Record<string, unknown>) => recoverRetainedPublication(kind, raw, { url, externalId, config, observedAt });
afterEach(() => vi.unstubAllGlobals());
const inputs = [
  { kind: 'flatchr', externalId: 'company1:vacancy1', url: 'https://careers.flatchr.io/fr/company/brand/vacancy/advisor', config: { listingUrl: 'https://careers.flatchr.io/fr/company/brand' },
    raw: { id: 'publication1', published: true, status: 'published', vacancy: { id: 'vacancy1', slug: 'advisor', title: 'Own title', company: { id: 'company1', slug: 'brand', name: 'Brand' }, description: '<p>Own description</p>', mission: '<p>Own duties</p>', profile: '<p>Own requirements</p>' } } },
  { kind: 'personio', externalId: '42', url: 'https://brand.jobs.personio.com/job/42', config: { host: 'brand.jobs.personio.com' },
    raw: { id: 42, name: 'Own title', createdAt: '2024-01-01T12:00:00Z', jobDescriptions: { jobDescription: [{ name: 'Duties', value: '<p>Own description</p>' }, { name: 'Requirements', value: '<p>Own requirements</p>' }] } } },
  { kind: 'jobylon', externalId: '42', url: 'https://emp.jobylon.com/jobs/42-advisor/', config: {},
    raw: { source: 'jobylon', listing: { externalId: '42', path: '/jobs/42-advisor/', title: 'Old title' }, posting: { '@type': 'JobPosting', title: 'Own title', description: '<p>Own description</p>' } } },
  { kind: 'talentview', externalId: '42', url: 'https://brand.talentview.io/jobs/advisor', config: { slug: 'brand' },
    raw: { id: 42, name: 'Own title', slug: 'advisor', detail: { id: 42, slug: 'advisor', is_draft: false, is_online: true, description: '<p>Own description</p>', profile: '<p>Own requirements</p>' } } },
  { kind: 'talentfunnel', externalId: '42', url: 'https://jobs.example/job/42', config: { origin: 'https://jobs.example', tenant: 'tenant1' },
    raw: { vacancy: { id: '42', vacancyId: '42', tenant: 'tenant1', jobTitle: 'Old title' }, detail: { id: '42', tenant: 'tenant1', status: 'ACTIVE', positionProfile: { title: 'Own title', description: '<p>Own description</p>' } } } },
  { kind: 'volcanic', externalId: '42', url: 'https://jobs.example/job/advisor', config: { origin: 'https://jobs.example' },
    raw: { id: 42, title: 'Own title', cached_slug: 'advisor', description: '<p>Own description</p>' } },
];
describe('retained native publication formats', () => {
  it.each(inputs)('reconstructs $kind only from its own input without networking', item => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network'); }));
    const result = read(item.kind, item.raw, item.url, item.externalId, item.config);
    expect(result).toMatchObject({ status: 'RECOVERABLE', job: { title: 'Own title', url: item.url, externalId: item.externalId, raw: item.raw } });
    if (result.status === 'RECOVERABLE') expect(result.job.description).toContain('Own description');
    expect(fetch).not.toHaveBeenCalled();
    expect(read(item.kind, item.raw, item.url, 'foreign-id', item.config)).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
    expect(read(item.kind, item.raw, 'https://foreign.example/job', item.externalId, item.config)).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
  });
  it('never dates a Personio publication from XML createdAt and refuses unqualified enriched shapes', () => {
    const c = inputs[1];
    const result = read(c.kind, c.raw, c.url, c.externalId, c.config);
    expect(result.status).toBe('RECOVERABLE');
    if (result.status === 'RECOVERABLE') expect(result.job.postedAt).toBeUndefined();
    expect(read(c.kind, { ...c.raw, personioDetail: {} }, c.url, c.externalId, c.config)).toMatchObject({ reason: 'READER_UNQUALIFIED' });
  });
  it('binds the Jobylon listing path to its native ID and refuses foreign detail URLs', () => {
    const c = inputs[2]; const raw = c.raw as any;
    expect(read(c.kind, { ...raw, listing: { ...raw.listing, path: '/jobs/43-other/' } }, c.url, c.externalId, c.config)).toMatchObject({ reason: 'DETAIL_IDENTITY_MISMATCH' });
    expect(read(c.kind, { ...raw, posting: { ...raw.posting, url: 'https://emp.jobylon.com/jobs/43-other/' } }, c.url, c.externalId, c.config)).toMatchObject({ reason: 'DETAIL_IDENTITY_MISMATCH' });
  });
  it.each([3, 4])('binds each detail to the same native publication and holds unpublished state (%s)', index => {
    const c = inputs[index];const raw = c.raw as any;
    expect(read(c.kind, { ...raw, detail: { ...raw.detail, id: 'foreign-id' } }, c.url, c.externalId, c.config)).toMatchObject({ reason: 'DETAIL_IDENTITY_MISMATCH' });
    const detail = index === 3 ? { ...raw.detail, is_online: false } : { ...raw.detail, status: 'ARCHIVED' };
    expect(read(c.kind, { ...raw, detail }, c.url, c.externalId, c.config)).toMatchObject({ reason: 'PUBLICATION_HELD' });
  });
  it('refuses an unpublished Flatchr item and a foreign company board', () => {
    const c = inputs[0];
    expect(read(c.kind, { ...c.raw, published: false }, c.url, c.externalId, c.config)).toMatchObject({ reason: 'PUBLICATION_HELD' });
    expect(read(c.kind, c.raw, c.url, c.externalId, { listingUrl: 'https://careers.flatchr.io/fr/company/foreign' })).toMatchObject({ status: 'RECOLLECT_OR_REVIEW' });
  });
  it('refuses a Talent Funnel tenant conflict even when the posting ID matches', () => {
    const c = inputs[4];
    expect(read(c.kind, c.raw, c.url, c.externalId, { ...c.config, tenant: 'foreign-tenant' })).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
  });
});

it('replays a retained Volcanic detail without discarding its publication dates',()=>{
 const c=inputs[5];const raw={...c.raw,postingEvidence:{pageUrl:c.url,htmlSha256:'a'.repeat(64),jobPostingCount:1,jobPosting:{'@type':'JobPosting',title:'Own title',description:'Full detail text',datePosted:'2026-09-04T14:07:48.268Z',validThrough:'2026-10-31T22:59:00.000Z',url:c.url}}};
 expect(read(c.kind,raw,c.url,c.externalId,c.config)).toMatchObject({status:'RECOVERABLE',job:{description:'Full detail text',postedAt:new Date('2026-09-04T14:07:48.268Z'),raw}});
});
