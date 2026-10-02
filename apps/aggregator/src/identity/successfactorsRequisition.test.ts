import { describe, expect, it } from 'vitest';
import { declaredJobIds, sapRequisitionLink, successfactorsRequisitionIdentity } from './successfactorsRequisition.js';
import { blockingKey, provenPublicationGroup, publicationIdentityProof, type NativePublication } from '../dedup/match.js';

// Formes relues sur la production le 02/10/2026 : un hit LVMH (Sephora US) et sa publication RMK sur jobs.sephora.com.
const link = 'https://career55.sapsf.eu/sfcareer/jobreqcareer?company=SephoraUS&jobId=295010';
const lvmh = (): NativePublication => ({ sourceKey: 'lvmh', externalId: '295010', url: link, raw: {
  source: 'jobhub', dataProvider: 'sephora-external', maison: 'Sephora', name: 'Seasonal Associate', link, atsId: '295010', objectID: '295010',
  description: 'Seasonal Associate', profile: 'Job ID: 295010\nStore Name/Number: TX-Moore Plaza (1954)\nAddress: 5425 S Padre Island Dr.',
} });
const rmkUrl = 'https://jobs.sephora.com/job/Corpus-Christi-Seasonal-Associate-TX-78411/1158400001/';
const rmk = (): NativePublication => ({ sourceKey: 'sephora-france', externalId: '1158400001', url: rmkUrl, raw: {
  id: '1158400001', source: 'successfactors', path: '/job/Corpus-Christi-Seasonal-Associate-TX-78411/1158400001/',
  successfactorsDetail: { title: 'Seasonal Associate', company: 'Sephora',
    description: 'Job ID: 295010\nStore Name/Number: TX-Moore Plaza (1954)\nAddress: 5425 S Padre Island Dr.' },
} });

describe('SAP SuccessFactors requisition published by a group feed and by the Maison RMK site (R-143 §4)', () => {
  it('reads the requisition on both sides and proves the same opportunity', () => {
    expect(successfactorsRequisitionIdentity(lvmh())).toEqual({ tenant: 'successfactors:career55.sapsf.eu:SephoraUS', requisition: '295010' });
    expect(successfactorsRequisitionIdentity(rmk())).toEqual({ tenant: 'successfactors:career55.sapsf.eu:SephoraUS', requisition: '295010' });
    expect(publicationIdentityProof(lvmh(), rmk())).toMatchObject({ rule: 'QUALIFIED_REQUISITION_ID', paths: ['/atsId', '/successfactorsDetail/description'] });
    expect(blockingKey(lvmh())).toBe(blockingKey(rmk()));
    expect(provenPublicationGroup([lvmh(), rmk()])).toBe(true);
  });
  it('accepts a group feed whose text declares no Job ID (the link and atsId still agree)', () => {
    const hit = lvmh(); (hit.raw as any).profile = 'Da Sephora vogliamo ispirare i nostri clienti';
    expect(publicationIdentityProof(hit, rmk())?.rule).toBe('QUALIFIED_REQUISITION_ID');
  });
  it.each([
    ['another requisition on the RMK page', (_l: any, r: any) => { r.raw.successfactorsDetail.description = 'Job ID: 295011'; }],
    ['two requisitions on the RMK page', (_l: any, r: any) => { r.raw.successfactorsDetail.description += '\nJob ID: 295011'; }],
    ['no requisition on the RMK page', (_l: any, r: any) => { r.raw.successfactorsDetail.description = 'Seasonal Associate'; }],
    ['an RMK site nobody reviewed', (_l: any, r: any) => { r.url = r.url.replace('jobs.sephora.com', 'careers.other-maison.com'); }],
    ['an RMK id not bound to its URL', (_l: any, r: any) => { r.raw.id = '1158400002'; }],
    ['an RMK URL that is not the posting', (_l: any, r: any) => { r.url = 'https://jobs.sephora.com/search/?q=295010'; }],
    ['an RMK capture of another reader', (_l: any, r: any) => { r.raw.source = 'generic-listing'; }],
    ['another SAP tenant', (l: any) => { l.url = l.raw.link = link.replace('SephoraUS', 'SephoraME'); }],
    ['an atsId that disagrees with the link', (l: any) => { l.raw.atsId = '295011'; }],
    ['a link the publication does not carry', (l: any) => { l.raw.link = 'https://www.lvmh.com/join-us'; }],
    ['a group text declaring another Job ID', (l: any) => { l.raw.profile = 'Job ID: 295011'; }],
    ['an extra parameter on the SAP link', (l: any) => { l.url = l.raw.link = `${link}&lang=en_US`; }],
    ['a plain HTTP SAP link', (l: any) => { l.url = l.raw.link = link.replace('https:', 'http:'); }],
    ['a lookalike SAP host', (l: any) => { l.url = l.raw.link = link.replace('career55.sapsf.eu', 'career55.sapsf.eu.example'); }],
  ])('refuses %s', (_name, change) => {
    const left = lvmh(), right = rmk();
    change(left, right);
    expect(publicationIdentityProof(left, right)).toBeNull();
    expect(provenPublicationGroup([left, right])).toBe(false);
  });
  it('never equates two publications of the same feed by requisition', () => {
    const other = { ...lvmh(), externalId: '295099' };
    expect(publicationIdentityProof(lvmh(), other)).toBeNull();
  });
  it('reads the declared Job ID lines exactly', () => {
    expect([...declaredJobIds('Job ID: 265816', 'x Job ID : 1 y', null)]).toEqual(['265816']);
    expect(declaredJobIds('Jobid 265816', 'Job IDs: 265816').size).toBe(0);
    expect(sapRequisitionLink('https://career55.sapsf.eu/sfcareer/jobreqcareer?jobId=265816&company=SephoraUS')).toEqual({ host: 'career55.sapsf.eu', company: 'SephoraUS', requisition: '265816' });
    expect(sapRequisitionLink('https://career55.sapsf.eu/sfcareer/jobreqcareer?company=SephoraUS&jobId=265816&jobId=1')).toBeUndefined();
  });
});
