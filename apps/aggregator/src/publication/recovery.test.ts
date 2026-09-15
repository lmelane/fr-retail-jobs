import { createHash } from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { recoverRetainedPublication, retainedPublicationIdentity } from './recovery.js';
import { evidenceHash } from '../lib/evidenceHash.js';

const url = 'https://jobs.example.com/role-1';
const at = new Date('2024-02-20T12:00:00Z');
const lever = { id: 'role-1', text: 'Client Advisor', hostedUrl: url, descriptionPlain: 'Native role description', country: 'US' };
const read = (raw: unknown, extra = {}) => recoverRetainedPublication('lever', raw, { externalId: 'role-1', url, observedAt: at, config: {}, ...extra });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('retained publication recovery', () => {
  it('can verify a native identity without claiming that missing content is publishable', () => {
    const raw = { ...lever, descriptionPlain: undefined };
    const context = { externalId: 'role-1', url, observedAt: at, config: {} };
    expect(read(raw)).toMatchObject({ reason: 'CONTENT_MISSING' });
    expect(retainedPublicationIdentity('lever', raw, context)).toEqual({ status: 'VERIFIED', rawHash: evidenceHash(raw) });
    expect(retainedPublicationIdentity('lever', raw, { ...context, externalId: 'another' })).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
  });
  it('does not reinterpret an early missing-content failure as a verified identity', () => {
    expect(retainedPublicationIdentity('jobylon', { source: 'jobylon', listing: { externalId: '42', path: '/jobs/42-role' } },
      { externalId: '42', url: 'https://emp.jobylon.com/jobs/42-role', observedAt: at, config: {} }))
      .toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'CONTENT_MISSING' });
  });
  it('reads only native input, preserves unknown fields, and never uses the network', () => {
    const fetch = vi.fn(() => { throw new Error('No network permitted'); }); vi.stubGlobal('fetch', fetch);
    const raw = { ...lever, futureField: { untouched: true }, similarJobs: [{ text: 'Wrong related role' }] };
    const recovered = read(raw);
    expect(recovered).toMatchObject({ status: 'RECOVERABLE', job: { externalId: 'role-1', title: 'Client Advisor', description: 'Native role description', raw }, rawHash: evidenceHash(raw) });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [null, 'RAW_MISSING'], [{ source: 'lever' }, 'NATIVE_ID_MISSING'], [{ ...lever, id: 'different' }, 'IDENTITY_MISMATCH'],
    [{ ...lever, hostedUrl: 'https://other.example/role-1' }, 'IDENTITY_MISMATCH'],
    [{ ...lever, hostedUrl: 'https://user:secret@jobs.example.com/role-1' }, 'IDENTITY_MISMATCH'],
    [{ ...lever, descriptionPlain: undefined, similarJobs: [{ descriptionPlain: 'Wrong description' }] }, 'CONTENT_MISSING'],
    [{ ...lever, descriptionPlain: '<p> </p>' }, 'CONTENT_MISSING'],
    [{ ...lever, text: { malicious: 'not a title' } }, 'RAW_SCHEMA_INVALID'],
  ])('refuses incomplete or unrelated RAW (%s)', (raw, reason) => {
    expect(read(raw)).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason });
  });
  it('does not interpret an unqualified format as a generic job', () => {
    expect(recoverRetainedPublication('unqualified', lever, { externalId: 'role-1', url, observedAt: at, config: {} }))
      .toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'READER_UNQUALIFIED' });
  });
  it('keeps direct-link-only Ashby jobs held', () => {
    expect(recoverRetainedPublication('ashby', { id: 'role-1', title: 'Advisor', descriptionPlain: 'Own text', jobUrl: url, isListed: false },
      { externalId: 'role-1', url, observedAt: at, config: { board: 'brand' } })).toMatchObject({ reason: 'PUBLICATION_HELD' });
  });
  it('recovers a missing plain description from the retained HTML and all native sections', () => {
    expect(read({ ...lever, descriptionPlain: '', description: '<p>Native HTML</p>', lists: [{ text: 'Requirements', content: '<li>Own requirement</li>' }], additionalPlain: 'Closing' }))
      .toMatchObject({ status: 'RECOVERABLE', job: { description: 'Native HTML\n\nRequirements\n• Own requirement\n\nClosing' } });
  });
  it('does not turn a relative historical Workday date into an absolute date and binds its detail', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2035-06-01'));
    const workdayUrl = 'https://brand.myworkdayjobs.com/External/job/Paris/Advisor_R1';
    const raw = { title: 'Advisor', postedOn: 'Posted Yesterday', externalPath: '/job/Paris/Advisor_R1',
      detail: { hiringOrganization: { name: 'Brand' }, jobPostingInfo: { externalUrl: workdayUrl, jobDescription: 'Own Workday text' } } };
    const context = { externalId: 'Advisor_R1', url: workdayUrl, observedAt: at, config: { origin: 'https://brand.myworkdayjobs.com', site: 'External' } };
    expect(recoverRetainedPublication('workday', raw, context)).toMatchObject({ status: 'RECOVERABLE', job: { postedAt: undefined } });
    expect(recoverRetainedPublication('workday', { ...raw, detail: { ...raw.detail, jobPostingInfo: { ...raw.detail.jobPostingInfo, startDate: '2024-02-15' } } }, context))
      .toMatchObject({ status: 'RECOVERABLE', job: { postedAt: new Date('2024-02-15T00:00:00Z') } });
    raw.detail.jobPostingInfo.externalUrl = 'https://brand.myworkdayjobs.com/External/job/Paris/Other_R2';
    expect(recoverRetainedPublication('workday', raw, context)).toMatchObject({ reason: 'DETAIL_IDENTITY_MISMATCH' });
  });
});

