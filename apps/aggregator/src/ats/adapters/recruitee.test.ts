import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js',()=>({fetchJson:vi.fn()}));
import { fetchJson } from '../../lib/http.js';
import { fetchRecruiteeJobs, parseRecruiteeJob } from './recruitee.js';
import { normalizeAdapterResult } from '../index.js';
const fetch=vi.mocked(fetchJson);
describe('Recruitee full public feed contract',()=>{
 beforeEach(()=>vi.resetAllMocks());
 it('proves the unfiltered feed and keeps the source payload',async()=>{
  const row={id:123,title:'Conseiller',country:'France',careers_url:'https://a.recruitee.com/o/conseiller'};
  fetch.mockResolvedValue({offers:[row]});const r=await fetchRecruiteeJobs({subdomain:'a'});
  expect(r.complete).toBe(true);expect(r.jobs[0].raw).toEqual(row);expect(r.enumeration?.rawCount).toBe(1);
  expect(fetch).toHaveBeenCalledWith('https://a.recruitee.com/api/offers/');
 });
 /**
  * `education_code` arrive sur 653 offres et n'était écrit NULLE PART : la
  * colonne `educationLevel` valait 0/87 580 en production le 2026-09-15.
  * Ce témoin prouve d'abord que le jeu d'essai PORTE le champ source, sinon il
  * passerait au vert sans rien exercer.
  */
 it('lit le niveau d’études déclaré, et jamais le rang de séniorité',async()=>{
  const row={id:1,title:'Conseiller',education_code:'bachelor_degree',experience_code:'mid_level'};
  // PRÉMISSE : le champ source est bien présent dans le jeu d'essai.
  expect(row.education_code).toBe('bachelor_degree');
  fetch.mockResolvedValue({offers:[row]});const r=await fetchRecruiteeJobs({subdomain:'a'});
  expect(r.jobs[0].educationLevel).toBe('RECRUITEE:bachelor_degree');
  // `experience_code` est un RANG : il ne doit produire aucune durée.
  expect(r.jobs[0].experienceYears).toBeUndefined();
 });
 it('n’invente pas un niveau d’études quand la source n’en déclare aucun',async()=>{
  fetch.mockResolvedValue({offers:[{id:1,title:'Conseiller'}]});
  expect((await fetchRecruiteeJobs({subdomain:'a'})).jobs[0].educationLevel).toBeUndefined();
 });
 it('never interprets an error object as zero published jobs',async()=>{
  fetch.mockResolvedValue({error:'Unauthorized'});
  await expect(fetchRecruiteeJobs({subdomain:'a'})).rejects.toThrow('INVALID_FEED');
 });
 it('retains malformed rows and prevents closure from incomplete parsing',async()=>{
  fetch.mockResolvedValue({offers:[{id:1,title:'Good'},{id:2,title:''}]});const r=await fetchRecruiteeJobs({subdomain:'a'});
  expect(r.jobs).toHaveLength(1);expect(r.complete).toBe(false);expect(r.rejectedRows?.[0].raw).toEqual({id:2,title:''});
 });
 it('recognises a valid empty feed, but not duplicate identifiers as complete',async()=>{
  fetch.mockResolvedValueOnce({offers:[]});expect((await fetchRecruiteeJobs({subdomain:'a'})).complete).toBe(true);
  fetch.mockResolvedValueOnce({offers:[{id:1,title:'A'},{id:1,title:'B'}]});expect((await fetchRecruiteeJobs({subdomain:'a'})).complete).toBe(false);
 });
});

/**
 * LE CONTRAT DES IDENTIFIANTS CANONIQUES (lot 5G3C, suite).
 *
 * `offer.id` est l'identifiant natif, et `String(offer.id)` le chemin exact de `externalId` : c'est le seul
 * ensemble comparable à la base, donc le seul par lequel une absence puisse être prouvée. Le contrat est jugé
 * dans `normalizeAdapterResult` ; retirer `canonicalIds` de l'adaptateur fait ÉCHOUER ces témoins (vérifié par
 * retrait puis restauration).
 */
