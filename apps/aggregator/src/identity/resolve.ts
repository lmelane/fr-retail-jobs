import { sourceIdentityHash, certifiedPortalScope } from '../connectors/sourceIdentity.js';
import { EmployerIdentityReviewRequired } from './errors.js';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { CandidateJob } from '../dedup/match.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import { resolveCompany } from '../normalize/company.js';
import { PIPELINE_VERSION } from '../pipeline/version.js';

type Company = Prisma.CompanyGetPayload<Record<string, never>>;
export type EmployerResolution = {
  company: Company | null;
  rule: 'REVIEWED_ALIAS' | 'REVIEWED_MERGE' | 'LEGACY_UNREVIEWED' | 'REVIEW_REQUIRED' | 'GROUP_LABEL_KEPT_HOUSE' | 'CERTIFIED_SINGLE_BRAND_PORTAL';
  rawEmployerName: string;
  normalizedEmployerName: string;
  aliasId?: string;
  reviewId?: string;
  newKey?: string;
  newName?: string;
};

/** Resolve redirects explicitly and fail on corrupt/cyclic identity data. */
export async function canonicalEmployer(tx: Prisma.TransactionClient, company: Company): Promise<Company> {
  const visited = new Set<string>();
  while (company.mergedIntoId) {
    if (visited.has(company.id)) throw new Error(`Employer identity cycle: ${company.id}`);
    visited.add(company.id);
    company = await tx.company.findUniqueOrThrow({ where: { id: company.mergedIntoId } });
  }
  return company;
}

