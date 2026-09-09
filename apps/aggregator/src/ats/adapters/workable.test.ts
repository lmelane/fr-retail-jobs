import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js',()=>({fetchJson:vi.fn()}));
vi.mock('../../lib/sourceBudget.js',()=>({sourceDelay:vi.fn(),assertSourceRunning:vi.fn()}));
import { fetchJson } from '../../lib/http.js';
import { fetchWorkableJobs } from './workable.js';
const fetch=vi.mocked(fetchJson);
const row={shortcode:'A',title:'Advisor',description:'Real description',published_on:'2026-09-01'};
describe('Workable independent enumeration',()=>{
 beforeEach(()=>vi.resetAllMocks());
 it('follows every cursor with no country filter and crosschecks exact IDs',async()=>{
  fetch.mockResolvedValueOnce({jobs:[row,{...row,shortcode:'B'}]})
    .mockResolvedValueOnce({total:2,results:[row],nextPage:'next'})
    .mockResolvedValueOnce({total:2,results:[{...row,shortcode:'B'}]});
  const r=await fetchWorkableJobs({account:'brand'});expect(r.complete).toBe(true);expect(r.jobs).toHaveLength(2);
  expect(r.enumeration?.pages).toBe(2);expect(r.jobs[0].raw).toEqual(row);
  expect(JSON.parse((fetch.mock.calls[2][1] as RequestInit).body as string)).toMatchObject({token:'next',location:[],department:[]});
 });
 it('preserves offers missing from the detail widget and reports incomplete enrichment',async()=>{
  fetch.mockResolvedValueOnce({jobs:[]}).mockResolvedValueOnce({total:1,results:[{...row,published:'2026-09-01'}]});
  const r=await fetchWorkableJobs({account:'brand'});expect(r.complete).toBe(false);expect(r.jobs).toHaveLength(1);
  expect(r.jobs[0].raw).toMatchObject({detailReadError:'ABSENT_FROM_DETAIL_WIDGET'});
 });
 it('never closes on an API failure, duplicate cursor or changing total',async()=>{
  fetch.mockResolvedValueOnce({jobs:[row]}).mockRejectedValueOnce(new Error('403'));
  const failed=await fetchWorkableJobs({account:'brand'});expect(failed.complete).toBe(false);expect(failed.jobs).toHaveLength(1);
  expect(failed.enumeration?.termination).toContain('403');
  fetch.mockResolvedValueOnce({jobs:[row]}).mockResolvedValueOnce({total:1,results:[row],nextPage:'x'})
    .mockResolvedValueOnce({total:2,results:[],nextPage:'x'});
  const repeated=await fetchWorkableJobs({account:'brand'});expect(repeated.complete).toBe(false);
  expect(repeated.enumeration?.termination).toBe('REPEATED_OR_INVALID_CURSOR');
 });
 it('coalesces only the same requisition ID across locations and keeps both RAW records',async()=>{
  const one={...row,city:'Kavala',country:'Greece'}; const two={...row,city:'Alexandroupoli',country:'Greece'};
  fetch.mockResolvedValueOnce({jobs:[one,two]}).mockResolvedValueOnce({total:1,results:[{...row,location:{city:'Kavala',country:'Greece'}}]});
  const r=await fetchWorkableJobs({account:'brand'});expect(r.jobs).toHaveLength(1);expect(r.complete).toBe(true);
  expect(r.jobs[0].raw).toMatchObject({widgetRepresentations:[one,two],representationResolution:'SAME_REQUISITION_MULTIPLE_LOCATIONS'});
 });
 it('keeps conflicting duplicate content as RAW and prevents a complete verdict',async()=>{
  fetch.mockResolvedValueOnce({jobs:[row,{...row,title:'Different role'}]}).mockResolvedValueOnce({total:1,results:[row]});
  const r=await fetchWorkableJobs({account:'brand'});expect(r.complete).toBe(false);
  expect((r.jobs[0].raw as any).widgetRepresentations).toHaveLength(2);
 });
 it('rejects error-shaped widget responses instead of inventing zero jobs',async()=>{
  fetch.mockResolvedValueOnce({error:'bad gateway'});await expect(fetchWorkableJobs({account:'brand'})).rejects.toThrow('INVALID_WIDGET');
 });
});
