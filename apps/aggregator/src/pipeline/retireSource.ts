import type { PrismaClient } from '@prisma/client';

/**
 * Retires a source that left the catalogue (decision Loïc, 2026-09-03).
 *
 * Deleting a catalogue line has no lifecycle of its own: the rows it wrote
 * stay in base forever — the generation purge never touches them (the source
 * no longer runs, so nothing re-stamps or purges its rows) and the refresh
 * merely closes them after 48 h, leaving inactive offers attributed to a
 * label like « Cartier +3 ». Seen live with the Richemont route removal
 * (A-01/R-01), and needed again every time a Flux B board is abandoned.
 *
 * What it does, per job that carries a JobSource of the retired key:
 *   - the JobSource rows of that key are deleted;
 *   - a job whose ONLY source was the retired one is deleted outright — no
 *     source vouches for it any more, and D1 forbids showing what nothing
 *     backs (Google already got its 410 if refresh closed it earlier);
 *   - a job that other sources still list survives untouched, and if the
 *     retired source owned its canonical URL, the best remaining source
 *     takes over.
 */

export type RetireStats = {
  sourceKey: string;
  jobSourcesRemoved: number;
  jobsDeleted: number;
  jobsKept: number;
  urlsReassigned: number;
};

const TIER_ORDER = ['EMPLOYER_DIRECT', 'GROUP_OFFICIAL', 'ATS_OFFICIAL', 'SPECIALIST_JOBBOARD', 'AGGREGATOR'];

export async function retireSource(prisma: PrismaClient, sourceKey: string): Promise<RetireStats> {
  const stats: RetireStats = { sourceKey, jobSourcesRemoved: 0, jobsDeleted: 0, jobsKept: 0, urlsReassigned: 0 };

  const affected = await prisma.job.findMany({
    where: { sources: { some: { sourceKey } } },
    include: { sources: true },
  });

  for (const job of affected) {
    const retired = job.sources.filter((s) => s.sourceKey === sourceKey);
    const remaining = job.sources.filter((s) => s.sourceKey !== sourceKey);

    await prisma.$transaction(async (tx) => {
      await tx.jobSource.deleteMany({ where: { jobId: job.id, sourceKey } });
      stats.jobSourcesRemoved += retired.length;

      if (remaining.length === 0) {
        await tx.job.delete({ where: { id: job.id } });
        stats.jobsDeleted++;
        return;
      }

      stats.jobsKept++;
      // The retired source may have owned the canonical apply URL; hand it to
      // the best remaining source so the candidate never lands on a dead link.
      const ownedUrl = retired.some((s) => s.url === job.url);
      if (ownedUrl) {
        const best = [...remaining].sort(
          (a, b) => TIER_ORDER.indexOf(a.sourceTier) - TIER_ORDER.indexOf(b.sourceTier),
        )[0];
        await tx.job.update({
          where: { id: job.id },
          data: { url: best.url, canonicalTier: best.sourceTier },
        });
        stats.urlsReassigned++;
      }
    });
  }

  return stats;
}
