import type { PrismaClient } from '@prisma/client';
import { blockingKey, isProbableDuplicate, SOURCE_PRIORITY, type CandidateJob } from './match.js';

/**
 * Write-time deduplication — the guarantee that the database NEVER holds the same
 * opening twice, not even for a second.
 *
 * Deduplicating on a schedule would leave a window in which the front end shows
 * one job three times: Dior posts, LVMH republishes two hours later, and the
 * duplicate is visible until the next pass. So dedup is an INSERT rule, not a
 * periodic job:
 *
 *   1. compute the cluster key (resolved company + normalized city)
 *   2. compare against live jobs already in that cluster
 *   3. match  -> attach a JobSource, and promote the canonical URL if this
 *                source outranks the current one
 *      no match -> create the Job, with its first JobSource
 *
 * A separate weekly reconcile pass still earns its place, but only for
 * retroactive merges after an alias or synonym is added — never as the mechanism
 * that keeps the data clean.
 */

function tierRank(tier: string): number {
  const index = SOURCE_PRIORITY.indexOf(tier as (typeof SOURCE_PRIORITY)[number]);
  // An unknown tier must never outrank a known one.
  return index === -1 ? SOURCE_PRIORITY.length : index;
}

export type UpsertOutcome = 'CREATED' | 'MERGED' | 'UPDATED';

export type UpsertResult = {
  jobId: string;
  outcome: UpsertOutcome;
  /** True when this source took over the canonical apply URL. */
  promoted: boolean;
};

/**
 * Inserts one posting, merging it into an existing cluster when it is the same
 * opening. `companyId` is the resolved identity, not the raw source string.
 */
export async function upsertDeduplicated(
  prisma: PrismaClient,
  candidate: CandidateJob & { companyId: string },
): Promise<UpsertResult> {
  const clusterKey = blockingKey(candidate);
  const now = new Date();

  // Only live jobs in the same cluster can absorb this posting. The cluster key
  // is indexed, so this stays a narrow lookup rather than a scan.
  const clusterJobs = await prisma.job.findMany({
    where: { clusterKey, isActive: true },
    include: { sources: true },
  });

  const existing = clusterJobs.find((job) =>
    isProbableDuplicate(candidate, {
      ...candidate,
      title: job.title,
      location: job.location ?? undefined,
      postedAt: job.postedAt ?? undefined,
    }),
  );

  if (!existing) {
    const created = await prisma.job.create({
      data: {
        companyId: candidate.companyId,
        externalId: candidate.externalId,
        source: 'GENERIC_JSONLD',
        title: candidate.title,
        location: candidate.location,
        country: candidate.country,
        contract: candidate.contract,
        description: candidate.description,
        url: candidate.url,
        postedAt: candidate.postedAt,
        clusterKey,
        canonicalTier: candidate.sourceTier,
        fingerprint: `${clusterKey}|${candidate.title}`,
        lastSeenAt: now,
        sources: {
          create: {
            sourceKey: candidate.sourceKey,
            sourceTier: candidate.sourceTier,
            externalId: candidate.externalId,
            url: candidate.url,
            title: candidate.title,
            postedAt: candidate.postedAt,
            lastSeenAt: now,
          },
        },
      },
    });
    return { jobId: created.id, outcome: 'CREATED', promoted: true };
  }

  const alreadyKnown = existing.sources.some(
    (source) => source.sourceKey === candidate.sourceKey && source.externalId === candidate.externalId,
  );

  await prisma.jobSource.upsert({
    where: {
      sourceKey_externalId: {
        sourceKey: candidate.sourceKey,
        externalId: candidate.externalId,
      },
    },
    create: {
      jobId: existing.id,
      sourceKey: candidate.sourceKey,
      sourceTier: candidate.sourceTier,
      externalId: candidate.externalId,
      url: candidate.url,
      title: candidate.title,
      postedAt: candidate.postedAt,
      lastSeenAt: now,
    },
    update: { url: candidate.url, title: candidate.title, lastSeenAt: now, isActive: true },
  });

  // A better-ranked source takes over the canonical apply URL: a candidate should
  // always be sent to the employer when the employer is publishing the role.
  const promoted = tierRank(candidate.sourceTier) < tierRank(existing.canonicalTier ?? '');

  await prisma.job.update({
    where: { id: existing.id },
    data: {
      lastSeenAt: now,
      isActive: true,
      ...(promoted
        ? {
            url: candidate.url,
            canonicalTier: candidate.sourceTier,
            title: candidate.title,
            // Keep the richest description available across sources.
            ...(candidate.description && candidate.description.length > (existing.description?.length ?? 0)
              ? { description: candidate.description }
              : {}),
          }
        : {}),
    },
  });

  return {
    jobId: existing.id,
    outcome: alreadyKnown ? 'UPDATED' : 'MERGED',
    promoted,
  };
}
