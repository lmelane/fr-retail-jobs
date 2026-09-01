import type { AtsType } from '@prisma/client';
import type { NormalizedJob } from '../types.js';
import { fetchGreenhouseJobs } from './adapters/greenhouse.js';
import { fetchLeverJobs } from './adapters/lever.js';
import { fetchSmartRecruitersJobs } from './adapters/smartrecruiters.js';
import { fetchRecruiteeJobs } from './adapters/recruitee.js';
import { fetchPersonioJobs } from './adapters/personio.js';
import { fetchWorkdayJobs } from './adapters/workday.js';
import { fetchGenericJsonLdJobs } from './adapters/genericJsonLd.js';
import { fetchAshbyJobs } from './adapters/ashby.js';
import { fetchWorkableJobs } from './adapters/workable.js';
import { fetchWttjJobs } from './adapters/wttj.js';
import { fetchSuccessFactorsJobs } from './adapters/successfactors.js';
import { fetchPhenomJobs } from './adapters/phenom.js';
import { fetchDigitalRecruitersJobs } from './adapters/digitalrecruiters.js';
import { fetchTeamtailorJobs } from './adapters/teamtailor.js';
import { fetchAvatureJobs } from './adapters/avature.js';

export async function fetchAtsJobs(type: AtsType, config: Record<string, unknown>): Promise<NormalizedJob[]> {
  switch (type) {
    case 'GREENHOUSE': return fetchGreenhouseJobs(config);
    case 'LEVER': return fetchLeverJobs(config);
    case 'SMARTRECRUITERS': return fetchSmartRecruitersJobs(config);
    case 'RECRUITEE': return fetchRecruiteeJobs(config);
    case 'PERSONIO': return fetchPersonioJobs(config);
    case 'WORKDAY': return fetchWorkdayJobs(config);
    case 'ASHBY': return fetchAshbyJobs(config);
    case 'WORKABLE': return fetchWorkableJobs(config);
    case 'WTTJ': return fetchWttjJobs(config);
    case 'SUCCESSFACTORS': return fetchSuccessFactorsJobs(config);
    case 'PHENOM': return fetchPhenomJobs(config);
    case 'DIGITALRECRUITERS': return fetchDigitalRecruitersJobs(config);
    case 'TEAMTAILOR': return fetchTeamtailorJobs(config);
    case 'AVATURE': return fetchAvatureJobs(config);
    case 'GENERIC_JSONLD': return fetchGenericJsonLdJobs(config);
    default: throw new Error(`Unsupported ATS type: ${type}`);
  }
}
