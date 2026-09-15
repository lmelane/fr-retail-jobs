import { describe, it, expect, vi, afterEach } from 'vitest';
import { recoverRetainedPublication } from './recovery.js';
import { evidenceHash } from '../lib/evidenceHash.js';

const url = 'https://jobs.example.com/role-1';
const at = new Date('2024-02-20T12:00:00Z');
const lever = { id: 'role-1', text: 'Client Advisor', hostedUrl: url, descriptionPlain: 'Native role description', country: 'US' };
const read = (raw: unknown, extra = {}) => recoverRetainedPublication('lever', raw, { externalId: 'role-1', url, observedAt: at, config: {}, ...extra });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('retained publication recovery', () => {
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
