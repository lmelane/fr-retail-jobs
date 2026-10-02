import { describe, expect, it } from 'vitest';
import { teamtailorDelegatedIdentity, teamtailorPublicationIdentity } from './teamtailor.js';
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
    ['insecure URL',(j:any)=>{j.url=j.raw.url=j.url.replace('https:','http:');}],
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
  // R-143 §4 (D-513) : avant le 02/10/2026, une fiche hébergée hors de l'origine de l'émetteur était refusée, et les
  // 107 offres de Maison 123 et d'Undiz publiées aussi par le site du groupe Etam restaient en double.
  it.each([
    ['site du groupe',(j:any)=>{j.url=j.raw.url=j.url.replace('careers.brand.example','career.group.example');}],
    ['hôte qui imite le fournisseur',(j:any)=>{j.url=j.raw.url=j.url.replace('careers.brand.example','brand.teamtailor.com.example');}],
  ])('accepts a %s publication only against the issuer own publication',(_name,change)=>{
    const hosted=structuredClone(b);hosted.sourceKey='group';change(hosted);
    expect(teamtailorPublicationIdentity(hosted)).toBeUndefined();
    expect(teamtailorDelegatedIdentity(hosted)).toMatchObject({tenant:'teamtailor:https://careers.brand.example',delegated:true});
    expect(publicationIdentityProof(a,hosted)).toMatchObject({rule:'QUALIFIED_FEED_POSTING_ID',paths:['/_jobposting/identifier/value','/_jobposting/hiringOrganization/sameAs']});
    expect(publicationIdentityProof(b,hosted)?.identity.requisition).toBe('8360799:68264a3e-8a35-40a7-9a4a-0830b00e87a8');
    expect(blockingKey(hosted)).toBe(blockingKey(a));
    // Deux copies hébergées ne se prouvent jamais l'une l'autre.
    const other=structuredClone(hosted);other.sourceKey='other-group';other.url=(other.raw as any).url=other.url.replace(/https:\/\/[^/]+/,'https://career.other-group.example');
    expect(publicationIdentityProof(hosted,other)).toBeNull();
    expect(provenPublicationGroup([hosted,other])).toBe(false);
    expect(provenPublicationGroup([a,hosted,other])).toBe(false);
  });
  it.each([
    ['another issuer',(j:any)=>{j.raw._jobposting.hiringOrganization.sameAs='https://careers.other.example';}],
    ['another UUID',(j:any)=>{j.externalId=j.raw.id='aaa64a3e-8a35-40a7-9a4a-0830b00e87a8';}],
    ['another posting ID',(j:any)=>{j.raw._jobposting.identifier.value=8360800;j.url=j.raw.url=j.url.replace('8360799','8360800');}],
    ['a path that is not the posting',(j:any)=>{j.url=j.raw.url='https://career.group.example/jobs';}],
    ['an unbound URL',(j:any)=>{j.raw.url=j.raw.url.replace('/jobs/','/other/');}],
  ])('refuses a hosted publication with %s',(_name,change)=>{
    const hosted=structuredClone(b);hosted.sourceKey='group';hosted.url=(hosted.raw as any).url=hosted.url.replace('careers.brand.example','career.group.example');change(hosted);
    expect(publicationIdentityProof(a,hosted)).toBeNull();
    expect(publicationIdentityProof(b,hosted)).toBeNull();
  });
});
