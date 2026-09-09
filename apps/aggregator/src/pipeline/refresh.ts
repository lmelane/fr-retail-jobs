import { log } from '../observability/logger.js';
import type { PrismaClient } from '@prisma/client';
import { selectCanonicalSource } from '../dedup/canonical.js';
import { lockCompanyRows } from '../lib/writeLocks.js';
import { chunk } from '../lib/chunk.js';
import { recordEvents } from './jobEvents.js';
import { deactivateJob, reactivateJob } from './lifecycle.js';

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
  withdrawn: number;
  republished: number;
  /** Sources excluded from closure because their last health run was BROKEN. */
  skippedBrokenSources: string[];
  /** True when a mass-closure guard refused the run without closing anything. */
  refused: boolean;
};

/**
 * Sources whose most recent run did not complete healthily: BROKEN (returned
 * nothing), TIMEOUT (cut before finishing) or ERROR (threw). All three mean
 * the same thing for lifecycle purposes (L-01): the source did NOT re-attest
 * its offers this run, so their silence proves nothing — closing on it would
 * manufacture the "Maison stopped hiring" illusion.
 */
/** Missing or legacy evidence cannot authorize an automatic closure. */
async function brokenSourceKeys(prisma: PrismaClient, cutoff: Date): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ sourceKey: string; canAttestAbsence: boolean | null; ranAt: Date }>>`
    SELECT DISTINCT ON ("sourceKey") "sourceKey", "canAttestAbsence", "ranAt"
    FROM "SourceRun" ORDER BY "sourceKey", "ranAt" DESC, "id" DESC
  `;
  const trusted = new Set(rows.filter(row => row.canAttestAbsence === true && row.ranAt >= cutoff).map(row => row.sourceKey));
  const sources = await prisma.jobSource.findMany({
    where: { isActive: true }, distinct: ['sourceKey'], select: { sourceKey: true },
  });
  return new Set(sources.filter(row => !trusted.has(row.sourceKey)).map(row => row.sourceKey));
}

export async function runRefresh(
  prisma: PrismaClient,
  options: RefreshOptions = {},
): Promise<RefreshStats> {
  const staleHours = options.staleHours ?? STALE_HOURS;
  const maxCloseRatio = options.maxCloseRatio ?? MAX_CLOSE_RATIO;
  const minCloseForGuard = options.minCloseForGuard ?? MIN_CLOSE_FOR_GUARD;
  const cutoff = new Date(Date.now() - staleHours * 3_600_000);

  const skipped = await brokenSourceKeys(prisma, cutoff);
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
  const orphans = await prisma.job.findMany({
    where: { isActive: true, sources: { none: { isActive: true } } }, select: { id: true },
  });
  const wouldClose: string[] = orphans.map(j => j.id);
  if (staleJobIds.size > 0) {
    for (const ids of chunk([...staleJobIds])) {
    const affected = await prisma.job.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, sources: { select: { id: true, isActive: true } } },
    });
    const staleSourceIds = new Set(staleSources.map((s) => s.id));
    for (const job of affected) {
      const remainsActive = job.sources.some((s) => s.isActive && !staleSourceIds.has(s.id));
      if (!remainsActive) wouldClose.push(job.id);
    }
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
    await log.error('refresh.refused', `[refresh] REFUSED: would close ${wouldClose.length} of ${liveTotal} live offers ` +
        `(> ${Math.round(maxCloseRatio * 100)}%). A source is likely broken — not closing anything.`);
    return {
      checked: liveTotal,
      closedSources: 0,
      closedJobs: 0,
      reopened: 0,
      withdrawn: 0,
      republished: 0,
      skippedBrokenSources,
      refused: true,
    };
  }

  // Re-read under the same company lock as ingestion. A fresh re-attestation
  // between planning and writing must survive, and events must match committed transitions.
  const candidates = new Set([...staleJobIds, ...orphans.map(j => j.id)]);
  const revived = await prisma.job.findMany({
    where: { isActive: false, sources: { some: { isActive: true } } }, select: { id: true },
  });
  for (const job of revived) candidates.add(job.id);
  const closedSources = { count: 0 }, closedJobs = { count: 0 }, reopened = { count: 0 };
  let withdrawn = 0, republished = 0;
  for (const ids of chunk([...candidates], 100)) {
    const planned = await prisma.job.findMany({ where: { id: { in: ids } }, select: { id: true, companyId: true } });
    const companies = new Map<string, string[]>();
    for (const job of planned) companies.set(job.companyId, [...(companies.get(job.companyId) ?? []), job.id]);
    for (const [companyId, jobIds] of companies) {
      const counts = await prisma.$transaction(async tx => {
        await lockCompanyRows(tx, [companyId]);
        // Another maintenance operation may have moved an offer since planning.
        const currentJobs = await tx.job.findMany({
          where: { id: { in: jobIds }, companyId }, select: { id: true },
        });
        const currentIds = currentJobs.map(job => job.id);
        const deactivated = await tx.jobSource.updateMany({
          where: { jobId: { in: currentIds }, isActive: true, lastSeenAt: { lt: cutoff },
            ...(skipped.size ? { sourceKey: { notIn: skippedBrokenSources } } : {}) },
          data: { isActive: false },
        });
        const jobs = await tx.job.findMany({ where: { id: { in: currentIds } }, include: { sources: true } });
        let closed = 0, opened = 0, removed = 0, published = 0;
        const now = new Date();
        for (const job of jobs) {
          const owner = selectCanonicalSource(job.sources, job);
          const active = !!owner;
          const transition = active ? reactivateJob(job) : deactivateJob(job,
            // An orphan has no usable attestation. Its absence alone cannot
            // establish an employer closure; only the trusted stale set can.
            staleJobIds.has(job.id) ? { kind: 'CLOSED' } : { kind: 'WITHDRAWN', reason: 'ATTESTATION_MISSING' }, now);
          const changedOwner = owner && (job.canonicalSourceKey !== owner.sourceKey ||
            job.canonicalExternalId !== owner.externalId || job.url !== owner.url);
          if (!transition && !changedOwner) continue;
          await tx.job.update({ where: { id: job.id }, data: {
            ...transition?.data,
            ...(owner ? { url: owner.url, canonicalTier: owner.sourceTier,
              canonicalSourceKey: owner.sourceKey, canonicalExternalId: owner.externalId } : {}),
          } });
          if (transition) {
            await recordEvents(tx, [{ jobId: job.id, type: transition.type, at: now,
              ...(transition.type === 'WITHDRAWN' ? { after: 'ATTESTATION_MISSING' } : {}) }]);
            if (transition.type === 'REOPENED') opened++;
            else if (transition.type === 'REPUBLISHED') published++;
            else if (transition.type === 'WITHDRAWN') removed++;
            else closed++;
          }
        }
        return { sources: deactivated.count, closed, opened, removed, published };
      }, { maxWait: 10_000, timeout: 30_000 });
      closedSources.count += counts.sources;
      closedJobs.count += counts.closed;
      reopened.count += counts.opened;
      withdrawn += counts.removed;
      republished += counts.published;
    }
  }

  const checked = await prisma.job.count();

  return {
    checked,
    closedSources: closedSources.count,
    closedJobs: closedJobs.count,
    reopened: reopened.count,
    withdrawn,
    republished,
    skippedBrokenSources,
    refused: false,
  };
}
