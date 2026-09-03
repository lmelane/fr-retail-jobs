import type { AtsType } from '@prisma/client';
import type { AdapterResult, NormalizedJob } from '../types.js';
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
import { fetchTalentsoftJobs } from './adapters/talentsoft.js';
import { fetchTeamtailorJobs } from './adapters/teamtailor.js';
import { fetchAvatureJobs } from './adapters/avature.js';
import { fetchEightfoldJobs } from './adapters/eightfold.js';
import { fetchTalentViewJobs } from './adapters/talentview.js';
import { fetchMagnetJobs } from './adapters/magnet.js';
import { fetchPinpointJobs } from './adapters/pinpoint.js';
import { fetchLvmhJobs } from './adapters/lvmhAlgolia.js';
import { fetchWordpressJobs } from './adapters/wordpress.js';
import { fetchFashionjobsJobs } from './adapters/fashionjobs.js';

/**
 * Adapters answer either the legacy array or an AdapterResult (F-04); the
 * dispatcher normalizes to AdapterResult so every caller sees declaredTotal
 * and truncated where the vendor announces a count. Legacy adapters graduate
 * as they are touched — wrapping them changes nothing they did not measure.
 */
function toResult(value: NormalizedJob[] | AdapterResult): AdapterResult {
  return Array.isArray(value) ? { jobs: value } : value;
}

export async function fetchAtsJobs(type: AtsType, config: Record<string, unknown>): Promise<AdapterResult> {
  const result = await dispatch(type, config);
  const normalized = toResult(result);
  return {
    ...normalized,
    truncated:
      normalized.truncated ??
      (normalized.declaredTotal !== undefined && normalized.jobs.length < normalized.declaredTotal),
  };
}

async function dispatch(type: AtsType, config: Record<string, unknown>): Promise<NormalizedJob[] | AdapterResult> {
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
    case 'TALENTSOFT': return fetchTalentsoftJobs(config);
    case 'TEAMTAILOR': return fetchTeamtailorJobs(config);
    case 'AVATURE': return fetchAvatureJobs(config);
    case 'EIGHTFOLD': return fetchEightfoldJobs(config);
    case 'TALENTVIEW': return fetchTalentViewJobs(config);
    case 'MAGNET': return fetchMagnetJobs(config);
    case 'PINPOINT': return fetchPinpointJobs(config);
    case 'LVMH_ALGOLIA': return fetchLvmhJobs(config);
    case 'WORDPRESS': return fetchWordpressJobs(config);
    case 'FASHIONJOBS': return fetchFashionjobsJobs(config);
    case 'GENERIC_JSONLD': return fetchGenericJsonLdJobs(config);
    default: throw new Error(`Unsupported ATS type: ${type}`);
  }
}
