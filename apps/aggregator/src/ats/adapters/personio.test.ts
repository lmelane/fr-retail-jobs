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
