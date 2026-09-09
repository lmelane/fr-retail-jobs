import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js',()=>({fetchJson:vi.fn(),fetchText:vi.fn(),DEFAULT_DETAIL_CONCURRENCY:4}));
import { fetchJson, fetchText } from '../../lib/http.js';
import { fetchHarriJobs } from './harri.js';
const fetch=vi.mocked(fetchJson),text=vi.mocked(fetchText);
const config={brandId:8522347,slug:'Saltrock-Careers',employerMode:'PORTAL_OWNER'};
const profile={status:'SUCCESS',data:{id:8522347,slug:'Saltrock-Careers',name:'Saltrock'}};
const listing=(id:number)=>({id,brand:{id:8522959,name:'Saltrock Exeter',slug:'Saltrock-Careers-Exeter'},aliasPosition:'Sales Advisor/Keyholder',locations:[{city:'Exeter',country:'United Kingdom'}],publishTime:'2026-09-08T20:16:32Z'});
const detail=(id:number)=>({data:{job:{id,status:'PUBLISHED',description:'<p>Like the idea of joining the Saltrock family?</p>',publish_date:'Tue, 08 Sep 2026 20:16:32 GMT',Timing:[{name:'Part Time',code:'PART_TIME'}],private_description:'Do not persist application administration',assignees:[{name:'Not needed for job evidence'}]}}});
function feed(rows:ReturnType<typeof listing>[],hits=rows.length){return{status:'SUCCESS',data:{hits,results:rows}};}
function api(pages:ReturnType<typeof feed>[],override?: (id:number)=>unknown){fetch.mockImplementation(async(url)=>{if(url.endsWith('/basic_info'))return profile;if(url.endsWith('/search_jobs'))return pages.shift();const id=Number(url.split('/').pop());return override?override(id):detail(id)});}
beforeEach(()=>vi.resetAllMocks());
describe('Harri native career portal protocol',()=>{
 it('retains native posting/store evidence, dates and content while canonical employer scope is configuration',async()=>{
  api([feed([listing(2812433)])]);const r=await fetchHarriJobs(config);
  expect(r.complete).toBe(true);expect(r.jobs[0]).toMatchObject({externalId:'2812433',company:'Saltrock',city:'Exeter',country:'United Kingdom',workingTime:'Part Time',postedAt:new Date('2026-09-08T20:16:32Z')});
  expect(r.jobs[0].raw).toMatchObject({listing:{brand:{name:'Saltrock Exeter'}},detail:{id:2812433}});
  expect((r.jobs[0].raw as any).detail).not.toHaveProperty('assignees');expect((r.jobs[0].raw as any).detail).not.toHaveProperty('private_description');
 });
 it('uses the native start cursor and verifies all distinct IDs, never a guessed from parameter',async()=>{
  const rows=Array.from({length:31},(_,i)=>listing(2812433+i));api([feed(rows.slice(0,30),31),feed(rows.slice(30),31)]);
  const r=await fetchHarriJobs(config);expect(r.complete).toBe(true);expect(r.jobs).toHaveLength(31);
  const bodies=fetch.mock.calls.filter(([url])=>url.endsWith('/search_jobs')).map(([,init])=>JSON.parse(String(init?.body)));
  expect(bodies.map(x=>x.start)).toEqual([0,30]);expect(bodies.every(x=>!('from'in x)&&!('locations'in x))).toBe(true);
 });
 it('cannot prove completeness with a repeated page or changing native total',async()=>{
  api([feed([listing(1)],2),feed([listing(1)],2)]);const r=await fetchHarriJobs(config);expect(r.complete).toBe(false);expect(r.enumeration?.issues).toContain('REPEATED_POSTING_ID:1');
  vi.resetAllMocks();api([feed([listing(1)],2),feed([listing(2)],3)]);expect((await fetchHarriJobs(config)).enumeration?.issues).toContain('DECLARED_TOTAL_CHANGED');
 });
 it('keeps a posting when details fail and reports the exact gap',async()=>{
  api([feed([listing(2812433)])],()=>{throw Error('HTTP 503')});const r=await fetchHarriJobs(config);
  expect(r.jobs).toHaveLength(1);expect(r.complete).toBe(false);expect(r.jobs[0].postedAt).toEqual(new Date('2026-09-08T20:16:32Z'));
  expect(r.enumeration?.issues).toContain('DETAIL_READ_FAILED:2812433');expect((r.jobs[0].raw as any).detailReadError).toContain('503');
 });
 it('treats the image brand ID only as a candidate and refuses a different native portal identity',async()=>{
  text.mockResolvedValue('<meta property="og:image" content="https://media-cdn.harri.com/brands/8522347/brand_profile/image.jpg">');
  fetch.mockResolvedValue({...profile,data:{...profile.data,slug:'different-employer'}});
  await expect(fetchHarriJobs({slug:'Saltrock-Careers'})).rejects.toThrow('IDENTITY_MISMATCH');expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('distinguishes native unlisting from closure and preserves explicit observation time',async()=>{
  api([feed([listing(1)])],id=>({data:{job:{...detail(id).data.job,status:'UNPUBLISHED'}}}));
  expect((await fetchHarriJobs(config)).jobs[0]).toMatchObject({publicationHold:'SOURCE_UNLISTED'});
 });
 it('accepts a verified empty feed, but refuses an error object instead of inventing zero',async()=>{
  api([feed([])]);expect((await fetchHarriJobs(config)).complete).toBe(true);
  vi.resetAllMocks();fetch.mockResolvedValueOnce(profile).mockResolvedValueOnce({status:'ERROR'});await expect(fetchHarriJobs(config)).rejects.toThrow('INVALID_LISTING_RESPONSE');
 });
});
it('rejects contradictory explicit configuration before making requests',async()=>{
 await expect(fetchHarriJobs({...config,brandId:0})).rejects.toThrow('INVALID_BRAND_ID');
 await expect(fetchHarriJobs({...config,portalUrl:'https://harri.com/different'})).rejects.toThrow('SLUG_CONFLICT');
 expect(fetch).not.toHaveBeenCalled();expect(text).not.toHaveBeenCalled();
});
