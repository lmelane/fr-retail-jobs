import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js',()=>({fetchJson:vi.fn()}));
import { fetchJson } from '../../lib/http.js';
import { fetchAshbyJobs } from './ashby.js';
const fetch=vi.mocked(fetchJson);
const row={id:'polene-witness',title:'Client Advisor',isListed:true,publishedAt:'2026-09-08T12:00:00Z',workplaceType:'Hybrid',department:'Retail',jobUrl:'https://jobs.ashbyhq.com/polene-paris/polene-witness',descriptionPlain:'Description source',address:{postalAddress:{addressLocality:'Paris',addressCountry:'FRA'}}};
describe('Ashby documented complete feed',()=>{
 beforeEach(()=>vi.resetAllMocks());
 it('keeps RAW, source publication date, workplace and department with a full-feed receipt',async()=>{
  fetch.mockResolvedValue({apiVersion:'1',jobs:[row]});const result=await fetchAshbyJobs({board:'polene-paris'});
  expect(result).toMatchObject({complete:true,declaredTotal:1,enumeration:{method:'DOCUMENTED_COMPLETE_PUBLIC_FEED',rawCount:1}});
  expect(result.jobs[0]).toMatchObject({raw:row,remote:'Hybrid',department:'Retail',postedAt:new Date(row.publishedAt),city:'Paris',country:'FRA'});
 });
 it('does not drop unlisted posts or misclassify them as closed/internal',async()=>{
  fetch.mockResolvedValue({apiVersion:'1',jobs:[{...row,isListed:false}]});const result=await fetchAshbyJobs({board:'polene-paris'});
  expect(result.complete).toBe(true);expect(result.jobs[0]).toMatchObject({publicationHold:'SOURCE_UNLISTED',raw:{isListed:false}});
  expect(result.jobs[0].publicationWithdrawnAt).toBeInstanceOf(Date);
 });
 it('rejects missing feed and changed API contracts instead of reporting zero',async()=>{
  for(const body of [{error:'not found'},{jobs:[]},{apiVersion:'2',jobs:[]}]){fetch.mockResolvedValueOnce(body);await expect(fetchAshbyJobs({board:'polene-paris'})).rejects.toThrow('INVALID_FEED');}
 });
 it('retains malformed evidence and never creates an identity from a title',async()=>{
  const broken=[{title:'Repeated title',isListed:true},{id:'missing-flag',title:'Client Advisor'},{id:'empty-title',title:'',isListed:true}];
  fetch.mockResolvedValue({apiVersion:'1',jobs:[row,...broken]});const result=await fetchAshbyJobs({board:'polene-paris'});
  expect(result.complete).toBe(false);expect(result.jobs).toHaveLength(1);expect(result.rejectedRows?.map(r=>r.raw)).toEqual(broken);
 });
 it('allows a documented empty board and a durable URL ID, without inventing a missing date',async()=>{
  fetch.mockResolvedValueOnce({apiVersion:'1',jobs:[]});expect((await fetchAshbyJobs({board:'polene-paris'})).complete).toBe(true);
  fetch.mockResolvedValueOnce({apiVersion:'1',jobs:[{...row,id:undefined,publishedAt:undefined}]});const result=await fetchAshbyJobs({board:'polene-paris'});
  expect(result.jobs[0].externalId).toBe(row.jobUrl);expect(result.jobs[0].postedAt).toBeUndefined();
 });
});
