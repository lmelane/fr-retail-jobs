import { parse } from 'tldts';
import { createHash } from 'node:crypto';
import { CompanyKind, type PrismaClient } from '@prisma/client';
import { deactivateJob } from '../pipeline/lifecycle.js';
import { sourceIdentityHash } from '../connectors/sourceIdentity.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import { resolveCompany } from '../normalize/company.js';
import { json, type Operation, type RepairPlan } from './plan.js';

export type PortalOwnerReview = {
  batchId: string; reviewedAt: string; reviewer: string;
  sources: Array<{
    sourceKey: string; expectedSourceHash: string; fromCompanyIds: string[];
    targetName: string; identityScope?: 'OFFICIAL_DOMAIN'; targetKind: Exclude<CompanyKind, 'UNKNOWN'>;
    withdrawal?: { reason: 'IDENTITY_CONTRADICTED' | 'OUT_OF_SCOPE'; statement: string };
    officialDomain: string; portalUrl: string;
    evidence: { url: string; artifactText: string; sha256: string; statement: string }[];
  }>;
};

/** A reviewed ownership correction is data, not a new list of vendor/brand exceptions.
 * Existing brand identities survive. Only explicitly reviewed misattributions move.
 * Sources remain PAUSED until new ownership and scoped aliases are certified.
 */
