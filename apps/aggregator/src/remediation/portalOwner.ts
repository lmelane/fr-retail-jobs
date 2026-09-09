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
    /**
     * Hosts the reviewed portal serves its posting pages from when they are not
     * on the official domain (a vendor-hosted hub: `hub-urbn.icims.com` and the
     * tenant hosts it federates). Per-posting evidence may come from these hosts;
     * the official evidence proving the portal belongs to the owner never does.
     */
    portalHosts?: string[];
    /** Adapter settings the review establishes (e.g. the careersite property naming the brand). Part of the source identity hash afterwards. */
    configPatch?: Record<string, unknown>;
    /**
     * Postings whose native page EXPLICITLY names an employing brand distinct
     * from the portal owner. Every posting not listed here stays with the owner.
     * A brand is never inferred from a title or a description.
     */
    postings?: Array<{
      externalId: string; targetName: string; targetKind: Exclude<CompanyKind, 'UNKNOWN'>;
      /** The brand's own official domain when the native page states it (JSON-LD `sameAs`); recorded for the logo, never guessed from a name. */
      targetDomain?: string;
      /**
       * A sub-label whose native page attests a relation to another brand of the
       * same portal (URBN: "FP Movement" → freepeople.com/fpmovement) keeps its OWN
       * identity; the attested relation is RECORDED (observation + correction
       * evidence), never turned into a merge (owner decision 2026-09-09). The
       * database only accepts a canonical GROUP as `parentGroupId`, so the
       * portal owner stays the recorded group and the related brand — which must
       * already exist or be created by this review — is the traceable relation.
       */
      relatedBrandName?: string;
      evidence: { url: string; sha256: string; property: string; value: string; observedAt: string };
    }>;
    evidence: { url: string; artifactText: string; sha256: string; statement: string }[];
  }>;
};

