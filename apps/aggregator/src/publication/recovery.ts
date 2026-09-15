import { parseAshbyJob } from '../ats/adapters/ashby.js';
import { parseLeverJob } from '../ats/adapters/lever.js';
import { parseJibePage } from '../ats/adapters/jibe.js';
import { parsePhenomJob } from '../ats/adapters/phenom.js';
import { parseLvmhHit } from '../ats/adapters/lvmhAlgolia.js';
import { toNormalized as parseTeamtailorJob } from '../ats/adapters/teamtailor.js';
import { parseWorkdayPublication } from '../ats/adapters/workday.js';
import { workdayDetailMatchesListing } from '../identity/workday.js';
import { parseGreenhouseJob } from '../ats/adapters/greenhouse.js';
import { parseRecruiteeJob } from '../ats/adapters/recruitee.js';
import { normalizeGenericPosting } from '../ats/adapters/genericJsonLd.js';
import { normalizeJobPosting } from '../connectors/generic/jsonLdSitemap.js';
import { normalizeMagnetOffer } from '../ats/adapters/magnet.js';
import { parseRitualsHit } from '../ats/adapters/rituals.js';
import { parseWordpressPost } from '../ats/adapters/wordpress.js';
import { normalizeGeoDirPost } from '../ats/adapters/geodirectory.js';
import { talentsoftItemToJob } from '../ats/adapters/talentsoft.js';
import { docToJob } from '../ats/adapters/rivoliTypesense.js';
import { parseWorkableJob } from '../ats/adapters/workable.js';
import { normalizeListRequisition, mergeDetail } from '../ats/adapters/oraclehcm.js';
import { normalizeJobaffinityPost, applyJobaffinityEvidence } from '../ats/adapters/jobaffinityWordpress.js';
import { parseFlatchrItem } from '../ats/adapters/flatchr.js';
import { parsePersonioPosition } from '../ats/adapters/personio.js';
import { parseJobylonPublication } from '../ats/adapters/jobylon.js';
import { parseTalentViewCampaign, mergeTalentViewDetail } from '../ats/adapters/talentview.js';
import { parseTalentFunnelVacancy } from '../ats/adapters/talentFunnel.js';
import { parseVolcanicPage } from '../ats/adapters/volcanic.js';
import { parseEasycruitVacancy } from '../ats/adapters/easycruit.js';
import { parseHarriPublication } from '../ats/adapters/harri.js';
import { parseTalentRecruiterPosition } from '../ats/adapters/talentRecruiter.js';
import { enrichRetainedPostingEvidence } from '../lib/postingEvidence.js';
import { htmlToPlainText } from '../lib/html.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import type { NormalizedJob } from '../types.js';

type Context = { externalId: string; url: string; observedAt: Date; config: Record<string, unknown> };
type Reason = 'RAW_MISSING' | 'READER_UNQUALIFIED' | 'NATIVE_ID_MISSING' | 'CONTENT_MISSING' |
  'RAW_SCHEMA_INVALID' | 'IDENTITY_MISMATCH' | 'DETAIL_IDENTITY_MISMATCH' | 'DETAIL_EVIDENCE_UNUSABLE' | 'PUBLICATION_HELD';
export type Recovery = { status: 'RECOVERABLE'; job: NormalizedJob; rawHash: string; outputHash: string } |
  { status: 'RECOLLECT_OR_REVIEW'; reason: Reason };
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown) => typeof value === 'string' && !!value.trim() || typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const failure = (reason: Reason): Recovery => ({ status: 'RECOLLECT_OR_REVIEW', reason });
const jobPosting = (node: Record<string, unknown>) => node['@type'] === 'JobPosting' || Array.isArray(node['@type']) && node['@type'].includes('JobPosting');

/** IDs as declared by these two collectors' own detail-page URLs. No ID is
 * borrowed from a database row or another job's schema.org identifier. */
function detailIdentity(kind: 'icims' | 'altamira', url: URL, raw: Record<string, unknown>): string | undefined {
  if (kind === 'icims') return /^\/jobs\/(\d+)\/(?:[^/]+\/)?job$/.exec(url.pathname)?.[1];
  if (url.pathname !== '/jobs/job-details' || url.searchParams.getAll('JobID').length !== 1 ||
    url.searchParams.getAll('Team').length !== 1 || url.searchParams.get('Team') !== raw.team) return undefined;
  const id = url.searchParams.get('JobID');
  return id && /^\d+$/.test(id) ? id : undefined;
}