describe('Recruitee — contrat des identifiants canoniques', () => {
 beforeEach(()=>vi.resetAllMocks());

 it('déclare les identifiants natifs observés, identiques aux externalId des offres écrites',async()=>{
  const offers=[{id:123,title:'Conseiller'},{id:456,title:'Vendeur'}];
  fetch.mockResolvedValue({offers});const r=await fetchRecruiteeJobs({subdomain:'a'});

  const pages=r.enumeration!.pageEvidence!;
  expect(pages).toHaveLength(1);
  // Toutes les pages déclarent : une page muette vaudrait contrat ROMPU.
  expect(pages.every(p=>Object.hasOwn(p,'canonicalIds'))).toBe(true);
  expect(pages.flatMap(p=>p.canonicalIds??[])).toEqual(['123','456']);
  expect(pages.flatMap(p=>p.canonicalIds??[])).toEqual(r.jobs.map(j=>j.externalId));
  expect(r.enumeration!.canonicalAbsenceProofUsable).toBe(true);

  // Le contrat n'est réellement jugé qu'ici : la preuve doit survivre à la normalisation.
  const normalized=normalizeAdapterResult(r);
  expect(normalized.complete).toBe(true);
  expect(normalized.enumeration?.issues??[]).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
  expect(normalized.enumeration?.canonicalIdViolations).toBeUndefined();
 });

 it('une ligne vue puis rejetée garde son identifiant natif comme DISPOSITION',async()=>{
  fetch.mockResolvedValue({offers:[{id:1,title:'Good'},{id:2,title:''}]});const r=await fetchRecruiteeJobs({subdomain:'a'});
  expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(['1','2']);
  expect(r.rejectedRows?.map(row=>row.canonicalId)).toEqual(['2']);
  // Sans cette disposition, « 2 » serait un identifiant observé orphelin et le contrat tomberait.
  expect(normalizeAdapterResult(r).enumeration?.canonicalIdViolations).toBeUndefined();
 });

 it('une ligne sans id exploitable est ANONYME : comptée, jamais nommée',async()=>{
  fetch.mockResolvedValue({offers:[{id:1,title:'Good'},{id:0,title:'Sans identifiant'}]});
  const r=await fetchRecruiteeJobs({subdomain:'a'});
  expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(['1']);
  expect(r.enumeration!.canonicalAbsenceProofUsable).toBe(false);
  expect(r.rejectedRows?.[0].canonicalId).toBeUndefined();
 });

 it('un board réellement vide déclare une preuve canonique vide, et reste cohérent',async()=>{
  fetch.mockResolvedValue({offers:[]});const r=await fetchRecruiteeJobs({subdomain:'a'});
  expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual([]);
  const normalized=normalizeAdapterResult(r);
  expect(normalized.complete).toBe(true);
  expect(normalized.enumeration?.issues??[]).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
 });
});

describe('Recruitee complete native content', () => {
 const raw={id:42,title:'Advisor',description:'<p>Native duties</p>',requirements:'<ul><li>Native requirement</li></ul>',
   published_at:'2026-09-01 15:54:14 UTC',created_at:'2026-09-01 15:49:29 UTC'};
 it('reads both body sections and publication time through the live feed',async()=>{
  fetch.mockResolvedValue({offers:[raw]});const {jobs:[job]}=await fetchRecruiteeJobs({subdomain:'a'});
  expect(job.description).toBe('Native duties\n\n• Native requirement');
  expect(job.postedAt?.toISOString()).toBe('2026-09-01T15:54:14.000Z');
  expect(job.raw).toEqual(raw);
 });
 it.each([undefined,null,'','2026-02-30 10:00:00 UTC','2026-09-01 10:00:00'])('never substitutes creation for missing/invalid publication: %s',published_at=>{
  expect(parseRecruiteeJob({...raw,published_at},'a').postedAt).toBeUndefined();
 });
 it('retains requirements even without an opening paragraph',()=>{
  expect(parseRecruiteeJob({...raw,description:''},'a').description).toBe('• Native requirement');
 });
});
