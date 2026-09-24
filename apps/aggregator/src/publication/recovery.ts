import { parseAshbyJob } from '../ats/adapters/ashby.js';
import { applyAvatureJobData } from '../ats/adapters/avature.js';
import { parseLeverJob } from '../ats/adapters/lever.js';
import { parseJibePage } from '../ats/adapters/jibe.js';
import { parseCareerConnectJob, parsePhenomJob, phenomDialect, type CareerConnectJob } from '../ats/adapters/phenom.js';
import { parseLvmhHit } from '../ats/adapters/lvmhAlgolia.js';
import { toNormalized as parseTeamtailorJob } from '../ats/adapters/teamtailor.js';
import { parseWorkdayPublication } from '../ats/adapters/workday.js';
import { workdayDetailMatchesListing } from '../identity/workday.js';
import { icimsDetailMatchesListing } from '../identity/icims.js';
import { parseGreenhouseJob } from '../ats/adapters/greenhouse.js';
import { parseRecruiteeJob } from '../ats/adapters/recruitee.js';
import { normalizeGenericPosting } from '../ats/adapters/genericJsonLd.js';
import { readCaudalieRaw } from '../ats/adapters/caudalie.js';
import { descriptionFromJobAd, parseSmartRecruitersPosting, type PostingDetail, type SmartRecruitersPosting } from '../ats/adapters/smartrecruiters.js';
import { applySuccessFactorsDetail, brandPropertyOf, normalizeRmkItem, splitSlug, type RetainedSuccessFactorsDetail, type RmkV2Item } from '../ats/adapters/successfactors.js';
import { normalizeAnnouncement, type DrItem } from '../ats/adapters/digitalrecruiters.js';
import { personioDetailFromEvidence } from '../ats/adapters/personioDetail.js';
import { normalizeJobPosting } from '../connectors/generic/jsonLdSitemap.js';
import { parseFeed } from '../connectors/generic/rssFeed.js';
import { normalizeMagnetOffer } from '../ats/adapters/magnet.js';
import { parseRitualsHit } from '../ats/adapters/rituals.js';
import { parseWordpressPost } from '../ats/adapters/wordpress.js';
import { normalizeGeoDirPost } from '../ats/adapters/geodirectory.js';
import { type RssItem, type TalentsoftDetail, applyTalentsoftDetail, listingCardJob, talentsoftItemToJob } from '../ats/adapters/talentsoft.js';
import { applyVacancyDetail, docToJob } from '../ats/adapters/rivoliTypesense.js';
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
import { toNormalized as toEightfoldJob } from '../ats/adapters/eightfold.js';
import { parseBashListing, parseBashDetail } from '../ats/adapters/bashTalents.js';
import { parseTaleoListing, applyTaleoDetail } from '../ats/adapters/taleo.js';
import { parseWttjHit, wttjCanonicalId, descriptionFromApi, type WttjHit } from '../ats/adapters/wttj.js';
import { parseEqwaDetail, eqwaRowToJob, type EqwaListingJob } from '../ats/adapters/eqwa.js';
import { enrichRetainedPostingEvidence, postingEvidenceOptions } from '../lib/postingEvidence.js';
import { htmlToPlainText } from '../lib/html.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import type { NormalizedJob } from '../types.js';
import { employerFromCertifiedScope } from '../identity/portalEmployer.js';

type Context = { externalId: string; url: string; observedAt: Date; config: Record<string, unknown>;
  /** Trusted registry context, never a field inferred from the publication or its settings. */
  certifiedPortal?: { ownerName: string; scope: 'SINGLE_BRAND' | 'MULTI_BRAND' } };
/**
 * Les motifs de refus qui portent sur UNE publication, jamais sur le lot.
 *
 * Exportée pour que `sourceValidation` sache lesquels son seuil de tolérance peut couvrir
 * Une annonce refusée reste non publiable. La politique de qualification décide si le
 * sous-ensemble fiable peut être publié ; seule la preuve d'énumération peut autoriser
 * des fermetures. Cette liste est partagée avec le validateur.
 */
