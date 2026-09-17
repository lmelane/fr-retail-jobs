import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchIcimsJobs, mergeIcimsDetail } from './icims.js';
import { icimsPublication } from '../../test/fixtures/icimsPublication.js';
import * as http from '../../lib/http.js';
afterEach(()=>vi.restoreAllMocks());
const p=icimsPublication('hub','https://stores-brand.icims.com','?hub=15&in_iframe=1');
const job={...p,title:'Listing title',raw:{source:'icims',reference:'2026-42'}};
const config={origin:'https://hub-brand.icims.com',detailOrigins:['https://stores-brand.icims.com'],employerFromJobPosting:true};
const html=(node:unknown)=>`<script type="application/ld+json">${JSON.stringify(node)}</script>`;
const listing=`<div>Page 1 of 1</div><li class="iCIMS_JobCardItem"><a href="${p.url}"><h3>Listing title</h3></a><span class="field-label">ID</span><span>2026-42</span></li>`;
describe('iCIMS live detail binding',()=>{
  it('uses the qualified native detail and employer',()=>{
    expect(mergeIcimsDetail(job,html(p.raw.postingEvidence.jobPosting),config)).toMatchObject({title:'Listing title',description:'Own published description',company:'Tiffany & Co.'});
  });
  it.each([null,{...p.raw.postingEvidence.jobPosting,url:p.url.replace('/42/','/43/')},[p.raw.postingEvidence.jobPosting,p.raw.postingEvidence.jobPosting]])('holds a missing, wrong or ambiguous detail without importing its fields (%#)',node=>{
    const result=mergeIcimsDetail(job,html(node),config);
    expect(result).toMatchObject({title:'Listing title',publicationHold:'ICIMS_DETAIL_IDENTITY_MISMATCH'});
    expect(result.description).toBeUndefined();expect(result.company).toBeUndefined();
  });
  it('does not fetch a cross-origin detail outside the reviewed configuration',async()=>{
    const fetch=vi.spyOn(http,'fetchText').mockResolvedValue(listing);
    const result=await fetchIcimsJobs({origin:config.origin});
    expect(result.jobs[0].publicationHold).toBe('ICIMS_DETAIL_ORIGIN_UNQUALIFIED');expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('holds a failed detail and preserves its native listing instead of publishing its teaser',async()=>{
    vi.spyOn(http,'fetchText').mockResolvedValueOnce(listing).mockRejectedValueOnce(new Error('detail failed'));
    const result=await fetchIcimsJobs(config);
    expect(result.jobs[0]).toMatchObject({externalId:'42',url:p.url,publicationHold:'ICIMS_DETAIL_FETCH_FAILED',raw:{source:'icims',detailReadError:'Error: detail failed'}});
  });
});
