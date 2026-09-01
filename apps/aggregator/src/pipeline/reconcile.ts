import type { PrismaClient } from '@prisma/client';
import { isProbableDuplicate, SOURCE_PRIORITY, type CandidateJob } from '../dedup/match.js';

/**
 * RECONCILE — retroactive merges.
 *
 * Dedup happens at write time, so the database is already duplicate-free under
 * the rules in force when each job was written. This pass exists for the case
 * those rules CHANGE: adding an alias (BVLGARI = BULGARI) or a role synonym makes
 * previously distinct jobs mergeable after the fact.
 *
 * It is a weekly consolidation, never the mechanism that keeps data clean — if
 * this pass is what removes your duplicates, write-time dedup is broken.
 */

export type ReconcileStats = {
  clustersScanned: number;
  jobsMerged: number;
  sourcesMoved: number;
};

function tierRank(tier: string | null): number {
  const index = SOURCE_PRIORITY.indexOf(tier as (typeof SOURCE_PRIORITY)[number]);
  return index === -1 ? SOURCE_PRIORITY.length : index;
}

export async function runReconcile(prisma: PrismaClient): Promise<ReconcileStats> {
  const stats: ReconcileStats = { clustersScanned: 0, jobsMerged: 0, sourcesMoved: 0 };

  // Only clusters holding more than one live job can contain a missed merge.
  const groups = await prisma.job.groupBy({
    by: ['clusterKey'],
    where: { isActive: true, clusterKey: { not: null } },
    _count: { _all: true },
    having: { clusterKey: { _count: { gt: 1 } } },
  });

  for (const group of groups) {
    if (!group.clusterKey) continue;
    stats.clustersScanned++;

    const jobs = await prisma.job.findMany({
      where: { clusterKey: group.clusterKey, isActive: true },
      include: { sources: true },
      orderBy: { firstSeenAt: 'asc' },
    });

    const absorbed = new Set<string>();

    for (let i = 0; i < jobs.length; i++) {
      const keeper = jobs[i];
      if (absorbed.has(keeper.id)) continue;

      for (let j = i + 1; j < jobs.length; j++) {
        const other = jobs[j];
        if (absorbed.has(other.id)) continue;

        const asCandidate = (job: (typeof jobs)[number]): CandidateJob => ({
          externalId: job.externalId,
          title: job.title,
          location: job.location ?? undefined,
          url: job.url,
          postedAt: job.postedAt ?? undefined,
          company: job.clusterKey ?? '',
          sourceKey: '',
          sourceTier: (job.canonicalTier as CandidateJob['sourceTier']) ?? 'AGGREGATOR',
        });

        if (!isProbableDuplicate(asCandidate(keeper), asCandidate(other))) continue;

        // Move the loser's sources onto the keeper, then retire the loser.
        const moved = await prisma.jobSource.updateMany({
          where: { jobId: other.id },
          data: { jobId: keeper.id },
        });
        stats.sourcesMoved += moved.count;

        // The best tier across the pair keeps the canonical apply URL.
        if (tierRank(other.canonicalTier) < tierRank(keeper.canonicalTier)) {
          await prisma.job.update({
            where: { id: keeper.id },
            data: { url: other.url, canonicalTier: other.canonicalTier, title: other.title },
          });
        }

        await prisma.job.update({ where: { id: other.id }, data: { isActive: false } });
        absorbed.add(other.id);
        stats.jobsMerged++;
      }
    }
  }

  return stats;
}
