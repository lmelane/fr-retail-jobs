import { fetchJobaffinityWordpressJobs } from './adapters/jobaffinityWordpress.js';
import { fetchFlatchrJobs } from './adapters/flatchr.js';
import type { AtsType } from '@prisma/client';
import type { AdapterResult, NormalizedJob } from '../types.js';
import { ENUMERATION_MIN_COVERAGE, enumerationVerdict, verdictToComplete } from '../pipeline/enumeration.js';
import { fetchGreenhouseJobs } from './adapters/greenhouse.js';
import { fetchLeverJobs } from './adapters/lever.js';
import { fetchSmartRecruitersJobs } from './adapters/smartrecruiters.js';
import { fetchRecruiteeJobs } from './adapters/recruitee.js';
import { fetchPersonioJobs } from './adapters/personio.js';
import { fetchWorkdayJobs } from './adapters/workday.js';
import { fetchGenericJsonLdJobs } from './adapters/genericJsonLd.js';
import { fetchAshbyJobs } from './adapters/ashby.js';
import { fetchTalentRecruiterJobs } from './adapters/talentRecruiter.js';
import { fetchEasycruitJobs } from './adapters/easycruit.js';
import { fetchHarriJobs } from './adapters/harri.js';
import { fetchWorkableJobs } from './adapters/workable.js';
import { fetchWttjJobs } from './adapters/wttj.js';
import { fetchWttjSectorJobs } from './adapters/wttjSector.js';
import { fetchSuccessFactorsResult } from './adapters/successfactors.js';
import { fetchPhenomJobs } from './adapters/phenom.js';
import { fetchDigitalRecruitersJobs } from './adapters/digitalrecruiters.js';
import { fetchTalentsoftJobs } from './adapters/talentsoft.js';
import { fetchTeamtailorJobs } from './adapters/teamtailor.js';
import { fetchAvatureJobs } from './adapters/avature.js';
import { fetchIcimsJobs } from './adapters/icims.js';
import { fetchEightfoldJobs } from './adapters/eightfold.js';
import { fetchTalentViewJobs } from './adapters/talentview.js';
import { fetchMagnetJobs } from './adapters/magnet.js';
import { fetchPinpointJobs } from './adapters/pinpoint.js';
import { fetchLvmhJobs } from './adapters/lvmhAlgolia.js';
import { fetchWordpressJobs } from './adapters/wordpress.js';
import { fetchFashionjobsJobs } from './adapters/fashionjobs.js';
// Lot « GENERIC » du 2026-09-06 : treize portails lus par exécution.
import { fetchOracleHcmJobs } from './adapters/oraclehcm.js';
import { fetchTaleoJobs } from './adapters/taleo.js';
import { fetchAltamiraJobs } from './adapters/altamira.js';
import { fetchJobylonJobs } from './adapters/jobylon.js';
import { fetchRitualsJobs } from './adapters/rituals.js';
import { fetchTalentFunnelJobs } from './adapters/talentFunnel.js';
import { fetchBashTalentsJobs } from './adapters/bashTalents.js';
import { fetchEqwaJobs } from './adapters/eqwa.js';
import { fetchGeoDirectoryJobs } from './adapters/geodirectory.js';
import { fetchRivoliTypesenseJobs } from './adapters/rivoliTypesense.js';
import { fetchJibeJobs } from './adapters/jibe.js';
import { fetchVolcanicJobs } from './adapters/volcanic.js';
import { fetchSwatchGroupJobs } from './adapters/swatchgroup.js';

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
  return normalizeAdapterResult(result);
}

export function normalizeAdapterResult(result: NormalizedJob[] | AdapterResult): AdapterResult {
  const normalized = toResult(result);
  const unique = new Set(normalized.jobs.map(job => job.externalId)).size;

  /**
   * `truncated` reste dérivé du total déclaré, MAIS avec la même tolérance que le reste de la chaîne : une unité
   * d'écart sur 1 026 n'est pas une troncature (kering, 1 025/1 026 — la source publie une offre pendant le
   * balayage). Auparavant tout écart, même d'une unité, déclarait le listing tronqué.
   */
  const declared = normalized.declaredTotal;
  const truncated = normalized.truncated ??
    (declared !== undefined && declared > 0 && unique / declared < ENUMERATION_MIN_COVERAGE);

  /**
   * A rejected row is an EXPLAINED witness (an expired page still listed in a sitemap, a Workday row without a
   * path). `enumerationVerdict` decides what weight it carries: an adapter that judged its own enumeration keeps
   * its proof, an adapter that states nothing sees the row as doubt.
   */
  const unreadableRows = normalized.rejectedRows?.length ?? 0;

  /**
   * Le verdict à TROIS valeurs. `UNKNOWN` devient `undefined`, jamais `false` : une source qui ne déclare pas son
   * total n'est pas une source dont on a prouvé l'incomplétude.
   *
   * `normalized.complete` est la DÉMONSTRATION DE PARCOURS de l'adaptateur, et c'est la seule voie vers `PROVEN`
   * depuis la règle du 2026-09-11 : Teamtailor la produit quand le feed rend `next_url: null`, Recruitee et
   * Personio parce que leur endpoint unique est servi en entier, Workday et SuccessFactors quand tous les totaux
   * ou toutes les partitions sont atteints. Un ratio ne prouve plus rien.
   */
  const verdict = enumerationVerdict({
    adapterProvesCompletion: normalized.complete,
    declaredTotal: declared,
    uniqueCollected: unique,
    truncated,
    unreadableRows,
  });

  return {
    ...normalized,
    truncated,
    // Un doublon d'identifiant dans le lot signifie qu'on ne sait pas ce qu'on a lu : la preuve tombe.
    complete: unique === normalized.jobs.length ? verdictToComplete(verdict) : false,
    enumerationVerdict: unique === normalized.jobs.length ? verdict : 'REFUTED',
  };
}

