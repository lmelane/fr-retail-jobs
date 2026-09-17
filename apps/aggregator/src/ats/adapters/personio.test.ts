import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../../lib/http.js',()=>({fetchText:vi.fn()}));
import {fetchText} from '../../lib/http.js';import {fetchPersonioJobs,parsePositions} from './personio.js';
const fetch=vi.mocked(fetchText);
const xml='<workzag-jobs><position><id>42</id><name>Advisor</name><office>Berlin</office><department>Retail</department><createdAt>2020-01-01</createdAt><jobDescriptions/></position></workzag-jobs>';
describe('Personio official XML and job detail evidence',()=>{
 beforeEach(()=>vi.resetAllMocks());
 it('rejects HTML/error documents instead of reporting an empty complete board',()=>{
  expect(()=>parsePositions('<html>Unavailable</html>')).toThrow('FEED_ROOT');
  expect(()=>parsePositions('<workzag-jobs>')).toThrow('INVALID_XML');
  expect(parsePositions('<workzag-jobs/>')).toEqual([]);
 });
 it('recovers descriptions and publication evidence without polluting location with department',async()=>{
  fetch.mockResolvedValueOnce(xml).mockResolvedValueOnce('<script type="application/ld+json">'+JSON.stringify({'@type':'JobPosting',title:'Advisor',description:'Real description',datePosted:'2026-09-01',url:'https://a.jobs.personio.de/job/42'})+'</script>');
  const r=await fetchPersonioJobs({host:'a.jobs.personio.de'});
  expect(r.jobs).toHaveLength(1);expect(r.complete).toBe(true);expect(r.jobs[0].location).toBe('Berlin');
  expect(r.jobs[0].description).toBe('Real description');expect(r.jobs[0].postedAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  expect(r.jobs[0].raw).toMatchObject({createdAt:'2020-01-01',department:'Retail'});
 });
 it('keeps an offer on detail failure, without inventing its publication date',async()=>{
  fetch.mockResolvedValueOnce(xml).mockRejectedValueOnce(new Error('timeout'));
  const r=await fetchPersonioJobs({host:'a.jobs.personio.de'});expect(r.jobs).toHaveLength(1);expect(r.jobs[0].postedAt).toBeUndefined();
  expect(r.jobs[0].raw).toMatchObject({detailReadError:expect.stringContaining('timeout')});
 });
 it('preserves an invalid row as evidence and cannot authorize closure',async()=>{
  fetch.mockResolvedValueOnce('<workzag-jobs><position><name>Unidentifiable</name></position></workzag-jobs>');
  const r=await fetchPersonioJobs({host:'a.jobs.personio.de'});expect(r.complete).toBe(false);expect(r.rejectedRows).toHaveLength(1);
 });
 it('passes the asserted legal employer to identity resolution even when a detail fails',async()=>{
  fetch.mockResolvedValueOnce(xml.replace('<office>', '<subcompany>Hades Mining GmbH</subcompany><office>')).mockRejectedValueOnce(new Error('timeout'));
  const r=await fetchPersonioJobs({host:'hades.jobs.personio.de'});
  expect(r.jobs[0]).toMatchObject({company:'Hades Mining GmbH',employerEvidence:{rawName:'Hades Mining GmbH',path:'raw.subcompany'}});
 });
 it('uses a portal employer assertion when the XML names no legal entity',async()=>{
  const model={job:{id:42,name:'Advisor',fields:[]},careerSiteSettings:{company_name:'Pina Earth'}};
  fetch.mockResolvedValueOnce(xml).mockResolvedValueOnce('<script>self.__next_f.push('+JSON.stringify([1,'5:'+JSON.stringify(model)+'\n'])+')</script>');
  const r=await fetchPersonioJobs({host:'pina.jobs.personio.de'});
  expect(r.jobs[0]).toMatchObject({company:'Pina Earth',employerEvidence:{rule:'EXPLICIT_PERSONIO_PORTAL_EMPLOYER'}});
 });
});

/**
 * LE CONTRAT CANONIQUE — `String(raw.id)` du flux XML EST l'`externalId` écrit.
 *
 * Retirer `canonicalIds` de la preuve fait tomber ces témoins : sans la propriété,
 * `normalizeAdapterResult` classe la source « contrat non implémenté » et aucune absence n'y est
 * démontrable (`UNVERIFIABLE` à la prévisualisation).
 */
describe('Personio — identifiants canoniques',()=>{
 beforeEach(()=>vi.resetAllMocks());
 const two='<workzag-jobs><position><id>42</id><name>Advisor</name></position><position><id>77</id><name>Vendeur</name></position></workzag-jobs>';
 it('déclare canonicalIds sur la page de preuve, identiques aux externalId produits',async()=>{
  fetch.mockResolvedValueOnce(two).mockRejectedValue(new Error('detail hors sujet'));
  const r=await fetchPersonioJobs({host:'a.jobs.personio.de'});
  // PRÉMISSE : le flux porte bien deux positions identifiées, sans quoi le témoin n'exercerait rien.
  expect(r.jobs.map(j=>j.externalId)).toEqual(['42','77']);
  expect(r.enumeration!.pageEvidence!.every(pe=>Object.hasOwn(pe,'canonicalIds'))).toBe(true);
  const canonical=r.enumeration!.pageEvidence!.flatMap(pe=>pe.canonicalIds??[]);
  expect([...canonical].sort()).toEqual(r.jobs.map(j=>j.externalId).sort());
  expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(true);
 });
 it('une position VUE puis rejetée garde son identifiant : disposition, pas trou',async()=>{
  fetch.mockResolvedValueOnce('<workzag-jobs><position><id>42</id><name>Advisor</name></position><position><id>99</id><name></name></position></workzag-jobs>')
   .mockRejectedValue(new Error('detail hors sujet'));
  const r=await fetchPersonioJobs({host:'a.jobs.personio.de'});
  const canonical=r.enumeration!.pageEvidence!.flatMap(pe=>pe.canonicalIds??[]);
  expect(canonical).toContain('99');                                  // observée
  expect(r.jobs.map(j=>j.externalId)).not.toContain('99');            // non produite
  expect(r.rejectedRows?.find(x=>(x as any).canonicalId==='99')?.reason).toBe('MISSING_OR_INVALID_ID_OR_TITLE');
  expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(true);
 });
 it('une position SANS id interdit toute preuve d\'absence, sans inventer d\'identifiant',async()=>{
  fetch.mockResolvedValueOnce('<workzag-jobs><position><name>Sans identifiant</name></position></workzag-jobs>');
  const r=await fetchPersonioJobs({host:'a.jobs.personio.de'});
  expect(r.enumeration!.pageEvidence!.flatMap(pe=>pe.canonicalIds??[])).toEqual([]);
  expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(false);
 });
});
