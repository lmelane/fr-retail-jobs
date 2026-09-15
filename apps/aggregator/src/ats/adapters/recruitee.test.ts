import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js',()=>({fetchJson:vi.fn()}));
import { fetchJson } from '../../lib/http.js';
import { fetchRecruiteeJobs } from './recruitee.js';
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
