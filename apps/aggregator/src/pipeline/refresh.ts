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
 *
 * Two guard rails protect against a source failure emptying the board (both
 * observed as real risks in the audit):
 *  - a source whose last health run was BROKEN is EXCLUDED from closure — its
 *    offers still exist, the feed simply went silent, so closing them would be
 *    the "the Maison stopped hiring" illusion the whole pipeline fights;
 *  - a run that would close more than `maxCloseRatio` of the live base at once
 *    is refused: that is a systemic failure, not normal lifecycle churn.
 */

/** How long a source must stay silent before its listing counts as gone. */
const STALE_HOURS = Number(process.env.REFRESH_STALE_HOURS ?? 48);

/**
 * Refuse to close more than this share of the live base in one run. A real day
 * of expirations is a few percent; anything approaching this is a broken feed.
 */
const MAX_CLOSE_RATIO = Number(process.env.REFRESH_MAX_CLOSE_RATIO ?? 0.5);

/**
 * The ratio guard only applies once the absolute count is meaningful. Closing a
 * handful of offers is always normal lifecycle, whatever the base size — the
 * guard is there to catch a source failure taking hundreds down at once, not to
 * block a small board's ordinary expirations.
 */
const MIN_CLOSE_FOR_GUARD = Number(process.env.REFRESH_MIN_CLOSE_FOR_GUARD ?? 50);

export type RefreshOptions = {
  staleHours?: number;
  maxCloseRatio?: number;
  minCloseForGuard?: number;
};

export type RefreshStats = {
  checked: number;
  closedSources: number;
  closedJobs: number;
  reopened: number;
  /** Sources excluded from closure because their last health run was BROKEN. */
  skippedBrokenSources: string[];
  /** True when a mass-closure guard refused the run without closing anything. */
  refused: boolean;
};

/** Sources whose most recent health run was BROKEN. */
async function brokenSourceKeys(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.sourceRun.findMany({
    orderBy: { ranAt: 'desc' },
    select: { sourceKey: true, status: true },
  });
  const seen = new Set<string>();
  const broken = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.sourceKey)) continue; // only the latest run per source
    seen.add(row.sourceKey);
    if (row.status === 'BROKEN') broken.add(row.sourceKey);
  }
  return broken;
}

export async function runRefresh(
  prisma: PrismaClient,
  options: RefreshOptions = {},
): Promise<RefreshStats> {
  const staleHours = options.staleHours ?? STALE_HOURS;
  const maxCloseRatio = options.maxCloseRatio ?? MAX_CLOSE_RATIO;
  const minCloseForGuard = options.minCloseForGuard ?? MIN_CLOSE_FOR_GUARD;
  const cutoff = new Date(Date.now() - staleHours * 3_600_000);

  const skipped = await brokenSourceKeys(prisma);
  const skippedBrokenSources = [...skipped];

  // Which source listings are stale AND belong to a source that is not broken.
  // A broken source's listings are left active so its offers are not closed.
  const staleSources = await prisma.jobSource.findMany({
    where: {
      isActive: true,
      lastSeenAt: { lt: cutoff },
      ...(skipped.size ? { sourceKey: { notIn: skippedBrokenSources } } : {}),
    },
    select: { id: true, jobId: true },
  });

  // Which jobs WOULD close: those where, after deactivating the stale sources
  // above, no active source would remain. Compute before writing anything so the
  // mass-closure guard can refuse first.
  const staleJobIds = new Set(staleSources.map((s) => s.jobId));
  const wouldClose: string[] = [];
  if (staleJobIds.size > 0) {
    const affected = await prisma.job.findMany({
      where: { id: { in: [...staleJobIds] }, isActive: true },
      select: { id: true, sources: { select: { id: true, isActive: true } } },
    });
    const staleSourceIds = new Set(staleSources.map((s) => s.id));
    for (const job of affected) {
      const remainsActive = job.sources.some((s) => s.isActive && !staleSourceIds.has(s.id));
      if (!remainsActive) wouldClose.push(job.id);
    }
  }

  const liveTotal = await prisma.job.count({ where: { isActive: true } });

  // Guard rail: refuse a mass closure. Nothing is written. Only kicks in past an
  // absolute floor, so a small board's ordinary expirations are never blocked.
  if (
    wouldClose.length >= minCloseForGuard &&
    liveTotal > 0 &&
    wouldClose.length / liveTotal > maxCloseRatio
  ) {
    console.error(
      `[refresh] REFUSED: would close ${wouldClose.length} of ${liveTotal} live offers ` +
        `(> ${Math.round(maxCloseRatio * 100)}%). A source is likely broken — not closing anything.`,
    );
    return {
      checked: liveTotal,
      closedSources: 0,
      closedJobs: 0,
      reopened: 0,
      skippedBrokenSources,
      refused: true,
    };
  }

  // 1. Deactivate stale (non-broken) source listings.
  const closedSources = staleSources.length
    ? await prisma.jobSource.updateMany({
        where: { id: { in: staleSources.map((s) => s.id) } },
        data: { isActive: false },
      })
    : { count: 0 };

  // 2. Close jobs with no active source left.
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

  // 3. Reopen a closed job whose source came back, rather than duplicating it.
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
    skippedBrokenSources,
    refused: false,
  };
}
