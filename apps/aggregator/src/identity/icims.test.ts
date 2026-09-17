import { describe, expect, it } from 'vitest';
import { icimsDetailOrigins, icimsPostingURL, icimsPublicationIdentity, icimsDetailMatchesListing } from './icims.js';
import { publicationIdentityProof, blockingKey } from '../dedup/match.js';
import { recoverRetainedPublication } from '../publication/recovery.js';
import { icimsPublication } from '../test/fixtures/icimsPublication.js';

const origin = 'https://stores-brand.icims.com', config = { origin: 'https://hub-brand.icims.com', detailOrigins: [origin] };
const publication = () => icimsPublication('hub', origin, '?hub=15&in_iframe=1');
describe('iCIMS native detail identity and explicit regional scope', () => {
  it('binds hub and direct feeds to the same regional posting without changing their URLs', () => {
    const a = publication(), b = icimsPublication('direct');
    expect(icimsPublicationIdentity(a)).toEqual({ tenant: `icims:${origin}`, requisition: '42' });
    expect(publicationIdentityProof(a,b)).toMatchObject({ rule: 'QUALIFIED_APPLICATION_ID' });
    expect(blockingKey(a)).toBe(blockingKey(b));
    expect(icimsDetailMatchesListing(a,config)).toBe(true);
    expect(recoverRetainedPublication('icims', a.raw, { ...a, config, observedAt: new Date('2026-09-01') })).toMatchObject({ status: 'RECOVERABLE', job: { url: a.url, raw: a.raw } });
  });
  it('keeps regional portals distinct even when both are approved by one hub', () => {
    const a = publication(), b = icimsPublication('direct','https://other-brand.icims.com');
    expect(publicationIdentityProof(a,b)).toBeNull();
    expect(blockingKey(a)).not.toBe(blockingKey(b));
    expect(publicationIdentityProof(a,{...a,externalId:'43'})).toBeNull();
  });
  it('requires explicit scope and a native declared URL before joining independent feeds', () => {
    const a = publication();
    expect(icimsDetailMatchesListing(a,{origin:config.origin})).toBe(false);
    delete (a.raw.postingEvidence.jobPosting as any).url;
    expect(icimsDetailMatchesListing(a,config)).toBe(true);
    expect(icimsPublicationIdentity(a)).toBeUndefined();
    expect(publicationIdentityProof(a,icimsPublication('direct'))).toBeNull();
  });
  it.each([
    (p:any)=>{p.externalId='43';}, (p:any)=>{p.raw.reference='2026-43';},
    (p:any)=>{p.raw.postingEvidence.pageUrl=p.url.replace('/42/','/43/');},
    (p:any)=>{p.raw.postingEvidence.jobPosting.url=p.url.replace('/42/','/43/');},
    (p:any)=>{p.raw.postingEvidence.jobPosting.url=p.url.replace('stores-brand','another');},
    (p:any)=>{p.raw.postingEvidence.jobPosting.url=p.url.replace('client-advisor','different-posting');},
    (p:any)=>{p.raw.postingEvidence.jobPostingCount=2;}, (p:any)=>{p.raw.postingEvidence.htmlSha256='invalid';},
    (p:any)=>{p.raw.postingEvidence.geographyConflict=true;}, (p:any)=>{p.raw.postingEvidence.jobPosting['@type']='WebPage';},
  ])('rejects contradictory or unbound native evidence (%#)', mutate => {
    const p=publication();mutate(p);expect(icimsPublicationIdentity(p)).toBeUndefined();
    expect(icimsDetailMatchesListing(p,config)).toBe(false);
    expect(publicationIdentityProof(p,icimsPublication('direct'))).toBeNull();
  });
  it.each([
    'https://user:pass@stores-brand.icims.com/jobs/42/job', 'https://stores-brand.icims.com:444/jobs/42/job',
    'http://stores-brand.icims.com/jobs/42/job', 'https://stores-brand.icims.com.evil.example/jobs/42/job',
    'https://stores-brand.icims.com/jobs/42/job?jobId=43', 'https://stores-brand.icims.com/jobs/42/job?hub=1&hub=2',
    'https://stores-brand.icims.com/jobs/42/job#43', 'https://stores-brand.icims.com/jobs/42/../42/job',
    'https://stores-brand.icims.com/jobs/42/a%2fb/job', 'https://stores-brand.icims.com/jobs/42/%2e/job',
  ])('refuses unsafe or unqualified URL shapes: %s', url=>expect(icimsPostingURL(url)).toBeUndefined());
  it.each(['*.icims.com','https://brand.icims.com.evil.example','https://brand.icims.com/path','https://brand.icims.com?x=1',42,null])('refuses an unqualified detail origin (%s)', value=>{
    expect(()=>icimsDetailOrigins({...config,detailOrigins:[value]})).toThrow();
  });
});
