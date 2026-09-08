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
