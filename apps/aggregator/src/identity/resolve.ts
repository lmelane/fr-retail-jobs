import { isPortalEmployerOrigin } from './portalEmployer.js';
import { sourceIdentityHash, certifiedPortalIdentity } from '../connectors/sourceIdentity.js';
import { EmployerIdentityReviewRequired } from './errors.js';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { CandidateJob } from '../dedup/match.js';
import { normalizedEmployerName, sameEmployerTypography } from '../normalize/employerName.js';
import { PIPELINE_VERSION } from '../pipeline/version.js';
import { applyNativeEmployerRules, nativeEmployerRules } from './nativeClaims.js';
import { followsPublisherTier, PublisherFollowDeferred, sourcePublishesEmployer, type PublisherFollow } from './publisherFollow.js';
import { LABEL_OMITTED_RULE, SAME_MAISON_RULE, employerKeptWhenLabelOmitted, sameRegistryMaison } from './ordinaryIdentity.js';

type Company = Prisma.CompanyGetPayload<Record<string, never>>;
export type EmployerResolution = {
  company: Company | null;
  rule: 'REVIEWED_ALIAS' | 'REVIEWED_MERGE' | 'NATIVE_SOURCE_LABEL' | 'NATIVE_EMPLOYER_BRAND_RELATION' | 'LEGACY_UNREVIEWED' | 'REVIEW_REQUIRED' | 'GROUP_LABEL_KEPT_HOUSE' | 'CERTIFIED_SINGLE_BRAND_PORTAL' | 'MULTI_BRAND_PORTAL_GROUP_OWNER' | 'PUBLISHER_FOLLOWED'
    | typeof LABEL_OMITTED_RULE | typeof SAME_MAISON_RULE;
  rawEmployerName: string;
  normalizedEmployerName: string;
  aliasId?: string;
  reviewId?: string;
  newKey?: string;
  newName?: string;
  /** `PUBLISHER_FOLLOWED` seulement (D-506 §3) : l'employeur que l'offre quitte et le libellé que l'éditeur lui donnait. */
  followedFrom?: { companyId: string; name: string; previousLabel: string };
};
export type ResolveEmployerOptions = {
  /** D-506 §3 : absent, une offre qui change d'employeur reste en revue humaine (`publisherFollow.ts`). */
  publisherFollow?: PublisherFollow;
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
export async function resolveEmployer(tx: Prisma.TransactionClient, candidate: CandidateJob & { companyId: string },
  options: ResolveEmployerOptions = {}): Promise<EmployerResolution> {
  const rawEmployerName = candidate.rawEmployerName ?? candidate.company;
  const normalized = normalizedEmployerName(rawEmployerName);
  if (!normalized) throw new Error(`Empty employer label: ${candidate.sourceKey}/${candidate.externalId}`);
  // Registry labels are an inference, never a native employer or a label alias.
  // Read the owner and its certification from the same SQL snapshot.
  if (isPortalEmployerOrigin(candidate.employerLabelOrigin)) {
    const identity = await certifiedPortalIdentity(tx, candidate.sourceKey);
    // D-479 §2 (R-142 §3) : sur un portail relu MULTI_BRAND, l'offre qui ne nomme pas son enseigne publie sous le
    // groupe propriétaire ; celle qui la nomme n'arrive jamais ici (son libellé est natif). Un portail non relu
    // (périmètre NULL) reste refusé.
    if (!identity || !identity.ownerName) {
      // D-520 : l'éditeur a déjà nommé l'employeur de CETTE offre ; son silence d'aujourd'hui ne le défait pas.
      const kept = await employerKeptWhenLabelOmitted(tx, candidate);
      if (kept) return { company: kept, rule: LABEL_OMITTED_RULE, rawEmployerName, normalizedEmployerName: normalized };
      throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, 'PORTAL_OWNER_NOT_CERTIFIED', 'PORTAL_OWNER_NOT_CERTIFIED');
    }
    const owner = await tx.company.findUnique({ where: { fashionjobsUrl: `resolved:${identity.ownerKey}` } });
    const root = owner ? await canonicalEmployer(tx, owner) : null;
    const entry = await tx.jobSource.findUnique({ where: { sourceKey_externalId: { sourceKey: candidate.sourceKey, externalId: candidate.externalId } },
      select: { job: { select: { company: true } } } });
    const previous = entry?.job ? await canonicalEmployer(tx, entry.job.company) : null;
    // Missing information cannot silently replace an already attributed employer — nor remove the one the publisher named.
    if (previous && previous.id !== root?.id) {
      const kept = await employerKeptWhenLabelOmitted(tx, candidate);
      if (kept) return { company: kept, rule: LABEL_OMITTED_RULE, rawEmployerName, normalizedEmployerName: normalized };
    }
    if (previous && previous.id !== root?.id) throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, previous.name, 'PORTAL_OWNER_REPLACES_EMPLOYER');
    return { company: root, rule: identity.scope === 'SINGLE_BRAND' ? 'CERTIFIED_SINGLE_BRAND_PORTAL' : 'MULTI_BRAND_PORTAL_GROUP_OWNER',
      rawEmployerName, normalizedEmployerName: normalized,
      // `reviewId` est nul quand l'employeur vient du registre relu (F5) : la traçabilité passe
      // alors par la révision de la source, portée par l'admission du lot.
      // Le nom créé suit la clé : sans la parenthèse du registre (« LVMH (toutes Maisons) » → « LVMH »).
      reviewId: identity.reviewId ?? undefined, ...(!root ? { newKey: identity.ownerKey, newName: identity.ownerName.split('(')[0].trim() || identity.ownerName } : {}) };
  }
  const aliases = await tx.companyAlias.findMany({
    where: { sourceKey: { in: [candidate.sourceKey, '*'] }, normalizedName: normalized, reviewId: { not: null } },
    include: { company: true },
  });
  // A local and global decision may coexist only if they lead to the same root.
  const roots = await Promise.all(aliases.map(a => canonicalEmployer(tx, a.company)));
  if (new Set(roots.map(c => c.id)).size > 1) throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, `CONFLICT: ${roots.map(c => c.id).join(',')}`, 'ALIAS_CONFLICT');
  const alias = aliases.find(a => a.sourceKey === candidate.sourceKey) ?? aliases[0];
  if (alias) {
    const source = await tx.source.findUnique({ where: { key: candidate.sourceKey } });
    if (alias.sourceKey !== candidate.sourceKey || alias.sourceHash !== (source ? sourceIdentityHash(source) : 'UNCATALOGUED')) {
      throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, 'ALIAS_SOURCE_OR_TENANT_CHANGED', 'ALIAS_SOURCE_OR_TENANT_CHANGED');
    }
  }
  if (alias) return {
    company: roots[aliases.indexOf(alias)]!, rule: 'REVIEWED_ALIAS', rawEmployerName,
    normalizedEmployerName: normalized, aliasId: alias.id, reviewId: alias.reviewId!,
  };
  const sourceScopedKey = `SOURCE_${createHash('sha256').update(JSON.stringify([candidate.sourceKey, normalized])).digest('hex')}`;
  const scoped = candidate.rawEmployerName === undefined ? null : await tx.company.findUnique({ where: { fashionjobsUrl: `resolved:${sourceScopedKey}` } });
  const proposed = scoped ?? await tx.company.findUnique({ where: { fashionjobsUrl: `resolved:${candidate.companyId}` } });
  const proposedRoot = proposed ? await canonicalEmployer(tx, proposed) : null;
  // A display-name heuristic is neither an alias nor evidence of an identity
  // conflict. Preserve a new native legal entity instead of rejecting it or
  // merging it into the similarly named historical Maison.
  const company = candidate.rawEmployerName === undefined || scoped ||
    proposedRoot && normalizedEmployerName(proposedRoot.name) === normalized ? proposedRoot : null;
  // A historical assignment is not proof for a NEW spelling or a new posting.
  // Existing postings may be re-attested, but identity changes require a review.
  if (candidate.rawEmployerName !== undefined) {
    const entry = await tx.jobSource.findUnique({
      where: { sourceKey_externalId: { sourceKey: candidate.sourceKey, externalId: candidate.externalId } },
      select: { job: { select: { company: true } } },
    });
    const current = entry?.job ? await canonicalEmployer(tx, entry.job.company) : null;
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
      // Two unreviewed, source-generated spellings can already coexist because
      // other postings used the new typography first. Their row IDs alone are
      // not contrary evidence. Keep THIS posting's employer; do not merge the
      // identities or alter any other posting. Reviewed/parent-linked entities
      // and identities from another source still require an explicit decision.
      const currentNativeKey = `SOURCE_${createHash('sha256').update(JSON.stringify([candidate.sourceKey, normalizedEmployerName(current.name)])).digest('hex')}`;
      const unreviewedTypographicPeer = scoped?.id === target?.id && scoped?.mergedIntoId === null &&
        current.fashionjobsUrl === `resolved:${currentNativeKey}` &&
        current.identityReviewId === null && scoped.identityReviewId === null &&
        current.kind === 'UNKNOWN' && scoped.kind === 'UNKNOWN' &&
        !current.parentGroupId && !scoped.parentGroupId && !current.parentGroup && !scoped.parentGroup;
      if ((!target || target.id === current.id || unreviewedTypographicPeer) && sameEmployerTypography(rawEmployerName, current.name)) {
        return { company: current, rule: 'NATIVE_SOURCE_LABEL', rawEmployerName, normalizedEmployerName: normalized };
      }
      const previous = await tx.employerObservation.findFirst({
        where: { sourceKey: candidate.sourceKey, externalId: candidate.externalId, canonicalEmployerId: { not: null } },
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }], select: { normalizedEmployerName: true, labelOrigin: true, canonicalEmployerId: true },
      });
      // Replace only a registry-derived attribution when THIS posting names
      // the legal employer and explicitly relates it to that historical brand.
      // Re-evaluate current reviewed rules against RAW; caller-supplied evidence
      // alone cannot authorize the transition. No company merge/parent mutation.
      if (previous?.canonicalEmployerId === current.id && isPortalEmployerOrigin(previous.labelOrigin)) {
        const source = await tx.source.findUniqueOrThrow({ where: { key: candidate.sourceKey } });
        const proof = applyNativeEmployerRules({ externalId: candidate.externalId, title: candidate.title,
          url: candidate.url, raw: candidate.raw, company: rawEmployerName }, nativeEmployerRules(source.config as Record<string, unknown>));
        if (!proof.publicationHold && proof.employerEvidence?.role === 'EMPLOYER' &&
          proof.employerEvidence.brands?.some(brand => normalizedEmployerName(brand) === normalizedEmployerName(current.name))) {
          return { company: target, rule: 'NATIVE_EMPLOYER_BRAND_RELATION', rawEmployerName, normalizedEmployerName: normalized,
            ...(!target ? { newKey: sourceScopedKey, newName: rawEmployerName.trim() } : {}) };
        }
      }
      // Re-attesting the same source/publication/employer observation does not
      // move the publication, even if an old display-name heuristic differs.
      if (previous?.normalizedEmployerName === normalized) {
        return { company: current, rule: 'NATIVE_SOURCE_LABEL', rawEmployerName, normalizedEmployerName: normalized };
      }
      // A new spelling that IS the canonical name of the employer already holding the posting is a
      // convergence, not an identity change (Workday logo alt "UGG Logo" → "UGG" on 2026-09-10: the
      // previous observation carried the image's word, the company never did).
      const convergesOnCurrent = normalized === normalizedEmployerName(current.name);
      if (previous && previous.normalizedEmployerName !== normalized && !convergesOnCurrent) {
        // D-506 §3 : l'éditeur nommait A, il nomme B, et nomme B d'autres offres de cette collecte, déjà attribuées à cet
        // employeur avant elle : l'offre le suit. Un précédent du registre n'est pas un employeur nommé par l'éditeur
        // (ci-dessus) ; un employeur jamais publié par la source, ou la même racine, reste en revue. Tout changement d'un
        // employeur nommé vers un autre est signalé à la garde de masse de l'ingestion, qu'il puisse suivre ou non.
        const employerChange = !isPortalEmployerOrigin(previous.labelOrigin) && (!target || target.id !== current.id);
        const follow = options.publisherFollow;
        const witnesses = (follow?.publishedUnder.get(normalized) ?? []).filter(id => id !== candidate.externalId);
        if (follow && employerChange && target && followsPublisherTier(candidate.sourceTier) &&
          await sourcePublishesEmployer(tx, candidate.sourceKey, witnesses, normalized, target.id, follow.witnessesBefore)) {
          if (follow.mode === 'DEFER') throw new PublisherFollowDeferred(candidate.sourceKey, candidate.externalId);
          if (follow.mode === 'MASS_GUARDED') {
            throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, current.name, 'EMPLOYER_CHANGE_MASS', true);
          }
          return { company: target, rule: 'PUBLISHER_FOLLOWED', rawEmployerName, normalizedEmployerName: normalized,
            followedFrom: { companyId: current.id, name: current.name, previousLabel: previous.normalizedEmployerName } };
        }
        // D-520 : l'ancien et le nouveau libellé désignent la même Maison du registre de cette source (R-143 §5) — la
        // graphie change, l'employeur non. L'offre reste où l'ancien libellé l'avait mise.
        if (previous.canonicalEmployerId && await sameRegistryMaison(tx, candidate.sourceKey, previous.normalizedEmployerName, normalized,
          previous.canonicalEmployerId, current.id)) {
          return { company: current, rule: SAME_MAISON_RULE, rawEmployerName, normalizedEmployerName: normalized };
        }
        throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, current.name, 'EMPLOYER_SPELLING_DIVERGED', employerChange);
      }
    }
    if (current && (!target || current.id !== target.id)) {
      throw new EmployerIdentityReviewRequired(candidate.sourceKey, candidate.externalId, rawEmployerName, target?.name ?? candidate.company, 'EMPLOYER_TARGET_MISMATCH');
    }
  }
  return {
    company,
    rule: company && proposed?.mergedIntoId ? 'REVIEWED_MERGE' : (scoped || !company && candidate.rawEmployerName !== undefined) ? 'NATIVE_SOURCE_LABEL' : 'LEGACY_UNREVIEWED',
    rawEmployerName, normalizedEmployerName: normalized,
    ...(company && proposed?.mergedIntoId && proposed.identityReviewId ? { reviewId: proposed.identityReviewId } : {}),
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
