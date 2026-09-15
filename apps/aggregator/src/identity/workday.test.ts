import { describe, expect, it } from 'vitest';
import { workdayRequisitionIdentity } from './workday.js';
import { blockingKey, publicationIdentityProof, provenPublicationGroup } from '../dedup/match.js';
import { workdayPublication } from '../test/fixtures/workdayPublication.js';

const a = workdayPublication('direct'), b = workdayPublication('board', 'Group', 'JR123', 'Advisor_JR123-1');
const altered = (change: (job: ReturnType<typeof workdayPublication>) => void) => {
  const job = structuredClone(b); change(job); return job;
};

describe('native Workday requisitions across career sites', () => {
  it('binds the native requisition to its own listing, posting and site before grouping', () => {
    expect(workdayRequisitionIdentity(a)).toEqual({ tenant: 'workday:employer.wd3.myworkdayjobs.com', requisition: 'JR123' });
    expect(publicationIdentityProof(a, b)).toMatchObject({ rule: 'QUALIFIED_REQUISITION_ID', paths: ['/detail/jobPostingInfo/jobReqId', '/detail/jobPostingInfo/jobReqId'] });
    expect(blockingKey(a)).toBe(blockingKey(b));
    expect(provenPublicationGroup([a,b])).toBe(true);
  });
  it.each([
    ['missing RAW', (j: any) => { j.raw = null; }],
    ['missing detail', (j: any) => { delete j.raw.detail; }],
    ['missing requisition', (j: any) => { delete j.raw.detail.jobPostingInfo.jobReqId; }],
    ['numeric requisition', (j: any) => { j.raw.detail.jobPostingInfo.jobReqId = 123; }],
    ['whitespace requisition', (j: any) => { j.raw.detail.jobPostingInfo.jobReqId = 'JR123 '; }],
    ['missing posting', (j: any) => { delete j.raw.detail.jobPostingInfo.jobPostingId; }],
    ['different posting', (j: any) => { j.raw.detail.jobPostingInfo.jobPostingId = 'Other'; }],
    ['different site', (j: any) => { j.raw.detail.jobPostingInfo.jobPostingSiteId = 'Other'; }],
    ['missing site', (j: any) => { delete j.raw.detail.jobPostingInfo.jobPostingSiteId; }],
    ['different listing', (j: any) => { j.raw.externalPath = '/job/ROME/Advisor_JR123-1'; }],
    ['different stored URL', (j: any) => { j.url = j.url.replace('/Group/', '/Other/'); }],
    ['foreign detail tenant', (j: any) => { j.raw.detail.jobPostingInfo.externalUrl = j.url.replace('employer.', 'another.'); }],
    ['similar-job detail', (j: any) => { j.raw.similarJobs = [j.raw.detail]; delete j.raw.detail; }],
  ])('refuses %s without guessing from the URL suffix', (_name, change) => {
    const wrong = altered(change);
    expect(workdayRequisitionIdentity(wrong)).toBeUndefined();
    expect(publicationIdentityProof(a,wrong)).toBeNull();
    expect(blockingKey(a)).not.toBe(blockingKey(wrong));
    expect(provenPublicationGroup([a,b,wrong])).toBe(false);
  });
  it('keeps different requisitions, tenants and IDs from the same feed separate', () => {
    const otherTenant = altered(j => { j.url = j.url.replace('employer.', 'another.'); (j.raw as any).detail.jobPostingInfo.externalUrl = j.url; });
    for (const job of [workdayPublication('board','Group','JR124'),otherTenant,{...b,sourceKey:a.sourceKey}]) {
      expect(publicationIdentityProof(a,job)).toBeNull();
    }
  });
  it.each(['http://employer.wd3.myworkdayjobs.com','https://careers.example','https://employer.wd3.myworkdayjobs.com.example'])('does not qualify a custom, insecure or lookalike host %s', origin => {
    const wrong = altered(j => { j.url = j.url.replace('https://employer.wd3.myworkdayjobs.com',origin); (j.raw as any).detail.jobPostingInfo.externalUrl=j.url; });
    expect(workdayRequisitionIdentity(wrong)).toBeUndefined();
  });
  it('does not renumber existing Oracle and JobAffinity lookup keys when the reader changes', () => {
    expect(blockingKey({...a,url:'https://jobaffinity.fr/apply/abcdefghij'})).toBe(JSON.stringify(['application','posting-identity-20260915-v1','jobaffinity:jobaffinity.fr','abcdefghij']));
    expect(blockingKey({...a,url:'https://tenant.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/123'})).toBe(JSON.stringify(['application','posting-identity-20260915-v1','oraclehcm:tenant.oraclecloud.com:CX','123']));
  });
});