describe('retained detail-page evidence', () => {
  const cases = [
    { kind: 'icims', url: 'https://brand.icims.com/jobs/42/advisor/job?in_iframe=1', origin: 'https://brand.icims.com', extra: {} },
    { kind: 'altamira', url: 'https://careers.example/jobs/job-details?JobID=42&Team=81', origin: 'https://careers.example', extra: { team: '81' } },
  ];
  for (const c of cases) {
    const node = { '@type': 'JobPosting', title: 'Own title', description: '<p>Own detail content</p>', url: c.url, datePosted: '2024-02-15' };
    const raw = { source: c.kind, ...c.extra, postingEvidence: { pageUrl: c.url, htmlSha256: 'a'.repeat(64), jobPostingCount: 1, jobPosting: node } };
    const readDetail = (input: unknown, extra = {}) => recoverRetainedPublication(c.kind, input, { externalId: '42', url: c.url, observedAt: at, config: { origin: c.origin }, ...extra });
    it(`recovers ${c.kind} from its retained page and native ID without fabricating HTML`, () => {
      expect(readDetail(raw)).toMatchObject({ status: 'RECOVERABLE', job: { title: 'Own title', description: 'Own detail content', externalId: '42', url: c.url, raw } });
      expect(readDetail({ ...raw, postingEvidence: { ...raw.postingEvidence, jobPosting: { ...node, url: undefined } } })).toMatchObject({ status: 'RECOVERABLE' });
    });
    it.each([
      { jobPostingCount: 2 }, { jobPosting: null }, { htmlSha256: 'invalid' }, { geographyConflict: true }, { geographyConflict: 'true' },
      { jobPosting: { ...node, '@type': 'WebPage' } },
    ])(`refuses unusable ${c.kind} evidence: %s`, invalid => {
      expect(readDetail({ ...raw, postingEvidence: { ...raw.postingEvidence, ...invalid } })).toMatchObject({ status: 'RECOLLECT_OR_REVIEW', reason: 'DETAIL_EVIDENCE_UNUSABLE' });
    });
    it(`binds ${c.kind} evidence to the recorded page, tenant and native ID`, () => {
      expect(readDetail(raw, { externalId: '43' })).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
      expect(readDetail(raw, { config: { origin: 'https://another-tenant.example' } })).toMatchObject({ reason: 'DETAIL_IDENTITY_MISMATCH' });
      for (const otherUrl of [c.url.replace('42', '43'), c.url.replace(c.origin, 'https://another.example')]) {
        expect(readDetail({ ...raw, postingEvidence: { ...raw.postingEvidence, pageUrl: otherUrl } })).toMatchObject({ reason: 'DETAIL_IDENTITY_MISMATCH' });
        expect(readDetail({ ...raw, postingEvidence: { ...raw.postingEvidence, jobPosting: { ...node, url: otherUrl } } })).toMatchObject({ reason: 'DETAIL_IDENTITY_MISMATCH' });
      }
    });
    if (c.kind === 'altamira') it('binds the Altamira team and rejects duplicate identity parameters', () => {
      expect(readDetail({ ...raw, team: '82' })).toMatchObject({ reason: 'DETAIL_IDENTITY_MISMATCH' });
      expect(readDetail({ ...raw, postingEvidence: { ...raw.postingEvidence, jobPosting: { ...node, url: c.url + '&JobID=43' } } })).toMatchObject({ reason: 'DETAIL_IDENTITY_MISMATCH' });
    });
  }
  it('recovers Radancy with the existing generic collector URL identity', () => {
    const raw = { '@type': ['JobPosting'], title: 'Own Radancy title', description: 'Own text', url };
    const context = { externalId: createHash('sha1').update(url).digest('hex'), url, observedAt: at, config: {} };
    expect(recoverRetainedPublication('radancy', raw, context)).toMatchObject({ status: 'RECOVERABLE', job: { raw } });
    expect(recoverRetainedPublication('radancy', { ...raw, url: 'https://other.example/job' }, context)).toMatchObject({ reason: 'IDENTITY_MISMATCH' });
  });
});
