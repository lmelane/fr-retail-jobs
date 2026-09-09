/** Direct read only: no Prisma, no ingestion, no country filter. */
import { fetchAvatureJobs } from '../../../apps/aggregator/src/ats/adapters/avature.js';
import { withSourceBudget } from '../../../apps/aggregator/src/lib/sourceBudget.js';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const start = new Date();
try {
 const result = await withSourceBudget(() => fetchAvatureJobs({
  listingUrl: 'https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0', withDescriptions: false,
 }), 360000, 'loreal-listing-validation');
 const jobs = result.jobs.map(j => ({id:j.externalId,url:j.url,title:j.title,location:j.location,postedAt:j.postedAt}));
 const proof={startedAt:start.toISOString(),finishedAt:new Date().toISOString(),scope:'ALL_COUNTRIES_UNFILTERED',
  productionWrites:0, fullDescriptionsRead:false, complete:result.complete,truncated:result.truncated,
  fetched:jobs.length,unique:new Set(jobs.map(j=>j.id)).size,rowsSha256:createHash('sha256').update(JSON.stringify(jobs)).digest('hex'),
  jobs};
 writeFileSync('audits/2026-09-09/run-integrity/loreal-listing-validation.json',JSON.stringify(proof,null,2));
 console.log(JSON.stringify({...proof,jobs:undefined}));
} catch(error) {
 const proof={startedAt:start.toISOString(),finishedAt:new Date().toISOString(),productionWrites:0,complete:false,error:String(error)};
 writeFileSync('audits/2026-09-09/run-integrity/loreal-listing-validation.json',JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));process.exitCode=1;
}
