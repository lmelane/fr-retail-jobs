import { describe,it,expect } from 'vitest';
import { qualificationManifest, sectorTaxonomyHash, type SectorRule } from './qualify.js';
const concepts=[{code:'FASHION',slug:'fashion',definition:'Fashion'}];
const taxonomy=sectorTaxonomyHash(concepts);
const rule:SectorRule={canonicalKey:'MAISON',name:'Maison',domain:'maison.example',codes:['FASHION'],source:'https://maison.example/about',statement:'Reviewed clothing maker',checkedAt:'2026-01-01',validUntil:'2027-01-01'};
const employer={id:'id',canonicalKey:'MAISON',name:'Maison',domain:'maison.example',sectorCodes:[] as string[],sectorEvidence:[]};
const now=new Date('2026-09-24');
const plan=(e=employer,r=[rule],t=taxonomy) => qualificationManifest([e],concepts,r,t,now);
describe('one reviewed qualification per employer and evidence revision',()=>{
 it('keeps dated proof and deterministically reproduces zero changes after application',()=>{
   const first=plan();expect(first.manifest.companies).toHaveLength(1);
   const c=first.manifest.companies[0];
   expect(c.evidence[0].provenance).toMatchObject({taxonomyHash:taxonomy,model:null});
   expect(qualificationManifest([{...employer,sectorCodes:c.codes,sectorEvidence:c.evidence}],concepts,[rule],taxonomy,now).manifest.companies).toEqual([]);
 });
 it('abstains on unknown employers and never assigns a group activity to a subsidiary',()=>{
   expect(plan({...employer,canonicalKey:'SUBSIDIARY'}).abstentions[0].reason).toBe('NO_REVIEWED_EVIDENCE');
 });
 it('refuses conflicting identity, duplicate rules, changed taxonomy and expired evidence',()=>{
   expect(plan({...employer,domain:'other.example'}).abstentions[0].reason).toBe('IDENTITY_CHANGED');
   expect(plan(employer,[rule,rule]).abstentions[0].reason).toBe('AMBIGUOUS_RULE');
   expect(plan(employer,[rule],'changed').abstentions[0].reason).toBe('TAXONOMY_CHANGED');
   expect(plan(employer,[{...rule,validUntil:'2026-01-02'}]).abstentions[0].reason).toBe('EVIDENCE_EXPIRED');
 });
 it('does not erase previously reviewed memberships',()=>{
   const before={...employer,sectorCodes:['RETAIL'],sectorEvidence:[{code:'RETAIL',source:rule.source,statement:'shops',confidence:'HIGH',basis:'OFFICIAL_SOURCE',checkedAt:rule.checkedAt}]};
   const result=qualificationManifest([before],concepts,[rule],taxonomy,now);
   expect(result.manifest.companies[0].codes).toEqual(['FASHION','RETAIL']);
 });
});
