import type { PrismaClient } from '@prisma/client';

/**
 * Per-source generation purge (decision D6).
 *
 * Runs ONLY after a source's ingest has succeeded, so every offer that source
 * still lists has just been rewritten at the current pipeline version. Anything
 * of THIS source left below that version is an offer the source no longer
 * carries — a stale row from an older generation.
 *
 * Why per-source instead of a single global `deleteMany` at the top of the run:
 *  - a global purge before fetching empties the base if the fetch then fails
 *    (a redeploy kills the container, every host 403s) — observed in production;
 *  - it also deletes companies enriched by discovery.
 * Purging a source's own stale rows only after that source succeeded means a
 * broken feed can never empty anything.
 *
 * A job carried by several sources is not deleted when one source goes stale —
 * only that source's JobSource row is detached. The job is removed only when it
 * has no live source left, which is the same rule the refresh pass applies.
 */
export type PurgeResult = {
  sourceKey: string;
  /** Stale JobSource rows of this source that were detached. */
  sourcesDetached: number;
  /** Jobs removed because they had no source left after detaching. */
  jobsDeleted: number;
};

export async function purgeStaleForSource(
  prisma: PrismaClient,
  sourceKey: string,
  version: number,
): Promise<PurgeResult> {
  // Jobs below the current generation that still hold a source row for THIS
  // source. Because a successful run stamps the current version on every offer
  // it re-saw (create, merge and the race-recovery path all write
  // pipelineVersion), a sub-version job with this source is one the source did
  // not report this run.
  const staleJobs = await prisma.job.findMany({
    where: {
      pipelineVersion: { lt: version },
      sources: { some: { sourceKey } },
    },
    select: { id: true, sources: { select: { id: true, sourceKey: true } } },
  });

  if (staleJobs.length === 0) {
    return { sourceKey, sourcesDetached: 0, jobsDeleted: 0 };
  }

  const jobsToDelete: string[] = [];
  const survivorsToDetach: string[] = [];
  for (const job of staleJobs) {
    const others = job.sources.filter((source) => source.sourceKey !== sourceKey);
    if (others.length === 0) {
      // No other source keeps this offer alive -> the whole job goes (its
      // JobSource rows cascade with it).
      jobsToDelete.push(job.id);
    } else {
      // The offer survives on another source; only detach this source's row.
      survivorsToDetach.push(job.id);
    }
  }

  // One transaction: detach this source's stale rows, then delete the jobs left
  // with no source. Atomic, so a crash mid-purge cannot leave a job stripped of
  // its sources but still present.
  const [detached] = await prisma.$transaction([
    // Deleting the job cascades to its remaining JobSource rows, so only detach
    // sources of jobs that survive; the rest go with their job.
    prisma.jobSource.deleteMany({
      where: { sourceKey, jobId: { in: survivorsToDetach } },
    }),
    prisma.job.deleteMany({ where: { id: { in: jobsToDelete } } }),
  ]);

  return {
    sourceKey,
    sourcesDetached: detached.count,
    jobsDeleted: jobsToDelete.length,
  };
}