/** Reuses the collector's reader, with only this publication's retained RAW.
 * This does not attest current availability or fabricate a native HTTP capture.
 * Unknown formats and missing content remain explicit recovery work. */
export function recoverRetainedPublication(kind: string, raw: unknown, context: Context): Recovery {
  return readRetainedPublication(kind, raw, context, true);
}

/** A missing description can prevent presentation without disproving an identity.
 * All native ID, URL, tenant and publication-state checks still run. */
export function retainedPublicationIdentity(kind: string, raw: unknown, context: Context):
  { status: 'VERIFIED'; rawHash: string } | Extract<Recovery, { status: 'RECOLLECT_OR_REVIEW' }> {
  const result = readRetainedPublication(kind, raw, context, false);
  return result.status === 'RECOVERABLE' ? { status: 'VERIFIED', rawHash: result.rawHash } : result;
}

function readRetainedPublication(kind: string, raw: unknown, context: Context, requireContent: boolean): Recovery {
  if (!object(raw)) return failure('RAW_MISSING');
  if (!Number.isFinite(context.observedAt.getTime())) return failure('RAW_SCHEMA_INVALID');
  const { config } = context;
  let job: NormalizedJob | null | undefined;
  try {
    switch (kind) {
      case 'ashby':
        if (!identifier(raw.id ?? raw.jobUrl)) return failure('NATIVE_ID_MISSING');
        job = parseAshbyJob(raw, String(config.board ?? config.slug ?? ''), context.observedAt); break;
      case 'lever':
        if (!identifier(raw.id)) return failure('NATIVE_ID_MISSING');
        job = parseLeverJob(raw as Parameters<typeof parseLeverJob>[0], config); break;
      case 'jibe':
        if (!identifier(raw.req_id ?? raw.slug)) return failure('NATIVE_ID_MISSING');
        if (typeof config.origin !== 'string') return failure('RAW_SCHEMA_INVALID');
        job = parseJibePage({ jobs: [{ data: raw }] }, config.origin)[0]; break;
      case 'phenom':
        if (!identifier(raw.slug ?? raw.req_id)) return failure('NATIVE_ID_MISSING');
        if (typeof config.origin !== 'string') return failure('RAW_SCHEMA_INVALID');
        job = parsePhenomJob(raw, config.origin, config); break;
      case 'lvmh_algolia':
        if (raw.source === 'oraclehcm') return failure('READER_UNQUALIFIED');
        if (!identifier(raw.objectID ?? raw.atsId)) return failure('NATIVE_ID_MISSING');
        job = parseLvmhHit(raw); break;
      case 'teamtailor':
        if (!identifier(raw.id)) return failure('NATIVE_ID_MISSING');
        job = parseTeamtailorJob(raw, typeof config.jobOrigin === 'string' ? config.jobOrigin : undefined); break;
      case 'workday': {
        if (typeof raw.externalPath !== 'string' || !raw.externalPath.startsWith('/job/')) return failure('NATIVE_ID_MISSING');
        if (!object(raw.detail) || !workdayDetailMatchesListing({ externalId: context.externalId, url: context.url, raw }, raw.detail)) return failure('DETAIL_IDENTITY_MISMATCH');
        job = parseWorkdayPublication(raw as Parameters<typeof parseWorkdayPublication>[0], config, context.observedAt);
        // lastSeenAt does not prove when this legacy relative-date string was
        // captured. Only the retained absolute publisher date can date it.
        if (job && !raw.detail.jobPostingInfo.startDate) job.postedAt = undefined;
        break;
      }
      case 'greenhouse':
        if (!identifier(raw.id)) return failure('NATIVE_ID_MISSING');
        job = parseGreenhouseJob(raw as Parameters<typeof parseGreenhouseJob>[0]); break;
      case 'recruitee':
        if (!identifier(raw.id)) return failure('NATIVE_ID_MISSING');
        job = parseRecruiteeJob(raw as Parameters<typeof parseRecruiteeJob>[0], String(config.subdomain ?? '')); break;
      case 'generic-listing': case 'radancy':
        if (!jobPosting(raw)) return failure('READER_UNQUALIFIED');
        if (typeof raw.url !== 'string') return failure('NATIVE_ID_MISSING');
        job = normalizeGenericPosting(raw, raw.url); break;
      case 'icims': case 'altamira': {
        const evidence = raw.postingEvidence;
        if (raw.source !== kind || !object(evidence) || !object(evidence.jobPosting) ||
          evidence.jobPostingCount !== 1 || !jobPosting(evidence.jobPosting) ||
          typeof evidence.htmlSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.htmlSha256) ||
          (evidence.geographyConflict !== undefined && typeof evidence.geographyConflict !== 'boolean') ||
          evidence.geographyConflict === true) return failure('DETAIL_EVIDENCE_UNUSABLE');
        if (typeof evidence.pageUrl !== 'string' || typeof config.origin !== 'string') return failure('DETAIL_IDENTITY_MISMATCH');
        const page = new URL(evidence.pageUrl);
        const id = detailIdentity(kind, page, raw);
        if (!id || page.href !== new URL(context.url).href || page.origin !== new URL(config.origin).origin) return failure('DETAIL_IDENTITY_MISMATCH');
        // Some pages declare the same job URL without the iCIMS iframe query.
        // Compare the native ID and tenant; keep the recorded collection URL.
        if (evidence.jobPosting.url != null) {
          if (typeof evidence.jobPosting.url !== 'string') return failure('DETAIL_IDENTITY_MISMATCH');
          const declared = new URL(evidence.jobPosting.url);
          if (declared.origin !== page.origin || declared.username || declared.password || detailIdentity(kind, declared, raw) !== id) return failure('DETAIL_IDENTITY_MISMATCH');
        }
        const parsed = normalizeJobPosting(evidence.jobPosting, evidence.pageUrl);
        job = parsed ? { ...parsed, externalId: id, url: evidence.pageUrl } : null;
        break;
      }
      case 'magnet':
        if (!identifier(raw.id ?? raw.reference)) return failure('NATIVE_ID_MISSING');
        job = normalizeMagnetOffer(raw, String(config.origin ?? '')); break;
      case 'rituals':
        if (!identifier(raw.jobAdId)) return failure('NATIVE_ID_MISSING');
        job = parseRitualsHit(raw, typeof config.origin === 'string' ? config.origin : undefined,
          typeof config.language === 'string' ? config.language : undefined); break;
      case 'wordpress':
        if (!identifier(raw.id ?? raw.link)) return failure('NATIVE_ID_MISSING');
        job = parseWordpressPost(raw); break;
      case 'geodirectory':
        if (!identifier(raw.id)) return failure('NATIVE_ID_MISSING');
        job = normalizeGeoDirPost(raw as Parameters<typeof normalizeGeoDirPost>[0]); break;
      case 'talentsoft':
        if (typeof raw.link !== 'string') return failure('NATIVE_ID_MISSING');
        job = talentsoftItemToJob(raw); break;
      case 'typesense':
        if (typeof raw.url !== 'string') return failure('NATIVE_ID_MISSING');
        job = docToJob(raw as Parameters<typeof docToJob>[0]); break;
      case 'workable':
        if (!identifier(raw.shortcode)) return failure('NATIVE_ID_MISSING');
        job = parseWorkableJob(raw, String(config.account ?? config.slug ?? '')); break;
      case 'oraclehcm': {
        if (raw.source !== 'oraclehcm' || !object(raw.list) || !identifier(raw.list.Id)) return failure('NATIVE_ID_MISSING');
        if (!object(raw.detail) || !identifier(raw.detail.Id) || String(raw.detail.Id) !== String(raw.list.Id)) return failure('DETAIL_IDENTITY_MISMATCH');
        const site = String(config.siteNumber ?? config.site ?? '');
        if (typeof config.origin !== 'string' || !site || raw.site !== site) return failure('IDENTITY_MISMATCH');
        job = mergeDetail(normalizeListRequisition(raw.list as Parameters<typeof normalizeListRequisition>[0], config.origin, site, String(config.lang ?? 'en')), raw.detail); break;
      }
      case 'jobaffinity-wordpress': {
        if (!object(raw.board?.row) || !object(raw.post) || !identifier(raw.post.id)) return failure('NATIVE_ID_MISSING');
        if (raw.board.url !== config.listingUrl) return failure('IDENTITY_MISMATCH');
        const application = raw.applicationEvidence;
        if (!object(application) || application.state !== 'OPEN' || application.status !== 200 || application.formAction !== context.url) return failure('PUBLICATION_HELD');
        job = normalizeJobaffinityPost(raw.board.row, raw.post, config as Parameters<typeof normalizeJobaffinityPost>[2], raw.geographyEvidence ?? undefined);
        applyJobaffinityEvidence(job, { ...application } as Parameters<typeof applyJobaffinityEvidence>[1]); break;
      }
      case 'flatchr':
        if (!object(raw.vacancy) || !object(raw.vacancy.company) || !identifier(raw.vacancy.id) || !identifier(raw.vacancy.company.id)) return failure('NATIVE_ID_MISSING');
        if (raw.published !== true || raw.status !== 'published') return failure('PUBLICATION_HELD');
        if (typeof config.listingUrl !== 'string') return failure('RAW_SCHEMA_INVALID');
        job = parseFlatchrItem(raw, config.listingUrl); break;
      case 'personio':
        if (!identifier(raw.id)) return failure('NATIVE_ID_MISSING');
        // This retained format is the complete XML position. Later native page
        // enrichments have a separate shape and must not be silently discarded.
        if (raw.personioDetail != null || raw.postingEvidence != null) return failure('READER_UNQUALIFIED');
        if (typeof config.host !== 'string') return failure('RAW_SCHEMA_INVALID');
        job = parsePersonioPosition(raw, config.host); break;
      case 'jobylon': {
        if (raw.source !== 'jobylon' || !object(raw.listing) || !identifier(raw.listing.externalId) || typeof raw.listing.path !== 'string') return failure('NATIVE_ID_MISSING');
        if (!object(raw.posting) || !jobPosting(raw.posting)) return failure('CONTENT_MISSING');
        const page = new URL(raw.listing.path, 'https://emp.jobylon.com');
        if (page.origin !== 'https://emp.jobylon.com' || /^\/jobs\/(\d+)-/.exec(page.pathname)?.[1] !== String(raw.listing.externalId) ||
          raw.posting.url != null && (typeof raw.posting.url !== 'string' || new URL(raw.posting.url).href !== page.href)) return failure('DETAIL_IDENTITY_MISMATCH');
        job = parseJobylonPublication(raw.listing as Parameters<typeof parseJobylonPublication>[0], raw.posting, page.href); break;
      }
      case 'talentview': {
        if (!identifier(raw.id) || typeof raw.slug !== 'string' || !raw.slug) return failure('NATIVE_ID_MISSING');
        if (!object(raw.detail) || !identifier(raw.detail.id) || String(raw.detail.id) !== String(raw.id) || raw.detail.slug !== raw.slug) return failure('DETAIL_IDENTITY_MISMATCH');
        if (typeof config.slug !== 'string') return failure('RAW_SCHEMA_INVALID');
        const listed = parseTalentViewCampaign(raw, config.slug);
        job = listed ? mergeTalentViewDetail(listed, raw.detail) : null; break;
      }
      case 'talentfunnel': {
        const vacancy = raw.vacancy;
        if (!object(vacancy) || !identifier(vacancy.id ?? vacancy.vacancyId)) return failure('NATIVE_ID_MISSING');
        if (typeof config.origin !== 'string' || typeof config.tenant !== 'string') return failure('RAW_SCHEMA_INVALID');
        const id = vacancy.id ?? vacancy.vacancyId;
        if (vacancy.tenant !== config.tenant || vacancy.vacancyId != null && vacancy.vacancyId !== id) return failure('IDENTITY_MISMATCH');
        if (raw.detail != null && (!object(raw.detail) || raw.detail.id !== id || raw.detail.tenant !== vacancy.tenant)) return failure('DETAIL_IDENTITY_MISMATCH');
        job = parseTalentFunnelVacancy(vacancy, config.origin, raw.detail ?? undefined); break;
      }
      case 'volcanic':
        if (!identifier(raw.id) || typeof raw.cached_slug !== 'string' || !raw.cached_slug) return failure('NATIVE_ID_MISSING');
        if (typeof config.origin !== 'string') return failure('RAW_SCHEMA_INVALID');
        job = parseVolcanicPage({ jobs: [raw] }, config.origin)[0];
        if (job && raw.postingEvidence != null) {
          if (!object(raw.postingEvidence)) return failure('DETAIL_EVIDENCE_UNUSABLE');
          job = enrichRetainedPostingEvidence(job, raw.postingEvidence);
          if (!job) return failure('DETAIL_EVIDENCE_UNUSABLE');
        }
        break;
      case 'easycruit': {
        if (!object(raw.listing) || !identifier(raw.listing['@_id'])) return failure('NATIVE_ID_MISSING');
        if (!object(raw.detail) || raw.detail['@_id'] !== raw.listing['@_id']) return failure('DETAIL_IDENTITY_MISMATCH');
        job = parseEasycruitVacancy(raw.listing, raw.detail, config);
        if (raw.postingEvidence != null) {
          if (!object(raw.postingEvidence)) return failure('DETAIL_EVIDENCE_UNUSABLE');
          job = enrichRetainedPostingEvidence(job, raw.postingEvidence);
          if (!job) return failure('DETAIL_EVIDENCE_UNUSABLE');
        }
        break;
      }
      case 'harri': {
        if (!object(raw.listing) || !identifier(raw.listing.id)) return failure('NATIVE_ID_MISSING');
        if (!object(raw.detail) || raw.detail.id !== raw.listing.id || raw.detailUrl !== `https://gateway.harri.com/core-reader/api/v1/profile/job/${raw.listing.id}`) return failure('DETAIL_IDENTITY_MISMATCH');
        if (!object(raw.portal) || typeof raw.portal.slug !== 'string') return failure('RAW_SCHEMA_INVALID');
        const portal = new URL(String(config.portalUrl ?? `https://harri.com/${config.slug ?? ''}`));
        const slug = portal.pathname.split('/').filter(Boolean)[0];
        if (!['harri.com', 'www.harri.com'].includes(portal.host) || portal.protocol !== 'https:' || portal.username || portal.password || !slug ||
          raw.portal.slug.toLowerCase() !== slug.toLowerCase() || config.slug != null && String(config.slug).toLowerCase() !== slug.toLowerCase() ||
          config.brandId != null && Number(config.brandId) !== raw.portal.id) return failure('IDENTITY_MISMATCH');
        job = parseHarriPublication(raw.listing as Parameters<typeof parseHarriPublication>[0], raw.detail as Parameters<typeof parseHarriPublication>[1],
          raw.portal as Parameters<typeof parseHarriPublication>[2], String(config.employerMode ?? 'POSTING_BRAND'), context.observedAt); break;
      }
      case 'talentrecruiter': {
        if (!object(raw.position) || !identifier(raw.position.Id)) return failure('NATIVE_ID_MISSING');
        if (typeof config.customer !== 'string' || typeof raw.position.CustomerAlias !== 'string' || raw.position.CustomerAlias.toLowerCase() !== config.customer.toLowerCase()) return failure('IDENTITY_MISMATCH');
        if (config.portalUrl != null) {
          const portal = new URL(String(config.portalUrl));
          if (portal.protocol !== 'https:' || portal.host !== 'candidate.hr-manager.net' || portal.username || portal.password || portal.pathname.toLowerCase() !== '/vacancies/list.aspx' ||
            portal.searchParams.getAll('customer').length !== 1 || portal.searchParams.get('customer')?.toLowerCase() !== config.customer.toLowerCase()) return failure('IDENTITY_MISMATCH');
        }
        if (raw.mapAddress != null && typeof raw.mapAddress !== 'string') return failure('RAW_SCHEMA_INVALID');
        job = parseTalentRecruiterPosition(raw.position as Parameters<typeof parseTalentRecruiterPosition>[0], config.customer, raw.mapAddress as string | undefined); break;
      }
      default: return failure('READER_UNQUALIFIED');
    }
    if (!job || typeof job.title !== 'string' || !job.title.trim()) return failure('RAW_SCHEMA_INVALID');
    const url = new URL(job.url);
    if (job.externalId !== context.externalId || url.href !== new URL(context.url).href ||
      !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return failure('IDENTITY_MISMATCH');
    if (job.publicationHold || job.publicationWithdrawnAt) return failure('PUBLICATION_HELD');
    if (requireContent && (typeof job.description !== 'string' || !htmlToPlainText(job.description)?.trim())) return failure('CONTENT_MISSING');
    for (const date of [job.postedAt, job.validThrough]) if (date && !Number.isFinite(date.getTime())) return failure('RAW_SCHEMA_INVALID');
    // Keep exactly the persisted input, including unknown native fields.
    job = { ...job, url: context.url, raw };
    return { status: 'RECOVERABLE', job, rawHash: evidenceHash(raw), outputHash: evidenceHash(job) };
  } catch { return failure('RAW_SCHEMA_INVALID'); }
}