/** Reviewed, source-scoped decisions outrank every historical spelling heuristic. */
export async function resolveEmployer(tx: Prisma.TransactionClient, candidate: CandidateJob & { companyId: string }): Promise<EmployerResolution> {
  const rawEmployerName = candidate.rawEmployerName ?? candidate.company;
  const normalized = normalizedEmployerName(rawEmployerName);
  if (!normalized) throw new Error(`Empty employer label: ${candidate.sourceKey}/${candidate.externalId}`);
  const aliases = await tx.companyAlias.findMany({
    where: { sourceKey: { in: [candidate.sourceKey, '*'] }, normalizedName: normalized, reviewId: { not: null } },
    include: { company: true },
  });
  // A local and global decision may coexist only if they lead to the same root.
  const roots = await Promise.all(aliases.map(a => canonicalEmployer(tx, a.company)));
  if (new Set(roots.map(c => c.id)).size > 1) throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, `CONFLICT: ${roots.map(c => c.id).join(',')}`);
  const alias = aliases.find(a => a.sourceKey === candidate.sourceKey) ?? aliases[0];
  if (alias) {
    const source = await tx.source.findUnique({ where: { key: candidate.sourceKey } });
    if (alias.sourceKey !== candidate.sourceKey || alias.sourceHash !== (source ? sourceIdentityHash(source) : 'UNCATALOGUED')) {
      throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, 'ALIAS_SOURCE_OR_TENANT_CHANGED');
    }
  }
  if (alias) return {
    company: roots[aliases.indexOf(alias)]!, rule: 'REVIEWED_ALIAS', rawEmployerName,
    normalizedEmployerName: normalized, aliasId: alias.id, reviewId: alias.reviewId!,
  };
  /**
   * A portal certified SINGLE_BRAND (identity review with `portalScope`, current configuration): every native employer
   * label read on it is an entity of the owner — legal entities, country branches, shared-services companies (Mango on
   * 2026-09-10: 50 labels, all Mango entities, 26 of them still displayed as separate employers). Such a label is credited
   * to the portal owner; the raw label stays in the observation. A reviewed alias above still outranks this rule, and a
   * MULTI_BRAND or uncertified portal is untouched: there, a new label remains an identity change to review.
   */
  if (candidate.rawEmployerName !== undefined && (await certifiedPortalScope(tx, candidate.sourceKey)) === 'SINGLE_BRAND') {
    const owner = await tx.company.findUnique({ where: { fashionjobsUrl: `resolved:${candidate.companyId}` } });
    if (owner) {
      const ownerRoot = await canonicalEmployer(tx, owner);
      // A native label that IS a known distinct employer (its own canonical company, not merged into the owner) is a
      // contradiction of the certified perimeter, never an entity of the owner: it goes to review like on any portal
      // (2026-09-10: the rule credited any label, including one naming another brand, to the owner).
      const named = await tx.company.findUnique({ where: { fashionjobsUrl: `resolved:${resolveCompany(rawEmployerName).companyId}` } });
      const namedRoot = named ? await canonicalEmployer(tx, named) : null;
      if (namedRoot && namedRoot.id !== ownerRoot.id) throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, ownerRoot.name);
      return { company: ownerRoot, rule: 'CERTIFIED_SINGLE_BRAND_PORTAL', rawEmployerName, normalizedEmployerName: normalized };
    }
  }
  const sourceScopedKey = `SOURCE_${createHash('sha256').update(JSON.stringify([candidate.sourceKey, normalized])).digest('hex')}`;
  const scoped = candidate.rawEmployerName === undefined ? null : await tx.company.findUnique({ where: { fashionjobsUrl: `resolved:${sourceScopedKey}` } });
  const company = scoped ?? await tx.company.findUnique({ where: { fashionjobsUrl: `resolved:${candidate.companyId}` } });
  // A historical assignment is not proof for a NEW spelling or a new posting.
  // Existing postings may be re-attested, but identity changes require a review.
  if (candidate.rawEmployerName !== undefined) {
    const entry = await tx.jobSource.findUnique({
      where: { sourceKey_externalId: { sourceKey: candidate.sourceKey, externalId: candidate.externalId } },
      select: { job: { select: { company: true } } },
    });
    const current = entry ? await canonicalEmployer(tx, entry.job.company) : null;
    const target = company ? await canonicalEmployer(tx, company) : null;
    if (current && target && current.id !== target.id) {
      // A response that OMITS the house and falls back to the group recorded for
      // it (Kering feed without `efcustomTextHouse`, 6 postings on 2026-09-09) is
      // not a new identity: the posting keeps the house attested for this source
      // id, the observation records the group label (the omission stays
      // traceable), and every other field keeps updating. Only the group recorded
      // for the house qualifies — any other label is still an identity change.
      const isRecordedGroup = normalizedEmployerName(current.parentGroup ?? '') === normalized || (current.parentGroupId !== null && current.parentGroupId === target.id);
      if (isRecordedGroup) return { company: current, rule: 'GROUP_LABEL_KEPT_HOUSE', rawEmployerName, normalizedEmployerName: normalized };
    }
    if (current) {
      const previous = await tx.employerObservation.findFirst({
        where: { sourceKey: candidate.sourceKey, externalId: candidate.externalId, canonicalEmployerId: { not: null } },
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }], select: { normalizedEmployerName: true },
      });
      // A new spelling that IS the canonical name of the employer already holding the posting is a
      // convergence, not an identity change (Workday logo alt "UGG Logo" → "UGG" on 2026-09-10: the
      // previous observation carried the image's word, the company never did).
      const convergesOnCurrent = normalized === normalizedEmployerName(current.name);
      if (previous && previous.normalizedEmployerName !== normalized && !convergesOnCurrent) {
        throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, current.name);
      }
    }
    if (current && (!target || current.id !== target.id)) {
      throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, target?.name ?? candidate.company);
    }
    if (!current && target && !await tx.jobSource.findFirst({ where: { sourceKey: candidate.sourceKey, job: { companyId: target.id } }, select: { id: true } })) {
      throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, target.name);
    }
    if (!current && normalized !== normalizedEmployerName(target?.name ?? candidate.company)) {
      throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, target?.name ?? candidate.company);
    }
  }
  return {
    company: company ? await canonicalEmployer(tx, company) : null,
    rule: company?.mergedIntoId ? 'REVIEWED_MERGE' : 'LEGACY_UNREVIEWED',
    rawEmployerName, normalizedEmployerName: normalized,
    ...(company?.mergedIntoId && company.identityReviewId ? { reviewId: company.identityReviewId } : {}),
    ...(!company && candidate.rawEmployerName !== undefined ? { newKey: sourceScopedKey, newName: rawEmployerName.trim() } : {}),
  };
}

export async function recordEmployerObservation(tx: Prisma.TransactionClient, candidate: CandidateJob, companyId: string | null, resolution: EmployerResolution): Promise<void> {
  const rawHash = candidate.raw == null ? null : createHash('sha256').update(JSON.stringify(candidate.raw)).digest('hex');
  const value = {
    sourceKey: candidate.sourceKey, externalId: candidate.externalId,
    labelOrigin: candidate.employerLabelOrigin ?? 'LEGACY_UNSPECIFIED',
    rawEmployerName: resolution.rawEmployerName, normalizedEmployerName: resolution.normalizedEmployerName,
    canonicalEmployerId: companyId, rule: resolution.rule, aliasId: resolution.aliasId ?? null,
    reviewId: resolution.reviewId ?? null, rawHash, pipelineVersion: PIPELINE_VERSION,
  };
  const observationHash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  await tx.employerObservation.upsert({
    where: { sourceKey_externalId_observationHash: { sourceKey: candidate.sourceKey, externalId: candidate.externalId, observationHash } },
    create: { ...value, observationHash }, update: {},
  });
}
