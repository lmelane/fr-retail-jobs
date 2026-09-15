import { describe, expect, it } from 'vitest';
import { blockingKey, publicationIdentityProof, provenPublicationGroup, type CandidateJob } from './match.js';

const root = 'https://eljs.fa.us2.oraclecloud.com/hcmUI/CandidateExperience';
const candidate: CandidateJob = { company: 'Tiffany & Co.', sourceKey: 'lvmh', externalId: 'one', sourceTier: 'GROUP_OFFICIAL',
  title: 'Sales Advisor', city: 'Wailea', url: `${root}/en/sites/CX/job/63681`, raw: { source: 'oraclehcm', site: 'CX', list: { Id: '63681' } } };

describe('publication identity proofs', () => {
  it('preserves a native publication through relocation, renaming and URL repair', () => {
    expect(publicationIdentityProof(candidate, { ...candidate, url: 'https://example.com/new' })?.rule).toBe('SAME_NATIVE_PUBLICATION');
  });
  it('groups locale and tracking variants of a qualified application', () => {
    const translation = { ...candidate, sourceKey: 'tiffany-oracle', externalId: '63681', title: 'Conseiller de vente', city: 'Another place',
      url: `${root}/fr/sites/CX/job/63681/?utm_source=group` };
    expect(publicationIdentityProof(candidate, translation)).toMatchObject({ rule: 'QUALIFIED_APPLICATION_ID', identity: { requisition: '63681' } });
    expect(blockingKey(candidate)).toBe(blockingKey(translation));
  });
  it('never equates similar roles or identical titles without native identity proof', () => {
    for (const title of ['Sales Advisor', 'Beauty Advisor', 'Conseiller de vente']) {
      const other = { ...candidate, sourceKey: 'board', externalId: 'two', title, url: 'https://board.example/job/two' };
      expect(publicationIdentityProof(candidate, other)).toBeNull();
      expect(blockingKey(candidate)).not.toBe(blockingKey(other));
    }
  });
  it('keeps different requisitions, tenants, sites and same-feed IDs separate', () => {
    for (const other of [
      { ...candidate, sourceKey: 'board', url: `${root}/en/sites/CX/job/63683` },
      { ...candidate, sourceKey: 'board', url: candidate.url.replace('eljs.', 'other.') },
      { ...candidate, sourceKey: 'board', url: candidate.url.replace('/CX/', '/OTHER/') },
      { ...candidate, externalId: 'another-feed-id' },
    ]) expect(publicationIdentityProof(candidate, other)).toBeNull();
  });
  it('does not use a generic shared URL as proof', () => {
    const a = { ...candidate, url: 'https://company.example/careers' };
    const b = { ...a, sourceKey: 'board' };
    expect(publicationIdentityProof(a, b)).toBeNull();
    expect(blockingKey(a)).not.toBe(blockingKey(b));
  });
  it('requires corroboration in this publication RAW, beyond a matching stored URL', () => {
    for (const raw of [undefined, null, {}, { source: 'oraclehcm', site: 'CX', list: { Id: '63683' } },
      { source: 'oraclehcm', site: 'CX', list: { Id: '63681' }, detail: { Id: '63683' } },
      { source: 'oraclehcm', site: 'CX', list: { Id: '63681' }, detail: { Id: '63683' }, atsId: '63681', link: candidate.url },
      { similarJobs: [{ atsId: '63681', link: candidate.url }] }]) {
      expect(publicationIdentityProof(candidate, { ...candidate, sourceKey: 'board', raw })).toBeNull();
    }
    expect(publicationIdentityProof(candidate, { ...candidate, sourceKey: 'lvmh-copy', raw: { atsId: '63681', link: candidate.url } })?.paths).toEqual(['/list/Id','/link']);
  });
  it('rejects groups containing an unproven intermediate publication', () => {
    const same = { ...candidate, sourceKey: 'direct' };
    const unknown = { ...candidate, sourceKey: 'unknown', url: 'https://board.example/two' };
    for (const group of [[candidate,same,unknown], [unknown,candidate,same], [same,unknown,candidate]]) expect(provenPublicationGroup(group)).toBe(false);
    expect(provenPublicationGroup([candidate,same])).toBe(true);
  });
});
