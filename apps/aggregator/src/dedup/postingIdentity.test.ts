import { describe, expect, it } from 'vitest';
import { hasRequisitionConflict, postingIdentity } from './postingIdentity.js';

const root = 'https://eljs.fa.us2.oraclecloud.com/hcmUI/CandidateExperience';
describe('Oracle requisition identity — production witnesses 63762/63763', () => {
  it('ignores locale and tracking, retains tenant and requisition', () => {
    expect(postingIdentity(`${root}/en/sites/CX/job/63762?utm_source=lvmh`))
      .toEqual(postingIdentity(`${root}/fr/sites/CX/job/63762/`));
    expect(hasRequisitionConflict([`${root}/en/sites/CX/job/63762`, `${root}/fr/sites/CX/job/63763`])).toBe(true);
  });
  it('does not infer identity from unrelated hosts, malformed URLs or generic paths', () => {
    expect(postingIdentity('https://oraclecloud.com.evil.example/hcmUI/CandidateExperience/en/sites/CX/job/63762')).toBeUndefined();
    expect(postingIdentity('not a URL')).toBeUndefined();
    expect(postingIdentity('https://eljs.fa.us2.oraclecloud.com/job/63762')).toBeUndefined();
    expect(hasRequisitionConflict([`${root}/en/sites/CX/job/63762`, `${root}/en/sites/CX/job/63762`])).toBe(false);
  });
});

describe('JobAffinity cross-board application identity', () => {
  const a = 'https://jobaffinity.fr/apply/v9f3i6k3c5c8z2z9ly';
  it('keeps tracking-independent identity and separates different application tokens', () => {
    expect(postingIdentity(a + '?src=Site%20Blackstore')).toEqual(postingIdentity(a + '?src=Intersport'));
    expect(hasRequisitionConflict([a, 'https://jobaffinity.fr/apply/rpp3vwzazs9dmsf9f9'])).toBe(true);
    expect(postingIdentity('https://jobaffinity.fr.evil.example/apply/v9f3i6k3c5c8z2z9ly')).toBeUndefined();
  });
});
