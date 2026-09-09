import { EmployerIdentityReviewRequired } from './errors.js';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { CandidateJob } from '../dedup/match.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import { PIPELINE_VERSION } from '../pipeline/version.js';

type Company = Prisma.CompanyGetPayload<Record<string, never>>;
export type EmployerResolution = {
  company: Company | null;
  rule: 'REVIEWED_ALIAS' | 'REVIEWED_MERGE' | 'LEGACY_UNREVIEWED' | 'REVIEW_REQUIRED';
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
  if (alias) return {
    company: roots[aliases.indexOf(alias)]!, rule: 'REVIEWED_ALIAS', rawEmployerName,
    normalizedEmployerName: normalized, aliasId: alias.id, reviewId: alias.reviewId!,
  };
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
