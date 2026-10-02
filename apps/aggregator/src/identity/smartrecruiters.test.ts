import { describe, expect, it } from 'vitest';
import { smartRecruitersApplyIdentity, smartRecruitersPublicationIdentity } from './smartrecruiters.js';
import { blockingKey, provenPublicationGroup, publicationIdentityProof, type NativePublication } from '../dedup/match.js';

// Formes relues sur la production le 02/10/2026 : Kiabi sur SmartRecruiters, et sa fiche Welcome to the Jungle.
const native = (): NativePublication => ({ sourceKey: 'kiabi', externalId: '744000142863605',
  url: 'https://jobs.smartrecruiters.com/kiabi/744000142863605', raw: {
    id: '744000142863605', ref: 'https://api.smartrecruiters.com/v1/companies/kiabi/postings/744000142863605', name: 'CONSEILLER(E) DE MODE' } });
const board = (): NativePublication => ({ sourceKey: 'wttj-sector', externalId: '8d148846-1b59-4e6b-8c07-787d5855fc7f',
  url: 'https://www.welcometothejungle.com/fr/companies/kiabi/jobs/conseiller-e-de-mode_saint-jean-du-falga_KIABI_P0pLDll', raw: {
    name: 'CONSEILLER(E) DE MODE', slug: 'conseiller-e-de-mode_saint-jean-du-falga_KIABI_P0pLDll', reference: '333c308a-e4cb-4ae9-91a6-2569352b1eb6',
    detail: { apply_url: 'https://jobs.smartrecruiters.com/KIABI/744000142863605-conseiller-e-de-mode-h-f-x?oga=true&sid=9fa97eed' } } });

describe('SmartRecruiters publication read at the publisher and cited by a job board (R-143 §4)', () => {
  it('proves the job board copy against the publisher own publication', () => {
    expect(smartRecruitersPublicationIdentity(native())).toEqual({ tenant: 'smartrecruiters:kiabi', requisition: '744000142863605' });
    expect(smartRecruitersPublicationIdentity(board())).toEqual({ tenant: 'smartrecruiters:kiabi', requisition: '744000142863605', delegated: true });
    expect(publicationIdentityProof(native(), board())).toMatchObject({ rule: 'QUALIFIED_FEED_POSTING_ID', paths: ['/ref', '/detail/apply_url'] });
    expect(blockingKey(native())).toBe(blockingKey(board()));
  });
  it('never lets two citations prove each other', () => {
    const other = { ...board(), sourceKey: 'wttj' };
    expect(publicationIdentityProof(board(), other)).toBeNull();
    expect(provenPublicationGroup([native(), board(), other])).toBe(false);
  });
  it.each([
    ['another posting', (_n: any, b: any) => { b.raw.detail.apply_url = b.raw.detail.apply_url.replace('744000142863605', '744000142863606'); }],
    ['another company', (_n: any, b: any) => { b.raw.detail.apply_url = b.raw.detail.apply_url.replace('KIABI', 'KIABI-ITALIA'); }],
    ['a careers page, not a posting', (_n: any, b: any) => { b.raw.detail.apply_url = 'https://jobs.smartrecruiters.com/KIABI'; }],
    ['a lookalike host', (_n: any, b: any) => { b.raw.detail.apply_url = b.raw.detail.apply_url.replace('jobs.smartrecruiters.com', 'jobs.smartrecruiters.com.example'); }],
    ['a citation outside the job board page', (_n: any, b: any) => { b.url = 'https://board.example/jobs/42'; }],
    ['a publisher id that disagrees with its reference', (n: any) => { n.raw.id = '744000142863606'; }],
    ['a written id that disagrees with its reference', (n: any) => { n.externalId = '744000142863606'; }],
    ['a reference on another host', (n: any) => { n.raw.ref = n.raw.ref.replace('api.smartrecruiters.com', 'api.example.com'); n.raw.detail = undefined; }],
  ])('refuses %s', (_name, change) => {
    const left = native(), right = board();
    change(left, right);
    expect(publicationIdentityProof(left, right)).toBeNull();
  });
  it('reads the apply link strictly', () => {
    expect(smartRecruitersApplyIdentity('https://jobs.smartrecruiters.com/HMGroup/744000100000001')).toEqual({ company: 'hmgroup', posting: '744000100000001' });
    expect(smartRecruitersApplyIdentity('http://jobs.smartrecruiters.com/HMGroup/744000100000001')).toBeUndefined();
    expect(smartRecruitersApplyIdentity('https://jobs.smartrecruiters.com/HMGroup/744000100000001/apply#x')).toBeUndefined();
  });
});
