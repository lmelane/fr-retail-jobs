import type { PrismaClient } from '@prisma/client';

/**
 * REFRESH — lifecycle pass: NEW / UNCHANGED / UPDATED / CLOSED.
 *
 * Ingest only ever proves a job still EXISTS; nothing there can prove one is
 * gone. This pass closes that gap by looking at what ingest did NOT touch.
 *
 * A job is closed when every one of its sources has stopped reporting it for
 * longer than the staleness window. Requiring *all* sources to agree is what
 * makes a lower-priority source worth keeping attached: if the Maison's ATS goes
 * quiet for a day but the jobboard still lists the role, the offer stays open.
 */

/** How long a source must stay silent before its listing counts as gone. */
const STALE_HOURS = Number(process.env.REFRESH_STALE_HOURS ?? 48);

export type RefreshStats = {
  checked: number;
  closedSources: number;
  closedJobs: number;
  reopened: number;
};

export async function runRefresh(prisma: PrismaClient): Promise<RefreshStats> {
  const cutoff = new Date(Date.now() - STALE_HOURS * 3_600_000);

  // 1. Any source listing not seen since the cutoff is considered gone.
  const closedSources = await prisma.jobSource.updateMany({
    where: { isActive: true, lastSeenAt: { lt: cutoff } },
    data: { isActive: false },
  });

  // 2. A job closes only when it has no active source left anywhere.
  const orphaned = await prisma.job.findMany({
    where: { isActive: true, sources: { none: { isActive: true } } },
    select: { id: true },
  });

  const closedJobs = orphaned.length
    ? await prisma.job.updateMany({
        where: { id: { in: orphaned.map((job) => job.id) } },
        data: { isActive: false },
      })
    : { count: 0 };

  // 3. A closed job whose source came back is reopened rather than duplicated —
  //    postings do reappear after a pause, and a new row would break its history.
  const revived = await prisma.job.findMany({
    where: { isActive: false, sources: { some: { isActive: true } } },
    select: { id: true },
  });

  const reopened = revived.length
    ? await prisma.job.updateMany({
        where: { id: { in: revived.map((job) => job.id) } },
        data: { isActive: true },
      })
    : { count: 0 };

  const checked = await prisma.job.count();

  return {
    checked,
    closedSources: closedSources.count,
    closedJobs: closedJobs.count,
    reopened: reopened.count,
  };
}