export const PER_PUBLICATION_REASONS = ['RAW_MISSING', 'READER_UNQUALIFIED', 'NATIVE_ID_MISSING', 'CONTENT_MISSING',
  'RAW_SCHEMA_INVALID', 'IDENTITY_MISMATCH', 'DETAIL_IDENTITY_MISMATCH', 'DETAIL_EVIDENCE_UNUSABLE', 'PUBLICATION_HELD'] as const;
type Reason = (typeof PER_PUBLICATION_REASONS)[number];
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
      case 'wttj': case 'wttj-sector': {
        if (!wttjCanonicalId(raw as WttjHit)) return failure('NATIVE_ID_MISSING');
        const slug = typeof config.slug === 'string' ? config.slug : raw.organization?.slug;
        if (typeof slug !== 'string' || !slug) return failure('RAW_SCHEMA_INVALID');
        job = parseWttjHit(raw as WttjHit, slug);
        if (job && raw.detail !== undefined) {
          const expected = `https://api.welcometothejungle.com/api/v1/organizations/${raw.organization?.slug ?? slug}/jobs/${raw.slug}`;
          // The search UUID is detail.wttj_reference; detail.reference is a
          // distinct short business reference in current native responses.
          const detailReference = raw.detail?.wttj_reference ?? raw.detail?.reference;
          if (!object(raw.detail) || raw.detailUrl !== expected ||
            detailReference != null && raw.reference && detailReference !== raw.reference ||
            raw.detail.slug && raw.detail.slug !== raw.slug) return failure('DETAIL_IDENTITY_MISMATCH');
          const full = descriptionFromApi(raw.detail);
          if (full && full.length > (job.description?.length ?? 0)) job.description = full;
        }
        break;
      }
      case 'bashtalents': case 'taleo': {
        if (kind === 'bashtalents') {
          if (raw.source !== 'bash-talents' || typeof raw.listingBlock !== 'string') return failure('RAW_SCHEMA_INVALID');
          const rows = parseBashListing('<div class="job-wrapper" attr-href="' + raw.listingBlock).jobs;
          if (rows.length !== 1) return failure('RAW_SCHEMA_INVALID');
          job = rows[0];
        } else {
          if (raw.source !== 'taleo-tbe' || typeof raw.listingHtml !== 'string') return failure('RAW_SCHEMA_INVALID');
          const rows = parseTaleoListing(raw.listingHtml);
          if (rows.length !== 1) return failure('RAW_SCHEMA_INVALID');
          job = rows[0];
        }
        if (typeof raw.detailHtml === 'string') {
          if (raw.detailUrl !== job.url) return failure('DETAIL_IDENTITY_MISMATCH');
          if (kind === 'taleo') job = applyTaleoDetail(job, raw.detailHtml);
          else {
            const detail = parseBashDetail(raw.detailHtml);
            job = { ...job, description: detail.description ?? job.description, postedAt: detail.postedAt ?? job.postedAt };
          }
        }
        break;
      }
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
      case 'phenom': {
        if (typeof config.origin !== 'string') return failure('RAW_SCHEMA_INVALID');
        // Le dialecte est celui de la configuration, jamais deviné depuis la ligne (lot F3b : Hugo Boss, 671 lignes
        // CareerConnect refusées NATIVE_ID_MISSING par le seul lecteur `api/jobs`). CareerConnect retient l'entrée de
        // liste (`jobSeqNo`, teaser) et, quand la fiche l'a fournie, l'évidence JSON-LD appliquée comme le collecteur.
        let dialect: ReturnType<typeof phenomDialect>;
        try { dialect = phenomDialect(config); } catch { return failure('READER_UNQUALIFIED'); }
        if (dialect === 'CAREER_CONNECT_WIDGETS') {
          if (!identifier(raw.jobSeqNo)) return failure('NATIVE_ID_MISSING');
          const { postingEvidence, ...entry } = raw;
          job = parseCareerConnectJob(entry as CareerConnectJob, config.origin, { localePath: typeof config.localePath === 'string' ? config.localePath : undefined });
          if (job && postingEvidence != null) { job = object(postingEvidence) ? enrichRetainedPostingEvidence(job, postingEvidence) : null; if (!job) return failure('DETAIL_EVIDENCE_UNUSABLE'); }
          break;
        }
        if (!identifier(raw.slug ?? raw.req_id)) return failure('NATIVE_ID_MISSING');
        job = parsePhenomJob(raw, config.origin, config); break;
      }
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
      case 'generic-listing': case 'generic-jsonld': case 'radancy': {
        if (config.reader === 'caudalie-ajax' && raw.source === 'caudalie-ajax-v1') {
          job = readCaudalieRaw(raw); break;
        }
        if (typeof config.feedUrl === 'string' && typeof raw.feedItem === 'string') {
          const items = parseFeed(raw.feedItem);
          if (items.length !== 1 || (items[0].raw as { feedItem: string }).feedItem !== raw.feedItem) return failure('RAW_SCHEMA_INVALID');
          job = items[0]; break;
        }
        if (!jobPosting(raw)) return failure('READER_UNQUALIFIED');
        // The identity is the crawled page, retained as `catwalksPageUrl` since lot F3b; an older RAW without it reads
        // the posting's own `url`, and a posting declaring no URL was published at the page it was read from.
        const { catwalksPageUrl, ...node } = raw;
        const pageUrl = typeof catwalksPageUrl === 'string' ? catwalksPageUrl : typeof raw.url === 'string' ? raw.url : context.url;
        job = normalizeGenericPosting(node, pageUrl); break;
      }
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
        if (!id || page.href !== new URL(context.url).href || (kind === 'icims'
          ? !icimsDetailMatchesListing({ externalId: id, url: context.url, raw }, config)
          : page.origin !== new URL(config.origin).origin)) return failure('DETAIL_IDENTITY_MISMATCH');
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
      case 'talentsoft': {
        // Trois formes retenues : un article RSS seul (`link`, gabarit historique et listing illisible) ; depuis le lot F3b,
        // une carte du listing (`path`, `id`, `title`, `cells`) avec, le cas échéant, l'article RSS apparié (`rss`) et la
        // description de la fiche (`talentsoftDetail`), appliqués dans l'ordre du collecteur, sans réseau.
        if (typeof raw.link === 'string') {
          job = talentsoftItemToJob(raw as RssItem);
          if (raw.talentsoftDetail != null) {
            const d=raw.talentsoftDetail;
            if (!job || !object(d) || d.pageUrl !== job.url || typeof d.htmlSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(d.htmlSha256) || typeof d.description !== 'string') return failure('DETAIL_EVIDENCE_UNUSABLE');
            job=applyTalentsoftDetail(job,d as TalentsoftDetail);
          }
          break;
        }
        if (typeof raw.path !== 'string' || !/_\d+\.aspx$/i.test(raw.path)) return failure('NATIVE_ID_MISSING');
        if (typeof config.origin !== 'string' || !config.origin) return failure('RAW_SCHEMA_INVALID');
        // Une carte d'avant le lot F3b ne retient que son lien : son identité est là, son contenu natif ne l'est pas.
        if (typeof raw.title !== 'string' || !Array.isArray(raw.cells) || raw.cells.some(cell => typeof cell !== 'string')) return failure('CONTENT_MISSING');
        const { rss, talentsoftDetail, ...card } = raw;
        if (/_(\d+)\.aspx$/i.exec(raw.path)?.[1] !== String(raw.id)) return failure('IDENTITY_MISMATCH');
        job = listingCardJob({ path: raw.path, id: String(raw.id), title: raw.title, cells: raw.cells as string[] }, config.origin.replace(/\/$/, ''));
        if (rss != null) {
          if (!object(rss) || typeof rss.link !== 'string') return failure('DETAIL_EVIDENCE_UNUSABLE');
          const item = talentsoftItemToJob(rss as RssItem);
          if (!item || item.externalId !== job.externalId) return failure('DETAIL_IDENTITY_MISMATCH');
          job = { ...job, ...item, url: job.url, location: item.location ?? job.location, raw: { ...card, rss } };
        }
        if (talentsoftDetail != null) {
          if (!object(talentsoftDetail) || talentsoftDetail.pageUrl !== job.url || typeof talentsoftDetail.htmlSha256 !== 'string' ||
            !/^[a-f0-9]{64}$/.test(talentsoftDetail.htmlSha256) || typeof talentsoftDetail.description !== 'string') return failure('DETAIL_EVIDENCE_UNUSABLE');
          job = applyTalentsoftDetail(job, talentsoftDetail as TalentsoftDetail);
        }
        break;
      }
      case 'typesense': {
        if (typeof raw.url !== 'string') return failure('NATIVE_ID_MISSING');
        const { vacancyDetail, ...document } = raw;
        job = docToJob(document as Parameters<typeof docToJob>[0]);
        if (vacancyDetail != null) {
          if (!object(vacancyDetail) || typeof vacancyDetail.pageUrl !== 'string' || typeof vacancyDetail.html !== 'string' ||
            typeof config.origin !== 'string') return failure('DETAIL_EVIDENCE_UNUSABLE');
          job = applyVacancyDetail(document as Parameters<typeof docToJob>[0], config.origin,
            { pageUrl: vacancyDetail.pageUrl, html: vacancyDetail.html });
          if (!job) return failure('DETAIL_IDENTITY_MISMATCH');
        }
        break;
      }
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
      case 'personio': {
        if (!identifier(raw.id)) return failure('NATIVE_ID_MISSING');
        if (typeof config.host !== 'string') return failure('RAW_SCHEMA_INVALID');
        // The XML position is read first; the retained detail-page evidence (JSON-LD `postingEvidence`, then the Next
        // flight model `personioDetail`, lot F3b) is applied in the collector's order, never read from a live page.
        const { personioDetail: detailEvidence, postingEvidence, detailReadError: _readError, ...position } = raw;
        job = parsePersonioPosition(position, config.host);
        if (job && postingEvidence != null) { job = object(postingEvidence) ? enrichRetainedPostingEvidence(job, postingEvidence) : null; if (!job) return failure('DETAIL_EVIDENCE_UNUSABLE'); }
        if (job && detailEvidence != null) {
          // Only the shape this reader knows (the Next flight read, with its page hash) is applied; any other enrichment shape stays unqualified.
          if (!object(detailEvidence) || detailEvidence.method !== 'PERSONIO_NEXT_FLIGHT' || typeof detailEvidence.htmlSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(detailEvidence.htmlSha256)) return failure('READER_UNQUALIFIED');
          const detail = personioDetailFromEvidence(detailEvidence);
          if (detail) {
            const employer = job.company ? undefined : detail.employer;
            job = { ...job, ...(employer ? { company: employer, employerEvidence: { rawName: employer, path: 'raw.personioDetail.careerSiteSettings.company_name', rule: 'EXPLICIT_PERSONIO_PORTAL_EMPLOYER' } } : {}),
              postedAt: detail.postedAt ?? job.postedAt, description: detail.description ?? job.description, country: job.country ?? detail.country, city: job.city ?? detail.city };
          }
        }
        break;
      }
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
      case 'smartrecruiters-whitelabel': case 'smartrecruiters': {
        if (!identifier(raw.id)) return failure('NATIVE_ID_MISSING');
        if (typeof config.company !== 'string' || !config.company) return failure('RAW_SCHEMA_INVALID');
        // The listing entry names the posting; the advert retained from /postings/{id} (`jobAd`, lot F3b) carries its text.
        const { jobAd, ...posting } = raw;
        if (jobAd != null && !object(jobAd)) return failure('DETAIL_EVIDENCE_UNUSABLE');
        job = parseSmartRecruitersPosting(posting as SmartRecruitersPosting, config.company, typeof config.employerField === 'string' ? config.employerField : undefined);
        job = { ...job, description: descriptionFromJobAd(jobAd as PostingDetail['jobAd'] | undefined) }; break;
      }
      case 'successfactors': {
        if (typeof config.origin !== 'string' || !config.origin) return failure('RAW_SCHEMA_INVALID');
        const origin = config.origin.replace(/\/$/, '');
        const { postingEvidence, detailReadError: _readError, ...rest } = raw;
        if (raw.source === 'successfactors-rmk-v2') {
          if (!identifier(raw.id)) return failure('NATIVE_ID_MISSING');
          if (typeof raw.locale !== 'string') return failure('RAW_SCHEMA_INVALID');
          /*
           * LA FICHE DE DÉTAIL S'APPLIQUE AUSSI AU DIALECTE RMK (19/09/2026).
           *
           * `successfactorsDetail` est retenu par les DEUX dialectes — le collecteur le fusionne
           * de la même façon (`applySuccessFactorsDetail`, « the same merge serves the live
           * collector and the retained-publication reader »). Mais seule la branche HTML
           * l'appliquait ici : le dialecte RMK reconstruisait l'offre depuis la seule entrée de
           * liste, qui ne porte aucune description.
           *
           * Mesuré sur `douglas-sf` : 311 offres, RAW portant `successfactorsDetail`, offre
           * collectée avec 1 687 caractères de description — et rejeu refusé CONTENT_MISSING.
           * Même cas sur `breitling-sf` et `goyard-successfactors`.
           */
          const { successfactorsDetail, ...rmk } = rest;
          job = normalizeRmkItem(rmk as RmkV2Item, raw.locale, origin);
          if (job && successfactorsDetail != null) {
            if (!object(successfactorsDetail)) return failure('DETAIL_EVIDENCE_UNUSABLE');
            job = applySuccessFactorsDetail(job, successfactorsDetail as RetainedSuccessFactorsDetail, brandPropertyOf(config));
          }
        } else if (raw.source === 'successfactors') {
          // The HTML listing path (lot F3b): the listing link (id, path, slug) and the microdata detail are retained; an
          // older RAW without them (slug only) still carries no native identity.
          if (!identifier(raw.id) || typeof raw.path !== 'string' || typeof raw.slug !== 'string') return failure('NATIVE_ID_MISSING');
          const { successfactorsDetail, ...listing } = rest;
          const { city, title } = splitSlug(raw.slug);
          job = { externalId: String(raw.id), title, location: city, url: new URL(raw.path, origin).toString(), raw: listing };
          if (successfactorsDetail != null) {
            if (!object(successfactorsDetail)) return failure('DETAIL_EVIDENCE_UNUSABLE');
            job = applySuccessFactorsDetail(job, successfactorsDetail as RetainedSuccessFactorsDetail, brandPropertyOf(config));
          }
        } else return failure('READER_UNQUALIFIED');
        if (job && postingEvidence != null) { job = object(postingEvidence) ? enrichRetainedPostingEvidence(job, postingEvidence) : null; if (!job) return failure('DETAIL_EVIDENCE_UNUSABLE'); }
        break;
      }
      case 'digitalrecruiters': {
        if (!Array.isArray(raw.diffusions) || typeof raw.title !== 'string' || !raw.title.trim()) return failure('NATIVE_ID_MISSING');
        const domainName = String(config.domainName ?? config.origin ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!domainName) return failure('RAW_SCHEMA_INVALID');
        // The retained primary diffusion rebuilds the announcement; a locale only names the fallback path of a tenant without careers_site_url.
        const { postingEvidence, diffusions: _diffusions, locations: _locations, detailReadError: _readError, ...primary } = raw;
        const locales = [...new Set([config.locale, 'fr_FR', 'en_US'].filter((value): value is string => typeof value === 'string' && !!value))];
        job = locales.map(locale => normalizeAnnouncement([primary as DrItem], domainName, locale)).find(candidate => !!candidate && new URL(candidate.url).href === new URL(context.url).href) ?? null;
        if (!job) return failure('IDENTITY_MISMATCH');
        if (postingEvidence != null) { job = object(postingEvidence) ? enrichRetainedPostingEvidence(job, postingEvidence, postingEvidenceOptions(config)) : null; if (!job) return failure('DETAIL_EVIDENCE_UNUSABLE'); }
        break;
      }
      /*
       * DEUX FAMILLES QUE LE REJEU IGNORAIT (19/09/2026).
       *
       * `eightfold` et `eqwa` conservent leur entrée native ENTIÈRE dans `raw` — la position
       * Eightfold, la ligne de tableau Eqwa. Elles étaient pourtant absentes de ce `switch` et
       * tombaient donc dans `default`, c'est-à-dire READER_UNQUALIFIED : « je ne sais pas lire ce
       * format », alors que l'adaptateur du collecteur, lui, sait parfaitement le lire.
       *
       * Conséquence mesurée : Kering 1 035 offres et Nocibé 288 offres capturées, conservées, et
       * refusées à la validation sur NO_QUALIFIED_PUBLICATION — aucune n'ayant pu être relue.
       *
       * Les deux branches appellent le lecteur DU COLLECTEUR, jamais une relecture réécrite ici :
       * un second lecteur dériverait du premier sans que rien ne le signale.
       *
       * Ne sont PAS traités ici, faute de matière : `avature` conserve `{source, url}` et
       * `swatchgroup` `{legalEntity, logo, applyUrl, jsonLd}` — ni titre ni lieu, donc rien à
       * relire. Ces deux-là demandent de changer ce que l'adaptateur RETIENT, ce qui touche au
       * contrat de preuve et relève d'une décision du propriétaire.
       */
      case 'eightfold': {
        if (!identifier(raw.id ?? raw.displayJobId ?? raw.name)) return failure('NATIVE_ID_MISSING');
        const origin = String(config.origin ?? '').replace(/\/$/, '');
        if (!origin) return failure('RAW_SCHEMA_INVALID');
        /*
         * La fiche de détail est conservée à part (`eightfoldDetail`, 19/09/2026) : la position
         * de liste ne porte AUCUNE description. On la retire avant de relire la position, puis on
         * en tire la description avec le même lecteur que le collecteur.
         *
         * Un RAW d'avant ce changement n'a pas cette clé : l'offre se relit alors sans
         * description et le contrôle de contenu la refusera en CONTENT_MISSING — un verdict juste,
         * qui dit qu'il faut recollecter, et non « je ne sais pas lire ce format ».
         */
        const { eightfoldDetail, ...position } = raw;
        job = toEightfoldJob(position as Parameters<typeof toEightfoldJob>[0], origin);
        if (job && object(eightfoldDetail)) {
          const texte = eightfoldDetail.jobDescription ?? eightfoldDetail.job_description;
          if (typeof texte === 'string') job = { ...job, description: htmlToPlainText(texte) };
        }
        break;
      }
      case 'avature': {
        /*
         * Les champs lus sont conservés depuis le 19/09/2026 (`avature.ts`) : intitulé, lieu,
         * lien, description, et la fiche de détail sous `avaturePortalDetail` pour le mode
         * portail. Un RAW antérieur ne porte que `{source, url}` : il manque alors l'intitulé, et
         * le contrôle commun rendra RAW_SCHEMA_INVALID — ce qui dit « il faut recollecter », et
         * non « je ne sais pas lire ce format ».
         */
        if (typeof raw.title !== 'string' || !raw.title.trim() || !identifier(raw.externalId)) return failure('NATIVE_ID_MISSING');
        const detail = object(raw.avaturePortalDetail) ? raw.avaturePortalDetail : undefined;
        const date = raw.postedAt ?? detail?.postedAt;
        const quand = typeof date === 'string' || date instanceof Date ? new Date(date) : undefined;
        job = {
          externalId: String(raw.externalId),
          title: raw.title,
          url: typeof raw.url === 'string' ? raw.url : context.url,
          location: typeof detail?.rawLocation === 'string' ? detail.rawLocation : typeof raw.location === 'string' ? raw.location : undefined,
          city: typeof detail?.city === 'string' ? detail.city : undefined,
          region: typeof detail?.region === 'string' ? detail.region : undefined,
          description: typeof detail?.description === 'string' ? detail.description : typeof raw.description === 'string' ? raw.description : undefined,
          ...(quand && !Number.isNaN(quand.getTime()) ? { postedAt: quand } : {}),
          raw,
        };
        if (context.config.employerFromDataLayer === true && typeof raw.avatureJobData === 'string') {
          job = applyAvatureJobData(job, raw.avatureJobData);
        }
        break;
      }
      case 'swatchgroup': {
        // Idem : les champs lus sont conservés depuis le 19/09/2026 (`swatchgroup.ts`).
        if (typeof raw.title !== 'string' || !raw.title.trim() || typeof raw.url !== 'string') return failure('NATIVE_ID_MISSING');
        const quand = typeof raw.postedAt === 'string' ? new Date(raw.postedAt) : undefined;
        job = {
          externalId: context.externalId,
          title: raw.title,
          url: raw.url,
          location: typeof raw.location === 'string' ? raw.location : undefined,
          city: typeof raw.city === 'string' ? raw.city : undefined,
          region: typeof raw.region === 'string' ? raw.region : undefined,
          postalCode: typeof raw.postalCode === 'string' ? raw.postalCode : undefined,
          country: typeof raw.country === 'string' ? raw.country : undefined,
          contract: typeof raw.contract === 'string' ? raw.contract : undefined,
          language: typeof raw.language === 'string' ? raw.language : undefined,
          company: typeof raw.company === 'string' ? raw.company : undefined,
          description: typeof raw.description === 'string' ? raw.description : undefined,
          ...(quand && !Number.isNaN(quand.getTime()) ? { postedAt: quand } : {}),
          raw,
        };
        break;
      }
      case 'eqwa': {
        if (!identifier(raw.externalId) || typeof raw.title !== 'string' || !raw.title.trim()) return failure('NATIVE_ID_MISSING');
        // `postedAt` revient du stockage en chaîne ISO : le lecteur attend une Date.
        const { postedAt, ...reste } = raw;
        const date = typeof postedAt === 'string' || postedAt instanceof Date ? new Date(postedAt) : undefined;
        job = eqwaRowToJob({ ...(reste as EqwaListingJob), ...(date && !Number.isNaN(date.getTime()) ? { postedAt: date } : {}) },
          typeof raw.detailHtml === 'string' && raw.detailUrl === raw.url ? parseEqwaDetail(raw.detailHtml).description : undefined);
        if (raw.detailHtml !== undefined && raw.detailUrl !== raw.url) return failure('DETAIL_IDENTITY_MISMATCH');
        break;
      }
      default: return failure('READER_UNQUALIFIED');
    }
    if (!job || typeof job.title !== 'string' || !job.title.trim()) return failure('RAW_SCHEMA_INVALID');
    const url = new URL(job.url);
    if (job.externalId !== context.externalId || url.href !== new URL(context.url).href ||
      !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return failure('IDENTITY_MISMATCH');
    if (context.certifiedPortal) job = employerFromCertifiedScope(job, context.certifiedPortal.ownerName, context.certifiedPortal.scope);
    if (job.publicationHold || job.publicationWithdrawnAt) return failure('PUBLICATION_HELD');
    if (requireContent && (typeof job.description !== 'string' || !htmlToPlainText(job.description)?.trim())) return failure('CONTENT_MISSING');
    for (const date of [job.postedAt, job.validThrough]) if (date && !Number.isFinite(date.getTime())) return failure('RAW_SCHEMA_INVALID');
    // Keep exactly the persisted input, including unknown native fields.
    job = { ...job, url: context.url, raw };
    return { status: 'RECOVERABLE', job, rawHash: evidenceHash(raw), outputHash: evidenceHash(job) };
  } catch { return failure('RAW_SCHEMA_INVALID'); }
}
