import { selectCanonicalSource } from '../dedup/canonical.js';
import { lockCompanyRows } from '../lib/writeLocks.js';
import { hasRequisitionConflict } from '../dedup/postingIdentity.js';
import type { PrismaClient } from '@prisma/client';
import { cannotBeSameOpening, isProbableDuplicate, type CandidateJob } from '../dedup/match.js';

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

    const planned = await prisma.job.findMany({
      where: { clusterKey: group.clusterKey, isActive: true }, select: { companyId: true },
    });
    await prisma.$transaction(async tx => {
      await lockCompanyRows(tx, planned.map(job => job.companyId));
      const jobs = await tx.job.findMany({
        where: { clusterKey: group.clusterKey, isActive: true, companyId: { in: planned.map(job => job.companyId) } },
        include: { sources: true },
        orderBy: [{ firstSeenAt: 'asc' }, { id: 'asc' }],
      });

      const absorbed = new Set<string>();

      for (let i = 0; i < jobs.length; i++) {
        const keeper = jobs[i];
        if (absorbed.has(keeper.id)) continue;
        const members = [{ ...keeper, sources: [...keeper.sources] }];

        for (let j = i + 1; j < jobs.length; j++) {
          const other = jobs[j];
          if (absorbed.has(other.id)) continue;
          if (hasRequisitionConflict([...keeper.sources, ...other.sources].map(source => source.url))) continue;

          const asCandidate = (job: (typeof jobs)[number]): CandidateJob => ({
            externalId: job.externalId,
            title: job.title,
            country: job.countryCode ?? undefined,
            city: job.city ?? undefined,
            location: job.location ?? undefined,
            url: job.url,
            postedAt: job.postedAt ?? undefined,
            company: job.clusterKey ?? '',
            // The job's own source key, not an empty string: an empty key on both
            // sides made cannotBeSameOpening fire (same source, different ids) and
            // blocked EVERY merge. A real key still guards the true case — two
            // offers from the SAME source never merge — while letting two jobs from
            // different sources be recognised as one opening.
            sourceKey: job.sources[0]?.sourceKey ?? job.id,
            sourceTier: (job.canonicalTier as CandidateJob['sourceTier']) ?? 'AGGREGATOR',
          });

          // Preserve every veto after absorbing an intermediate posting whose
          // country or date was missing. Reconcile must not undo ingest guards.
          if (members.some(member => cannotBeSameOpening(asCandidate(member), asCandidate(other)))) continue;
          if (members.some(member => member.sources.some(source =>
            other.sources.some(peer => peer.sourceKey === source.sourceKey && peer.externalId !== source.externalId),
          ))) continue;
          if (!isProbableDuplicate(asCandidate(keeper), asCandidate(other))) continue;

          // Merge in ONE transaction: move the loser's sources onto the keeper,
          // promote the URL if the loser ranks higher, then retire the loser.
          // Atomic on purpose — a crash between moving the sources and retiring the
          // loser would otherwise leave two active jobs sharing the same sources,
          // re-introducing the very duplicate reconcile exists to remove.
          const owner = selectCanonicalSource([...keeper.sources, ...other.sources], keeper);
          const promote = owner && other.sources.some(source => source.id === owner.id);
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
          // Le perdant n'est pas une fermeture de poste : daté (closedAt) pour
          // sortir des actives, et tracé MERGED — jamais CLOSED — pour que la
          // photographie du jour ne le compte pas comme une offre fermée (audit I-2).
          await tx.job.update({
            where: { id: other.id },
            data: {
              isActive: false,
              closedAt: new Date(),
              events: { create: { type: 'MERGED', field: 'mergedInto', after: keeper.id } },
            },
          });
          stats.sourcesMoved += moved.count;
          absorbed.add(other.id);
          members.push(other);
          stats.jobsMerged++;
        }
      }
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  return stats;
}
