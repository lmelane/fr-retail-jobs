import { describe, expect, it } from 'vitest';
import { mergeWorkdayDetail, workdayDetailMatchesListing } from './workday.js';
import { recoverRetainedPublication } from '../../publication/recovery.js';

const origin = 'https://richemont.wd3.myworkdayjobs.com';
const path = '/job/PARIS/Client-Advisor_JR123';
const url = `${origin}/Richemont${path}`;
const raw = { title: 'Client Advisor', externalPath: path };
const listing = { externalId: 'Client-Advisor_JR123', title: raw.title, url, raw };
const detail = { jobPostingInfo: { externalUrl: `${origin}/richemont${path}`, jobDescription: '<p>Own duties</p>', logoImage: { alt: 'Cartier' }, endDate: '2026-10-01' } };
const context = { externalId: listing.externalId, url, observedAt: new Date('2026-09-15T00:00:00Z'), config: { origin, site: 'Richemont' } };

describe('Workday native detail identity', () => {
  it('accepts only a site-segment case difference and retains the original URL and RAW', () => {
    expect(workdayDetailMatchesListing(listing, detail)).toBe(true);
    const merged = mergeWorkdayDetail(listing, detail);
    expect(merged).toMatchObject({ url, externalId: listing.externalId, company: 'Cartier', description: 'Own duties', raw: { ...raw, detail } });
    expect(merged.publicationHold).toBeUndefined();
    expect(recoverRetainedPublication('workday', { ...raw, detail }, context)).toMatchObject({ status: 'RECOVERABLE', job: { url, raw: { ...raw, detail } } });
  });
  it('accepts the independently observed Theory spelling without special tenant entries', () => {
    const base = 'https://fastretailing.wd3.myworkdayjobs.com';
    expect(workdayDetailMatchesListing({ ...listing, url: `${base}/eu_Theory${path}` }, { jobPostingInfo: { externalUrl: `${base}/EU_Theory${path}` } })).toBe(true);
  });
  it.each([
    undefined, '', `${origin}/Other${path}`, `https://another.wd3.myworkdayjobs.com/richemont${path}`,
    `${origin}/richemont/job/paris/Client-Advisor_JR123`, `${origin}/richemont/job/PARIS/client-advisor_JR123`,
    `${origin}/richemont/job/PARIS/Other_JR123`, `${origin}/richemont${path}?id=another`, `${origin}/richemont${path}#another`,
    `https://user:secret@richemont.wd3.myworkdayjobs.com/richemont${path}`, `http://richemont.wd3.myworkdayjobs.com/richemont${path}`,
    `https://richemont.wd3.myworkdayjobs.com:8443/richemont${path}`, `${origin}/richemont%2fOther${path}`,
  ])('holds a missing or conflicting detail before merging its fields (%s)', externalUrl => {
    const wrong = { ...detail, jobPostingInfo: { ...detail.jobPostingInfo, externalUrl } };
    expect(workdayDetailMatchesListing(listing, wrong)).toBe(false);
    const merged = mergeWorkdayDetail(listing, wrong);
    expect(merged.publicationHold).toBe('WORKDAY_DETAIL_IDENTITY_MISMATCH');
    expect(merged.raw).toEqual({ ...raw, detail: wrong });
    expect(merged.description).toBeUndefined();
    expect(merged.company).toBeUndefined();
    expect(merged.validThrough).toBeUndefined();
    expect(recoverRetainedPublication('workday', { ...raw, detail: wrong }, context)).toMatchObject({ reason: 'DETAIL_IDENTITY_MISMATCH' });
  });
  it.each(['/job/PARIS/Client-Advisor_JR123/', '/job//Client-Advisor_JR123', '/job/../Client-Advisor_JR123', '/job/PARIS%2fOther/Client-Advisor_JR123', '/job/PARIS/Client-Advisor_JR123?x=y', '/job/PARIS\\Other/Client-Advisor_JR123'])('refuses an ambiguous native path (%s)', externalPath => {
    expect(workdayDetailMatchesListing({ ...listing, raw: { ...raw, externalPath } }, detail)).toBe(false);
  });
  it('binds the source-generated listing path, external ID and site before accepting the detail', () => {
    expect(workdayDetailMatchesListing({ ...listing, externalId: 'Other' }, detail)).toBe(false);
    expect(workdayDetailMatchesListing({ ...listing, raw: { ...raw, externalPath: '/job/OTHER/Client-Advisor_JR123' } }, detail)).toBe(false);
    expect(recoverRetainedPublication('workday', { ...raw, detail }, { ...context, config: { origin, site: 'Other' } })).toMatchObject({ status: 'RECOLLECT_OR_REVIEW' });
  });
  it('does not generalize case folding to custom domains or lookalike Workday hosts', () => {
    for (const base of ['https://careers.example', 'https://richemont.wd3.myworkdayjobs.com.example', 'https://richemont.myworkdayjobs.com']) {
      const job = { ...listing, url: `${base}/Richemont${path}` };
      expect(workdayDetailMatchesListing(job, { jobPostingInfo: { externalUrl: job.url } })).toBe(true);
      expect(workdayDetailMatchesListing(job, { jobPostingInfo: { externalUrl: `${base}/richemont${path}` } })).toBe(false);
    }
  });
});
