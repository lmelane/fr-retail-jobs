import { publicJobWhere } from '@catwalks/db/availability';
import { selectApplySource } from '@catwalks/db/publications';
import { lockCompanyRows } from '../lib/writeLocks.js';
import type { PrismaClient } from '@prisma/client';
import { provenPublicationGroup } from '../dedup/match.js';
import { recordPublicationAttachment } from '../dedup/decisions.js';

/** Consolidate groups only when all native publication identities agree.
 * No title, geography or taxonomy similarity is an identity proof. */

export type ReconcileStats = {
  clustersScanned: number;
  jobsMerged: number;
  sourcesMoved: number;
};

export async function runReconcile(prisma: PrismaClient): Promise<ReconcileStats> {
  const stats: ReconcileStats = { clustersScanned: 0, jobsMerged: 0, sourcesMoved: 0 };

  // Only clusters holding more than one live job can contain a missed merge.
  const groups = await prisma.job.groupBy({
    by: ['clusterKey'],
    where: { ...publicJobWhere(), clusterKey: { not: null } },
    _count: { _all: true },
    having: { clusterKey: { _count: { gt: 1 } } },
  });

  for (const group of groups) {
    if (!group.clusterKey) continue;
    stats.clustersScanned++;

    const planned = await prisma.job.findMany({
      where: { clusterKey: group.clusterKey, ...publicJobWhere() }, select: { companyId: true },
    });
    await prisma.$transaction(async tx => {
      await lockCompanyRows(tx, planned.map(job => job.companyId));
      const jobs = await tx.job.findMany({
        where: { clusterKey: group.clusterKey, ...publicJobWhere(), companyId: { in: planned.map(job => job.companyId) } },
        include: { sources: true },
        orderBy: [{ firstSeenAt: 'asc' }, { id: 'asc' }],
      });

      const absorbed = new Set<string>();

      for (let i = 0; i < jobs.length; i++) {
        const keeper = jobs[i];
        if (absorbed.has(keeper.id)) continue;
        // A same-feed collision or unqualified historical member makes this
        // whole employer bucket ambiguous; never bridge it through a third feed.
        if (!provenPublicationGroup(jobs.filter(job => job.companyId === keeper.companyId).flatMap(job => job.sources))) continue;

        for (let j = i + 1; j < jobs.length; j++) {
          const other = jobs[j];
          if (absorbed.has(other.id) || keeper.companyId !== other.companyId) continue;
          if (keeper.opportunityType && other.opportunityType && keeper.opportunityType !== other.opportunityType) continue;
          if (!provenPublicationGroup([...keeper.sources, ...other.sources])) continue;

          // Merge in ONE transaction: move the loser's sources onto the keeper,
          // promote the URL if the loser ranks higher, then retire the loser.
          // Atomic on purpose — a crash between moving the sources and retiring the
          // loser would otherwise leave two active jobs sharing the same sources,
          // re-introducing the very duplicate reconcile exists to remove.
          const owner = selectApplySource([...keeper.sources, ...other.sources], keeper);
          const promote = owner && other.sources.some(source => source.id === owner.id);
          for (const source of other.sources) await recordPublicationAttachment(tx, source, keeper.sources, other.id, keeper.id);
          const moved = await tx.jobSource.updateMany({ where: { jobId: other.id }, data: { jobId: keeper.id } });
          if (owner) {
            const patch = {
              url: owner.url, canonicalTier: owner.sourceTier,
              ...(promote ? { title: owner.title ?? other.title } : {}),
              canonicalSourceKey: owner.sourceKey, canonicalExternalId: owner.externalId,
            };
            await tx.job.update({ where: { id: keeper.id }, data: patch });
            Object.assign(keeper, patch);
          }
          keeper.sources.push(...other.sources);
          // Preserve the old ID/URL as a redirect. Consolidation is not a
          // source closure: keep its original closedAt and every prior event.
          await tx.job.update({
            where: { id: other.id },
            data: {
              isActive: false,
              mergedIntoId: keeper.id,
              events: { create: { type: 'MERGED', field: 'mergedInto', after: keeper.id } },
            },
          });
          stats.sourcesMoved += moved.count;
          absorbed.add(other.id);
          stats.jobsMerged++;
        }
      }
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  return stats;
}