export async function planReviewedPortalOwners(prisma: PrismaClient, review: PortalOwnerReview): Promise<RepairPlan> {
  if (!review.batchId || !review.reviewer || !Number.isFinite(Date.parse(review.reviewedAt)) || !review.sources.length) throw new Error('Incomplete portal owner review');
  if (new Set(review.sources.map(s => s.sourceKey)).size !== review.sources.length) throw new Error('Duplicate source review');
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const operations: Operation[] = [], companyIds = new Set<string>();
    const reviewedTargets = new Set<string>();
    const ownerRules: NonNullable<RepairPlan['ownerRules']> = [];
    for (const spec of review.sources) {
      if (!(Object.values(CompanyKind) as string[]).includes(spec.targetKind) || (spec.targetKind as string) === 'UNKNOWN') throw new Error('A reviewed canonical employer kind is required');
      if (spec.withdrawal && (!['IDENTITY_CONTRADICTED','OUT_OF_SCOPE'].includes(spec.withdrawal.reason) || spec.withdrawal.statement.trim().length < 30)) throw new Error('Explicit reviewed withdrawal rationale required');
      const source = await tx.source.findUniqueOrThrow({ where: { key: spec.sourceKey } });
      if (sourceIdentityHash(source) !== spec.expectedSourceHash) throw new Error(`Source configuration changed: ${source.key}`);
      if (parse(spec.officialDomain).domain !== spec.officialDomain || new URL(spec.portalUrl).protocol !== 'https:') throw new Error('Invalid official domain or portal URL');
      if (!spec.fromCompanyIds.length || !spec.evidence.length) throw new Error('Explicit old identities and official evidence required');
      for (const e of spec.evidence) {
        const u = new URL(e.url);
        if (u.protocol !== 'https:' || u.username || u.password || !(u.hostname === spec.officialDomain || u.hostname.endsWith(`.${spec.officialDomain}`)) ||
          !e.artifactText || createHash('sha256').update(e.artifactText).digest('hex') !== e.sha256 || e.statement.trim().length < 30) throw new Error(`Invalid official ownership evidence: ${e.url}`);
      }
      if (spec.identityScope !== undefined && spec.identityScope !== 'OFFICIAL_DOMAIN') throw new Error('Unsupported reviewed identity scope');
      if (!normalizedEmployerName(spec.targetName)) throw new Error('Empty reviewed employer name');
      // An explicitly reviewed homonym has its own namespace. A domain alone
      // does not merge companies; the full legal label participates in the key.
      // Ingestion reaches it through reviewed source-scoped aliases.
      const identity = spec.identityScope === 'OFFICIAL_DOMAIN'
        ? { companyId: `REVIEWED_${createHash('sha256').update(JSON.stringify([spec.officialDomain, normalizedEmployerName(spec.targetName)])).digest('hex')}`, displayName: spec.targetName.trim() }
        : resolveCompany(spec.targetName);
      ownerRules.push({ sourceKey: spec.sourceKey, name: spec.targetName, canonicalKey: identity.companyId, includeInactive: !!spec.withdrawal });
      const target = await tx.company.findUnique({ where: { fashionjobsUrl: `resolved:${identity.companyId}` } });
      if (target?.mergedIntoId || (target?.domain && target.domain !== spec.officialDomain)) throw new Error(`Target employer requires a separate identity review: ${identity.companyId}`);
      const targetId = target?.id ?? `cr${createHash('sha256').update(`REVIEWED_OWNER:${identity.companyId}`).digest('hex').slice(0,24)}`;
      if (spec.fromCompanyIds.includes(targetId)) throw new Error('Target is listed as a misattributed identity');
      companyIds.add(targetId); spec.fromCompanyIds.forEach(id => companyIds.add(id));
      if (!reviewedTargets.has(targetId)) {
        reviewedTargets.add(targetId);
        const patch = { name: identity.displayName, canonicalKey: identity.companyId, kind: spec.targetKind, domain: spec.officialDomain,
          domainSource: spec.evidence[0].url, careersUrl: spec.portalUrl, identityReviewId: review.batchId,
          ...(target?.parentGroup && resolveCompany(target.parentGroup).companyId === identity.companyId ? { parentGroup: null } : {}) };
        operations.push({ entity: 'Company', id: targetId, before: json(target), patch: target ? patch : { ...patch, fashionjobsUrl: `resolved:${identity.companyId}` }, reason: spec.evidence[0].statement });
      }
      const tier = spec.targetKind === 'GROUP' ? 'GROUP_OFFICIAL' : 'EMPLOYER_DIRECT';
      operations.push({ entity: 'Source', id: source.id, before: json(source), patch: { maison: identity.displayName, tier, status: spec.withdrawal ? 'RETIRED' : 'PAUSED',
        note: [source.note, `${review.reviewedAt} ${review.batchId}: official owner corrected; ${spec.withdrawal?.statement ?? 'identity certification required before activation.'}`].filter(Boolean).join('\n') }, reason: spec.evidence[0].statement });
      const entries = await tx.jobSource.findMany({ where: { sourceKey: source.key }, include: { job: { omit: { searchText: true }, include: { sources: true } } } });
      const handled = new Set<string>();
      for (const entry of entries) {
        const { job, ...beforeSource } = entry;
        if (entry.sourceTier !== tier || (spec.withdrawal && entry.isActive)) operations.push({ entity: 'JobSource', id: entry.id, before: json(beforeSource), patch: { sourceTier: tier, ...(spec.withdrawal ? { isActive: false } : {}) }, reason: 'Reviewed portal owner tier and catalogue disposition; RAW and posting identity retained' });
        if (handled.has(job.id) || (!spec.fromCompanyIds.includes(job.companyId) && !(spec.withdrawal && job.companyId === targetId))) continue;
        handled.add(job.id);
        if (job.sources.some(s => s.sourceKey !== source.key && s.isActive)) throw new Error(`Other active source evidence requires review: ${job.id}`);
        const { sources: _sources, ...beforeJob } = job;
        const rekey = (value: string | null) => value === null ? null : value.includes('|') ? identity.companyId + value.slice(value.indexOf('|')) : value;
        if (spec.withdrawal && job.isActive && new Date(review.reviewedAt) < job.firstSeenAt) throw new Error(`Withdrawal predates catalogue observation: ${job.id}`);
        const removal = spec.withdrawal ? deactivateJob(job, { kind: 'WITHDRAWN', reason: spec.withdrawal.reason }, new Date(review.reviewedAt)) : null;
        operations.push({ entity: 'Job', id: job.id, before: json(beforeJob), patch: { companyId: targetId, clusterKey: rekey(job.clusterKey), fingerprint: rekey(job.fingerprint), ...removal?.data },
          reason: spec.withdrawal?.statement ?? 'Wrong brand attribution corrected to the attested portal employer. Brand not inferred; no deletion or lifecycle change.' });
      }
      const unreviewed = await tx.jobSource.findFirst({ where: { sourceKey: source.key, isActive: true, job: { isActive: true, companyId: { notIn: [...spec.fromCompanyIds, targetId] } } }, select: { id: true } });
      if (unreviewed) throw new Error(`Unreviewed employer in shared portal: ${unreviewed.id}`);
    }
    return { version: 1, batchId: review.batchId, finding: 'REVIEWED_PORTAL_OWNER', createdAt: new Date().toISOString(),
      sourceKeys: review.sources.map(s => s.sourceKey), companyIds: [...companyIds], operations,
      reviewDocument: { statement: 'Reviewed official portal ownership correction; original brand identities and all histories preserved.', reviewedBy: review.reviewer, reviewedAt: review.reviewedAt,
        evidence: review.sources.flatMap(s => s.evidence.map(e => ({ url: e.url, artifactText: e.artifactText, sha256: e.sha256, explanation: e.statement }))) },
      evidence: { reviewId: review.batchId, reviewedAt: review.reviewedAt, reviewer: review.reviewer,
        sources: review.sources.map(s => ({ sourceKey: s.sourceKey, targetName: s.targetName, identityScope: s.identityScope ?? 'LEGACY_KEY', withdrawal: s.withdrawal ?? null, expectedSourceHash: s.expectedSourceHash, evidence: s.evidence.map(e => ({ url: e.url, sha256: e.sha256 })) })),
        preservation: 'Original company identities, job IDs, RAW, observations and histories preserved; only explicitly reviewed lifecycle transitions; CORRECTED events retain the decision.' },
      invariants: ['lifecycle', 'source-owners', ...(review.sources.some(s => s.withdrawal) ? ['excluded-identities' as const] : [])],
      excludedSourceKeys: review.sources.filter(s => s.withdrawal).map(s => s.sourceKey),
      ownerRules };
  }, { isolationLevel: 'RepeatableRead', timeout: 120000 });
}
