import { describe, expect, it } from 'vitest';
import { validatePostingMerges, type PostingMerge } from './postingRepair.js';

function fixture() {
  const source = (id: string) => ({ id, sourceKey: id, externalId: id, url: `https://careers.example/${id}`,
    raw: { issuer: 'https://careers.example', requisition: '42' } });
  const jobs = [
    { id: 'a', companyId: 'company', mergedIntoId: null, source: 'LEVER', url: 'https://careers.example/a', sources: [source('one')] },
    { id: 'b', companyId: 'company', mergedIntoId: null, source: 'GENERIC_JSONLD', url: 'https://careers.example/b', sources: [source('two')] },
  ];
  const decision: PostingMerge = { fromId: 'a', toId: 'b', issuer: 'https://careers.example', postingId: '42',
    witnesses: ['one','two'].map(sourceId => ({ sourceId, issuerPath: ['issuer'], postingIdPath: ['requisition'] })) };
  const check = () => validatePostingMerges(jobs as unknown as Parameters<typeof validatePostingMerges>[0], [decision], new Map());
  return { jobs, decision, source, check };
}

describe('reviewed RAW identity proofs', () => {
  it('accepts the same native issuer and posting ID across different collector families', () => {
    expect(fixture().check).not.toThrow();
  });
  it('requires proof for every member, including publications inside an existing group', () => {
    const { jobs, decision, source, check } = fixture();
    jobs[0].sources.push(source('three'));
    expect(check).toThrow('Every publication');
    decision.witnesses.push({ sourceId: 'three', issuerPath: ['issuer'], postingIdPath: ['requisition'] });
    expect(check).not.toThrow();
    jobs[0].sources[1].raw.requisition = '43';
    expect(check).toThrow('Invalid posting RAW witness');
  });
  it('does not allow duplicate witnesses to stand in for a missing publication', () => {
    const { decision, check } = fixture();
    decision.witnesses[1] = decision.witnesses[0];
    expect(check).toThrow('Every publication');
  });
});
