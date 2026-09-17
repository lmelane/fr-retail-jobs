import { afterEach, describe, expect, it, vi } from 'vitest';
import { recoverRetainedPublication } from './recovery.js';
const observedAt = new Date('2024-02-20T12:00:00Z');
const url = 'https://brand.easycruit.com/vacancy/42/5';
const xml = { '@_id': '42', '@_date_start': '2024-01-01', '@_date_modified': '2024-02-01', Departments: { Department: { VacancyURL: url } },
  Versions: { Version: { '@_language': 'en', Title: 'Own title', Description: '<p>Own description</p>', Region: { Country: { '@_name': 'France' } } } } };
const inputs = [
  { kind: 'easycruit', externalId: '42', url, config: { host: 'brand.easycruit.com' }, raw: { listing: xml, detail: xml,
    postingEvidence: { pageUrl: url, htmlSha256: 'a'.repeat(64), jobPostingCount: 0, jobPosting: null } } },
  { kind: 'harri', externalId: '42', url: 'https://harri.com/Brand-Store/job/42', config: { slug: 'Brand', brandId: 17, employerMode: 'PORTAL_OWNER' },
    raw: { listing: { id: 42, aliasPosition: 'Old title', brand: { name: 'Brand Store', slug: 'Brand-Store' } }, detail: { id: 42, title: 'Own title', description: '<p>Own description</p>', status: 'PUBLISHED' },
      detailUrl: 'https://gateway.harri.com/core-reader/api/v1/profile/job/42', portal: { id: 17, slug: 'Brand', name: 'Brand' } } },
  { kind: 'talentrecruiter', externalId: '42', url: 'https://candidate.hr-manager.net/ApplicationInit.aspx?ProjectId=42&cid=1', config: { customer: 'brand' },
    raw: { position: { Id: 42, Name: 'Own title', CustomerAlias: 'brand', CustomerName: 'Brand', ProjectType: 'RecruitmentProject', Advertisements: [{ Id: 1, Content: '<p>Own description</p>' }],
      AdvertisementUrlSecure: 'https://candidate.hr-manager.net/ApplicationInit.aspx?ProjectId=42&cid=1', Created: '/Date(1704067200000)/', Department: { Country: 'Denmark' } } } },
];
const read = (c: typeof inputs[number], raw: unknown = c.raw, config: Record<string, unknown> = c.config) => recoverRetainedPublication(c.kind, raw, { externalId: c.externalId, url: c.url, config, observedAt });
afterEach(() => vi.unstubAllGlobals());
describe('retained XML and native career portals', () => {
  it.each(inputs)('reads $kind from its own evidence without a new observation or network', c => {
    vi.stubGlobal('fetch', vi.fn(() => { throw Error('No networking'); }));
    const r = read(c);
    expect(r).toMatchObject({ status: 'RECOVERABLE', job: { title: 'Own title', description: 'Own description', externalId: '42', url: c.url, raw: c.raw } });
    if (r.status === 'RECOVERABLE') expect(r.job.postedAt).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(recoverRetainedPublication(c.kind, c.raw, { externalId: '43', url: c.url, config: c.config, observedAt })).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
    expect(recoverRetainedPublication(c.kind, c.raw, { externalId: c.externalId, url: 'https://foreign.example/job', config: c.config, observedAt })).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
  });
  it('refuses another Easycruit detail or tenant', () => {
    const c = inputs[0]; const raw = c.raw as any;
    expect(read(c, { ...raw, detail: { ...xml, '@_id': '43' } })).toMatchObject({ reason: 'DETAIL_IDENTITY_MISMATCH' });
    expect(read(c, raw, { host: 'foreign.easycruit.com' })).toMatchObject({ status: 'RECOLLECT_OR_REVIEW' });
  });
  it('uses a retained single Easycruit JobPosting through the native parser', () => {
    const c = inputs[0];const raw = c.raw as any;
    const posting = { '@type': 'JobPosting', title: 'Own title', description: 'Full published text', datePosted: '2024-01-15', url };
    const enriched = { ...raw, postingEvidence: { ...raw.postingEvidence, jobPostingCount: 1, jobPosting: posting } };
    expect(read(c, enriched)).toMatchObject({ status: 'RECOVERABLE', job: { description: 'Full published text', postedAt: new Date('2024-01-15T00:00:00Z'), raw: enriched } });
    for (const patch of [{ jobPostingCount: 2 }, { htmlSha256: 'lost' }, { pageUrl: 'https://foreign.example/job' }, { jobPosting: { ...posting, url: 'https://brand.easycruit.com/vacancy/43/5' } }, { jobPosting: { ...posting, '@type': 'WebPage' } }]) {
      expect(read(c, { ...enriched, postingEvidence: { ...enriched.postingEvidence, ...patch } })).toMatchObject({ reason: 'DETAIL_EVIDENCE_UNUSABLE' });
    }
  });
  it('binds Harri portal, native detail endpoint and posting identity', () => {
    const c = inputs[1];const raw = c.raw as any;
    for (const patch of [{ detail: { ...raw.detail, id: 43 } }, { detailUrl: 'https://gateway.harri.com/core-reader/api/v1/profile/job/43' }]) expect(read(c, { ...raw, ...patch })).toMatchObject({ reason: 'DETAIL_IDENTITY_MISMATCH' });
    expect(read(c, { ...raw, portal: { ...raw.portal, id: 18 } })).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
    expect(read(c, raw, { ...c.config, portalUrl: 'https://harri.com/Foreign' })).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
  });
  it.each(['UNPUBLISHED', 'CLOSED', 'EXPIRED', 'UNKNOWN'])('does not recover Harri state %s as available', status => {
    const c = inputs[1];const raw = c.raw as any;
    expect(read(c, { ...raw, detail: { ...raw.detail, status } })).toMatchObject({ reason: 'PUBLICATION_HELD' });
  });
  it('binds TalentRecruiter customer and rejects ambiguous native project IDs', () => {
    const c = inputs[2];const raw = c.raw as any;
    expect(read(c, raw, { customer: 'foreign' })).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
    expect(read(c, raw, { customer: 'brand', portalUrl: 'https://candidate.hr-manager.net/vacancies/list.aspx?customer=foreign' })).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
    expect(read(c, { ...raw, position: { ...raw.position, AdvertisementUrlSecure: c.url + '&ProjectId=43' } })).toMatchObject({ status: 'RECOLLECT_OR_REVIEW' });
  });
  it('keeps missing TalentRecruiter content and geography unknown, without using corporate fields or teaser text', () => {
    const c = inputs[2];const raw = c.raw as any;const r = read(c);
    expect(r.status).toBe('RECOVERABLE');if (r.status === 'RECOVERABLE') expect(r.job.country).toBeUndefined();
    expect(read(c, { ...raw, position: { ...raw.position, Advertisements: [{ Id: 1, Introduction: 'Teaser', Description: 'Summary' }] } })).toMatchObject({ reason: 'CONTENT_MISSING' });
    expect(read(c, { ...raw, position: { ...raw.position, ProjectType: 'Unknown' } })).toMatchObject({ reason: 'PUBLICATION_HELD' });
  });
});
