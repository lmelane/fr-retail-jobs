import { describe, expect, it } from 'vitest';
import { teamtailorPublicationIdentity } from './teamtailor.js';
import { blockingKey, publicationIdentityProof, provenPublicationGroup } from '../dedup/match.js';
import { teamtailorPublication } from '../test/fixtures/teamtailorPublication.js';
const a=teamtailorPublication('native'),b=teamtailorPublication('custom','https://careers.brand.example');

describe('Teamtailor declared publisher aliases',()=>{
  it('corroborates the UUID, posting ID and issuer across native and custom domains',()=>{
    expect(publicationIdentityProof(a,b)).toMatchObject({rule:'QUALIFIED_FEED_POSTING_ID',identity:{tenant:'teamtailor:https://careers.brand.example',requisition:'8360799:68264a3e-8a35-40a7-9a4a-0830b00e87a8'}});
    expect(blockingKey(a)).toBe(blockingKey(b));
    expect(teamtailorPublicationIdentity(a)).toEqual(teamtailorPublicationIdentity(b));
  });
  it.each([
    ['missing RAW',(j:any)=>{j.raw=null;}],
    ['unbound UUID',(j:any)=>{j.raw.id='aaa64a3e-8a35-40a7-9a4a-0830b00e87a8';}],
    ['unbound URL',(j:any)=>{j.raw.url=j.raw.url.replace('/jobs/','/other/');}],
    ['unbound posting ID',(j:any)=>{j.raw._jobposting.identifier.value=8360800;}],
    ['missing posting ID',(j:any)=>{delete j.raw._jobposting.identifier;}],
    ['malformed UUID',(j:any)=>{j.externalId=j.raw.id='not-a-uuid';}],
    ['unsafe numeric ID',(j:any)=>{j.raw._jobposting.identifier.value=9007199254740992;}],
    ['generic page',(j:any)=>{j.url=j.raw.url='https://careers.brand.example/jobs';}],
    ['other page type',(j:any)=>{j.raw._jobposting['@type']='Article';}],
    ['missing issuer',(j:any)=>{delete j.raw._jobposting.hiringOrganization.sameAs;}],
    ['issuer path',(j:any)=>{j.raw._jobposting.hiringOrganization.sameAs+='/'+'careers';}],
    ['issuer query',(j:any)=>{j.raw._jobposting.hiringOrganization.sameAs+='?company=other';}],
    ['foreign custom origin',(j:any)=>{j.url=j.raw.url=j.url.replace('careers.brand.example','another.example');}],
    ['insecure URL',(j:any)=>{j.url=j.raw.url=j.url.replace('https:','http:');}],
    ['lookalike vendor',(j:any)=>{j.url=j.raw.url=j.url.replace('careers.brand.example','brand.teamtailor.com.example');}],
    ['encoded path separator',(j:any)=>{j.url=j.raw.url=j.url.replace('-client-advisor','-%2Fclient-advisor');}],
  ])('refuses %s',(_name,change)=>{
    const wrong=structuredClone(b);change(wrong);
    expect(teamtailorPublicationIdentity(wrong)).toBeUndefined();
    expect(publicationIdentityProof(a,wrong)).toBeNull();
    expect(blockingKey(a)).not.toBe(blockingKey(wrong));
    expect(provenPublicationGroup([a,b,wrong])).toBe(false);
  });
  it('keeps different UUIDs, posting IDs, publishers and same-source IDs distinct',()=>{
    const otherPublisher=structuredClone(b);otherPublisher.url=otherPublisher.url.replace('brand.example','other.example');(otherPublisher.raw as any).url=otherPublisher.url;(otherPublisher.raw as any)._jobposting.hiringOrganization.sameAs='https://careers.other.example';
    for(const other of [teamtailorPublication('other','https://careers.brand.example','aaa64a3e-8a35-40a7-9a4a-0830b00e87a8'),teamtailorPublication('other','https://careers.brand.example',a.externalId,8360800),otherPublisher,{...b,sourceKey:a.sourceKey,externalId:'aaa64a3e-8a35-40a7-9a4a-0830b00e87a8'}])expect(publicationIdentityProof(a,other)).toBeNull();
  });
});
