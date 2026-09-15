import type { NormalizedJob } from '../types.js';
import type { AtsType } from '@prisma/client';
import type { SourceTier } from '@catwalks/db/publications';
import type { SourceFacts } from '@catwalks/db/source-facts';
import { postingIdentity, POSTING_IDENTITY_VERSION, APPLICATION_KEY_VERSION } from './postingIdentity.js';
import { workdayRequisitionIdentity } from '../identity/workday.js';
import { teamtailorPublicationIdentity } from '../identity/teamtailor.js';
import { icimsPublicationIdentity } from '../identity/icims.js';

export type CandidateJob = NormalizedJob & {
  sourceFacts?: SourceFacts;
  company: string;
  /** Exact adapter label before any spelling/identity heuristic. */
  rawEmployerName?: string;
  /** Exact adapter title before cleanTitle; payload remains in RAW. */
  rawTitle?: string;
  rawContract?: string;
  rawWorkingTime?: string;
  employmentEvidence?: Record<string,unknown>;
  employerLabelOrigin?: string;
  /** Resolved database identity key; never recompute it from the display name. */
  canonicalEmployerKey?: string;
  sourceKey: string;
  sourceTier: SourceTier;
  /**
   * The real ATS this posting came from, stored on Job.source. A sitemap/JSON-LD
   * source genuinely is GENERIC_JSONLD; an API feed carries its true vendor.
   * This is a protocol label. Native identity belongs to sourceKey/externalId.
   */
  atsType?: AtsType;
  /**
   * The Maison's own domain (`sephora.com`), when THIS source is the Maison's
   * careers site and names it — read off the catalogue, never guessed from the
   * name. Written to Company.domain if empty; it is what the logo is built from.
   */
  companyDomain?: string;
  /**
   * Les deux dimensions d'emploi, en projection de recherche — distinctes des
   * champs `contract`/`workingTime` de `NormalizedJob`, qui portent le mot BRUT
   * de la source. Un adaptateur remonte « Permanent » ; l'ingest en dérive
   * `employmentTerm: 'PERMANENT'` et c'est cette valeur-là qui est stockée.
   */
  employmentTerm?: string;
  workTime?: string;
  programType?: string;
  engagementType?: string;
  isSeasonal?: boolean;
  workplaceType?: string;
  /** Le RYTHME EXIGÉ, et le libellé source qui l'a justifié. */
  workSchedule?: string;
  rawSchedule?: string;
};

export type NativePublication = Pick<CandidateJob, 'sourceKey' | 'externalId' | 'url'> & { raw?: unknown };
export type IdentityProof = { version: typeof POSTING_IDENTITY_VERSION; rule: 'SAME_NATIVE_PUBLICATION' | 'QUALIFIED_APPLICATION_ID' | 'QUALIFIED_REQUISITION_ID' | 'QUALIFIED_FEED_POSTING_ID';
  identity: { tenant: string; requisition: string }; paths?: [string, string] };

function identityEvidence(publication: NativePublication) {
  const icims = icimsPublicationIdentity(publication);
  if (icims) return { identity: icims, path: '/postingEvidence/jobPosting/url' };
  const workday = workdayRequisitionIdentity(publication);
  if (workday) return { identity: workday, path: '/detail/jobPostingInfo/jobReqId' };
  const teamtailor = teamtailorPublicationIdentity(publication);
  if (teamtailor) return { identity: teamtailor, path: '/_jobposting/identifier/value' };
  const identity = postingIdentity(publication.url);
  if (!identity || !publication.raw || typeof publication.raw !== 'object' || Array.isArray(publication.raw)) return null;
  const raw = publication.raw as Record<string, any>;
  const matchesUrl = (value: unknown) => {
    const other = typeof value === 'string' ? postingIdentity(value) : undefined;
    return other?.tenant === identity.tenant && other?.requisition === identity.requisition;
  };
  let path: string | undefined;
  if (identity.tenant.startsWith('oraclehcm:')) {
    if (raw.source === 'oraclehcm' && raw.site === identity.tenant.split(':').at(-1) &&
      String(raw.list?.Id ?? '') === identity.requisition &&
      (raw.detail?.Id == null || String(raw.detail.Id) === identity.requisition)) path = '/list/Id';
    else if (raw.source !== 'oraclehcm' && String(raw.atsId ?? '') === identity.requisition && matchesUrl(raw.link)) path = '/link';
  } else if (identity.tenant === 'jobaffinity:jobaffinity.fr' && matchesUrl(raw.board?.row?.attrs?.['data-applyurl'])) {
    path = '/board/row/attrs/data-applyurl';
  }
  return path ? { identity, path } : null;
}

/** Only a qualified native identity can join independent publications. Titles,
 * job families, cities, dates and missing values never establish equivalence. */
export function publicationIdentityProof(a: NativePublication, b: NativePublication): IdentityProof | null {
  if (a.sourceKey === b.sourceKey) {
    return a.externalId === b.externalId
      ? { version: POSTING_IDENTITY_VERSION, rule: 'SAME_NATIVE_PUBLICATION', identity: { tenant: a.sourceKey, requisition: a.externalId } }
      : null;
  }
  const left = identityEvidence(a), right = identityEvidence(b);
  return left && right && left.identity.tenant === right.identity.tenant && left.identity.requisition === right.identity.requisition
    ? { version: POSTING_IDENTITY_VERSION, rule: left.identity.tenant.startsWith('workday:') ? 'QUALIFIED_REQUISITION_ID' : left.identity.tenant.startsWith('teamtailor:') ? 'QUALIFIED_FEED_POSTING_ID' : 'QUALIFIED_APPLICATION_ID', identity: left.identity, paths: [left.path, right.path] } : null;
}

/** Pairwise proof prevents an unqualified historical member from bridging groups. */
export function provenPublicationGroup(publications: readonly NativePublication[]): boolean {
  return publications.every((item, i) => publications.slice(i + 1).every(peer => publicationIdentityProof(item, peer) !== null));
}

/** Indexed lookup key only. The writer rechecks every member and the employer.
 * Unsupported URL formats stay scoped to their original source identity. */
export function blockingKey(job: NativePublication): string {
  const icims = icimsPublicationIdentity(job);
  if (icims) return JSON.stringify(['application', 'icims-v1', icims.tenant, icims.requisition]);
  const workday = workdayRequisitionIdentity(job);
  if (workday) return JSON.stringify(['requisition', 'workday-v1', workday.tenant, workday.requisition]);
  const teamtailor = teamtailorPublicationIdentity(job);
  if (teamtailor) return JSON.stringify(['feed-publication', 'teamtailor-v1', teamtailor.tenant, teamtailor.requisition]);
  const identity = postingIdentity(job.url);
  return JSON.stringify(identity ? ['application', APPLICATION_KEY_VERSION, identity.tenant, identity.requisition]
    : ['publication', job.sourceKey, job.externalId]);
}