const onDomain = (url: URL, domain: string) => url.hostname === domain || url.hostname.endsWith(`.${domain}`);

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
    const observations: NonNullable<RepairPlan['observations']> = [];
    for (const spec of review.sources) {
      if (!(Object.values(CompanyKind) as string[]).includes(spec.targetKind) || (spec.targetKind as string) === 'UNKNOWN') throw new Error('A reviewed canonical employer kind is required');
      if (spec.withdrawal && (!['IDENTITY_CONTRADICTED','OUT_OF_SCOPE'].includes(spec.withdrawal.reason) || spec.withdrawal.statement.trim().length < 30)) throw new Error('Explicit reviewed withdrawal rationale required');
      if (spec.withdrawal && spec.postings?.length) throw new Error('A withdrawn source cannot carry brand attributions');
      const source = await tx.source.findUniqueOrThrow({ where: { key: spec.sourceKey } });
      if (sourceIdentityHash(source) !== spec.expectedSourceHash) throw new Error(`Source configuration changed: ${source.key}`);
      if (parse(spec.officialDomain).domain !== spec.officialDomain || new URL(spec.portalUrl).protocol !== 'https:') throw new Error('Invalid official domain or portal URL');
      if (!spec.fromCompanyIds.length || !spec.evidence.length) throw new Error('Explicit old identities and official evidence required');
      const portalHosts = spec.portalHosts ?? [];
      if (portalHosts.some(h => typeof h !== 'string' || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h))) throw new Error('portalHosts must be lowercase hostnames');
      const onPortal = (u: URL) => onDomain(u, spec.officialDomain) || portalHosts.includes(u.hostname);
      for (const e of spec.evidence) {
        const u = new URL(e.url);
        if (u.protocol !== 'https:' || u.username || u.password || !onDomain(u, spec.officialDomain) ||
          !e.artifactText || createHash('sha256').update(e.artifactText).digest('hex') !== e.sha256 || e.statement.trim().length < 30) throw new Error(`Invalid official ownership evidence: ${e.url}`);
      }
      if (spec.identityScope !== undefined && spec.identityScope !== 'OFFICIAL_DOMAIN') throw new Error('Unsupported reviewed identity scope');
      if (!normalizedEmployerName(spec.targetName)) throw new Error('Empty reviewed employer name');
      if (spec.configPatch && (typeof spec.configPatch !== 'object' || Array.isArray(spec.configPatch) || !Object.keys(spec.configPatch).length)) throw new Error('configPatch must be a non-empty object');
      // An explicitly reviewed homonym has its own namespace. A domain alone
      // does not merge companies; the full legal label participates in the key.
      // Ingestion reaches it through reviewed source-scoped aliases.
      const identity = spec.identityScope === 'OFFICIAL_DOMAIN'
        ? { companyId: `REVIEWED_${createHash('sha256').update(JSON.stringify([spec.officialDomain, normalizedEmployerName(spec.targetName)])).digest('hex')}`, displayName: spec.targetName.trim() }
        : resolveCompany(spec.targetName);
      const target = await tx.company.findUnique({ where: { fashionjobsUrl: `resolved:${identity.companyId}` } });
      if (target?.mergedIntoId || (target?.domain && target.domain !== spec.officialDomain)) throw new Error(`Target employer requires a separate identity review: ${identity.companyId}`);
      const targetId = target?.id ?? `cr${createHash('sha256').update(`REVIEWED_OWNER:${identity.companyId}`).digest('hex').slice(0,24)}`;
      // A portal whose owner is already right may still credit brands the pages
      // name: the owner is then listed as the identity to re-evaluate per posting,
      // and every posting without a reviewed brand stays where it is.
      if (spec.fromCompanyIds.includes(targetId) && !spec.postings?.length) throw new Error('Target is listed as a misattributed identity');
      companyIds.add(targetId); spec.fromCompanyIds.forEach(id => companyIds.add(id));
      if (!reviewedTargets.has(targetId)) {
        reviewedTargets.add(targetId);
        const patch = { name: identity.displayName, canonicalKey: identity.companyId, kind: spec.targetKind, domain: spec.officialDomain,
          domainSource: spec.evidence[0].url, careersUrl: spec.portalUrl, identityReviewId: review.batchId,
          ...(target?.parentGroup && resolveCompany(target.parentGroup).companyId === identity.companyId ? { parentGroup: null } : {}) };
        operations.push({ entity: 'Company', id: targetId, before: json(target), patch: target ? patch : { ...patch, fashionjobsUrl: `resolved:${identity.companyId}` }, reason: spec.evidence[0].statement });
      }

      // Brand attributions: one reviewed target per distinct native value; the
      // owner is the parent group of a brand created here, never of a brand
      // that already exists with its own recorded group.
      const postingOwners: Record<string, string> = {};
      const brandTargets = new Map<string, { id: string; key: string }>();
      const brandTargetIds = new Set<string>();
      const brandDomains = new Map<string, string | null>();
      const relatedBrands = new Map<string, { id: string; name: string }>();
      for (const posting of spec.postings ?? []) {
        if (!/^[A-Za-z0-9._:-]{1,80}$/.test(posting.externalId) || posting.externalId in postingOwners) throw new Error(`Invalid or repeated reviewed posting: ${posting.externalId}`);
        if (!(Object.values(CompanyKind) as string[]).includes(posting.targetKind) || (posting.targetKind as string) === 'UNKNOWN' || !normalizedEmployerName(posting.targetName)) throw new Error(`Invalid reviewed brand for posting ${posting.externalId}`);
        const ev = posting.evidence; const u = new URL(ev.url);
        if (u.protocol !== 'https:' || u.username || u.password || !onPortal(u) || !/^[a-f0-9]{64}$/.test(ev.sha256) || !ev.property.trim() || !ev.value.trim() || !Number.isFinite(Date.parse(ev.observedAt))) throw new Error(`Invalid native brand evidence for posting ${posting.externalId}`);
        const brand = resolveCompany(posting.targetName);
        if (brand.companyId === identity.companyId) throw new Error(`Posting ${posting.externalId} names the portal owner; list only distinct brands`);
        if (posting.targetDomain !== undefined && parse(posting.targetDomain).domain !== posting.targetDomain) throw new Error(`Invalid brand domain for posting ${posting.externalId}`);
        const knownDomain = brandDomains.get(brand.companyId);
        if (knownDomain !== undefined && knownDomain !== (posting.targetDomain ?? null)) throw new Error(`Conflicting brand domains for ${posting.targetName}`);
        brandDomains.set(brand.companyId, posting.targetDomain ?? null);
        let entry = brandTargets.get(brand.companyId);
        if (!entry) {
          const existing = await tx.company.findUnique({ where: { fashionjobsUrl: `resolved:${brand.companyId}` } });
          if (existing?.mergedIntoId) throw new Error(`Brand target requires a separate identity review: ${brand.companyId}`);
          const id = existing?.id ?? `cr${createHash('sha256').update(`REVIEWED_BRAND:${identity.companyId}:${brand.companyId}`).digest('hex').slice(0,24)}`;
          if (id === targetId) throw new Error('Brand target collides with the portal owner');
          // An attested related brand must be a known company of this portal (existing, or created earlier in this review).
          let related: { id: string; name: string } | null = null;
          if (posting.relatedBrandName) {
            const relatedKey = resolveCompany(posting.relatedBrandName);
            if (relatedKey.companyId === brand.companyId) throw new Error(`Posting ${posting.externalId}: a brand cannot be related to itself`);
            const relatedEntry = brandTargets.get(relatedKey.companyId);
            const relatedRow = relatedEntry ? null : await tx.company.findUnique({ where: { fashionjobsUrl: `resolved:${relatedKey.companyId}` } });
            if (!relatedEntry && (!relatedRow || relatedRow.mergedIntoId)) throw new Error(`Posting ${posting.externalId}: attested related brand "${posting.relatedBrandName}" is not a known company of this portal`);
            related = { id: relatedEntry?.id ?? relatedRow!.id, name: relatedEntry ? posting.relatedBrandName.trim() : relatedRow!.name };
          }
          entry = { id, key: brand.companyId }; brandTargets.set(brand.companyId, entry); brandTargetIds.add(id); companyIds.add(id);
          if (!existing) {
            operations.push({ entity: 'Company', id, before: null, patch: { name: posting.targetName.trim(), canonicalKey: brand.companyId, kind: posting.targetKind, parentGroup: identity.displayName, parentGroupId: targetId, identityReviewId: review.batchId, fashionjobsUrl: `resolved:${brand.companyId}`, ...(posting.targetDomain ? { domain: posting.targetDomain, domainSource: ev.url } : {}) },
              reason: related ? `Sub-label named by the native posting property "${ev.property}" on the reviewed ${spec.officialDomain} portal; its page attests a relation to ${related.name} (recorded, not merged); parent group is the portal owner.` : `Brand named by the native posting property "${ev.property}" on the reviewed ${spec.officialDomain} portal; parent group is the portal owner.` });
          } else if (!existing.parentGroupId && (!existing.parentGroup || resolveCompany(existing.parentGroup).companyId === identity.companyId)) {
            // A recorded relationship must reference the review that established it (DB check constraint).
            operations.push({ entity: 'Company', id, before: json(existing), patch: { parentGroup: identity.displayName, parentGroupId: targetId, identityReviewId: review.batchId, ...(posting.targetDomain && !existing.domain ? { domain: posting.targetDomain, domainSource: ev.url } : {}) }, reason: `Existing brand attested on the reviewed ${spec.officialDomain} portal; parent group recorded, identity unchanged.` });
          }
          if (related) relatedBrands.set(brand.companyId, related);
        }
        postingOwners[posting.externalId] = brand.companyId;
        const relatedBrand = relatedBrands.get(brand.companyId);
        observations.push({ sourceKey: source.key, externalId: posting.externalId, observedAt: ev.observedAt,
          raw: { reviewedEmployer: { property: ev.property, value: ev.value, targetName: posting.targetName, canonicalKey: brand.companyId, reviewId: review.batchId, ...(relatedBrand ? { attestedRelatedBrand: relatedBrand.name, attestedRelatedBrandId: relatedBrand.id } : {}) }, page: { url: ev.url, sha256: ev.sha256 } } });
      }
      ownerRules.push({ sourceKey: spec.sourceKey, name: spec.targetName, canonicalKey: identity.companyId, includeInactive: !!spec.withdrawal, ...(Object.keys(postingOwners).length ? { postingOwners } : {}) });

      const tier = spec.targetKind === 'GROUP' ? 'GROUP_OFFICIAL' : 'EMPLOYER_DIRECT';
      operations.push({ entity: 'Source', id: source.id, before: json(source), patch: { maison: identity.displayName, tier, status: spec.withdrawal ? 'RETIRED' : 'PAUSED',
        ...(spec.configPatch ? { config: { ...(source.config as Record<string, unknown>), ...spec.configPatch } } : {}),
        note: [source.note, `${review.reviewedAt} ${review.batchId}: official owner corrected; ${spec.withdrawal?.statement ?? 'identity certification required before activation.'}`].filter(Boolean).join('\n') }, reason: spec.evidence[0].statement });
      const entries = await tx.jobSource.findMany({ where: { sourceKey: source.key }, include: { job: { omit: { searchText: true }, include: { sources: true } } } });
      const handled = new Set<string>();
      const moved = new Map<string, { id: string; key: string }>();
      const rekeyTo = (key: string) => (value: string | null) => value === null ? null : value.includes('|') ? key + value.slice(value.indexOf('|')) : value;
      for (const entry of entries) {
        const { job, ...beforeSource } = entry;
        if (entry.sourceTier !== tier || (spec.withdrawal && entry.isActive)) operations.push({ entity: 'JobSource', id: entry.id, before: json(beforeSource), patch: { sourceTier: tier, ...(spec.withdrawal ? { isActive: false } : {}) }, reason: 'Reviewed portal owner tier and catalogue disposition; RAW and posting identity retained' });
        if (handled.has(job.id) || (!spec.fromCompanyIds.includes(job.companyId) && !(spec.withdrawal && job.companyId === targetId))) continue;
        handled.add(job.id);
        const brandKey = postingOwners[entry.externalId];
        const desired = brandKey ? brandTargets.get(brandKey)! : { id: targetId, key: identity.companyId };
        // A posting that keeps its employer needs no review; one that changes it must not be attested by another live source.
        if (job.companyId === desired.id && !spec.withdrawal) continue;
        if (job.sources.some(s => s.sourceKey !== source.key && s.isActive)) throw new Error(`Other active source evidence requires review: ${job.id}`);
        const { sources: _sources, ...beforeJob } = job;
        const rekey = rekeyTo(desired.key); moved.set(job.id, desired);
        if (spec.withdrawal && job.isActive && new Date(review.reviewedAt) < job.firstSeenAt) throw new Error(`Withdrawal predates catalogue observation: ${job.id}`);
        const removal = spec.withdrawal ? deactivateJob(job, { kind: 'WITHDRAWN', reason: spec.withdrawal.reason }, new Date(review.reviewedAt)) : null;
        operations.push({ entity: 'Job', id: job.id, before: json(beforeJob), patch: { companyId: desired.id, clusterKey: rekey(job.clusterKey), fingerprint: rekey(job.fingerprint), ...removal?.data },
          reason: spec.withdrawal?.statement ?? (brandKey ? 'Employer corrected to the brand explicitly named by the native posting on the shared portal. No deletion or lifecycle change.' : 'Wrong brand attribution corrected to the attested portal employer. Brand not inferred; no deletion or lifecycle change.') });
      }
      // A redirected predecessor (posting merged into a moved job) must keep the
      // employer of its canonical posting (Job redirect integrity): it follows the move.
      let frontier = [...moved.keys()];
      while (frontier.length) {
        const predecessors = await tx.job.findMany({ where: { mergedIntoId: { in: frontier } }, omit: { searchText: true } });
        frontier = [];
        for (const predecessor of predecessors) {
          const desired = moved.get(predecessor.mergedIntoId!)!;
          moved.set(predecessor.id, desired); frontier.push(predecessor.id);
          if (predecessor.companyId === desired.id) continue;
          const rekey = rekeyTo(desired.key);
          operations.push({ entity: 'Job', id: predecessor.id, before: json(predecessor), patch: { companyId: desired.id, clusterKey: rekey(predecessor.clusterKey), fingerprint: rekey(predecessor.fingerprint) },
            reason: 'Redirected predecessor follows the employer of its canonical posting; redirect, RAW and lifecycle unchanged.' });
        }
      }
      const unreviewed = await tx.jobSource.findFirst({ where: { sourceKey: source.key, isActive: true, job: { isActive: true, companyId: { notIn: [...spec.fromCompanyIds, targetId, ...brandTargetIds] } } }, select: { id: true } });
      if (unreviewed) throw new Error(`Unreviewed employer in shared portal: ${unreviewed.id}`);
    }
    return { version: 1, batchId: review.batchId, finding: 'REVIEWED_PORTAL_OWNER', createdAt: new Date().toISOString(),
      sourceKeys: review.sources.map(s => s.sourceKey), companyIds: [...companyIds], operations,
      reviewDocument: { statement: 'Reviewed official portal ownership correction; original brand identities and all histories preserved.', reviewedBy: review.reviewer, reviewedAt: review.reviewedAt,
        evidence: review.sources.flatMap(s => s.evidence.map(e => ({ url: e.url, artifactText: e.artifactText, sha256: e.sha256, explanation: e.statement }))) },
      evidence: { reviewId: review.batchId, reviewedAt: review.reviewedAt, reviewer: review.reviewer,
        sources: review.sources.map(s => ({ sourceKey: s.sourceKey, targetName: s.targetName, identityScope: s.identityScope ?? 'LEGACY_KEY', withdrawal: s.withdrawal ?? null, expectedSourceHash: s.expectedSourceHash, configPatch: s.configPatch ?? null, portalHosts: s.portalHosts ?? [],
          brandPostings: (s.postings ?? []).length, brands: [...new Set((s.postings ?? []).map(p => p.targetName))], relatedBrands: Object.fromEntries((s.postings ?? []).filter(p => p.relatedBrandName).map(p => [p.targetName, p.relatedBrandName!])), evidence: s.evidence.map(e => ({ url: e.url, sha256: e.sha256 })) })),
        preservation: 'Original company identities, job IDs, RAW, observations and histories preserved; only explicitly reviewed lifecycle transitions; CORRECTED events retain the decision.' },
      invariants: ['lifecycle', 'source-owners', ...(review.sources.some(s => s.withdrawal) ? ['excluded-identities' as const] : [])],
      excludedSourceKeys: review.sources.filter(s => s.withdrawal).map(s => s.sourceKey),
      ownerRules, ...(observations.length ? { observations } : {}) };
  }, { isolationLevel: 'RepeatableRead', timeout: 120000 });
}