/**
 * Un adaptateur par AtsType lisible. Exporté pour que la table des kinds du
 * catalogue (KIND_TO_ATS) soit testée contre lui : trois sources iCIMS ACTIVE
 * (2 252 offres) n'ont jamais tourné parce que le kind manquait dans la table
 * alors que l'adaptateur et ce dispatch existaient (audit A2, 2026-09-06).
 */
export const ADAPTERS: Record<string, (config: Record<string, unknown>) => Promise<NormalizedJob[] | AdapterResult>> = {
  // Greenhouse documents this endpoint as the complete public job board.
  GREENHOUSE: async config => ({ jobs: await fetchGreenhouseJobs(config), complete: true }),
  LEVER: fetchLeverJobs,
  SMARTRECRUITERS: fetchSmartRecruitersJobs,
  RECRUITEE: fetchRecruiteeJobs,
  PERSONIO: fetchPersonioJobs,
  WORKDAY: fetchWorkdayJobs,
  ASHBY: fetchAshbyJobs,
  HARRI: fetchHarriJobs,
  TALENT_RECRUITER: fetchTalentRecruiterJobs,
  EASYCRUIT: fetchEasycruitJobs,
  WORKABLE: fetchWorkableJobs,
  // Une société (`slug`) ou tout un secteur (`sectors` / `parentSectors` /
  // `organizations`) : même AtsType, même identité d'offre, deux lectures.
  WTTJ: (config) =>
    config.sectors || config.parentSectors || config.organizations ? fetchWttjSectorJobs(config) : fetchWttjJobs(config),
  SUCCESSFACTORS: fetchSuccessFactorsResult,
  PHENOM: fetchPhenomJobs,
  DIGITALRECRUITERS: fetchDigitalRecruitersJobs,
  TALENTSOFT: fetchTalentsoftJobs,
  TEAMTAILOR: fetchTeamtailorJobs,
  AVATURE: fetchAvatureJobs,
  ICIMS: fetchIcimsJobs,
  EIGHTFOLD: fetchEightfoldJobs,
  TALENTVIEW: fetchTalentViewJobs,
  MAGNET: fetchMagnetJobs,
  PINPOINT: fetchPinpointJobs,
  LVMH_ALGOLIA: fetchLvmhJobs,
  WORDPRESS: fetchWordpressJobs,
  FASHIONJOBS: fetchFashionjobsJobs,
  GENERIC_JSONLD: fetchGenericJsonLdJobs,
  ORACLE_HCM: fetchOracleHcmJobs,
  TALEO: fetchTaleoJobs,
  ALTAMIRA: fetchAltamiraJobs,
  JOBYLON: fetchJobylonJobs,
  RITUALS: fetchRitualsJobs,
  TALENT_FUNNEL: fetchTalentFunnelJobs,
  BASH_TALENTS: fetchBashTalentsJobs,
  EQWA: fetchEqwaJobs,
  GEODIRECTORY: fetchGeoDirectoryJobs,
  TYPESENSE: fetchRivoliTypesenseJobs,
  JIBE: fetchJibeJobs,
  VOLCANIC: fetchVolcanicJobs,
  SWATCH_GROUP: fetchSwatchGroupJobs,
  FLATCHR: fetchFlatchrJobs,
  JOBAFFINITY_WORDPRESS: fetchJobaffinityWordpressJobs,
};

export const SUPPORTED_ATS_TYPES = Object.keys(ADAPTERS);

async function dispatch(type: AtsType, config: Record<string, unknown>): Promise<NormalizedJob[] | AdapterResult> {
  const adapter = ADAPTERS[type];
  if (!adapter) throw new Error(`Unsupported ATS type: ${type}`);
  return adapter(config);
}
