import type { Prisma, PrismaClient } from '@prisma/client';
import { lockCompanyRows } from '../lib/writeLocks.js';
import { selectCanonicalSource } from '../dedup/canonical.js';
import { recordEvents } from './jobEvents.js';
import { assertSourceRunning } from '../lib/sourceBudget.js';

/** Close source attestations without deleting offer URLs or their history. */
export async function deactivateSources(
  prisma: PrismaClient,
  sourceWhere: Prisma.JobSourceWhereInput,
  jobWhere: Prisma.JobWhereInput = {},
) {
  const stats = { sourcesDeactivated: 0, jobsClosed: 0, jobsKept: 0, urlsReassigned: 0 };
  const planned = await prisma.job.findMany({
    where: { ...jobWhere, sources: { some: { ...sourceWhere, isActive: true } } },
    select: { id: true, companyId: true },
  });
  for (const plan of planned) {
    assertSourceRunning();
    const delta = await prisma.$transaction(async tx => {
      await lockCompanyRows(tx, [plan.companyId]);
      assertSourceRunning();
      const job = await tx.job.findFirst({
        where: { ...jobWhere, id: plan.id, companyId: plan.companyId },
        include: { sources: true }, omit: { searchText: true, raw: true },
      });
      if (!job) return null;
      const changed = await tx.jobSource.updateMany({
        where: { ...sourceWhere, jobId: job.id, isActive: true }, data: { isActive: false },
      });
      if (!changed.count) return null;
      const sources = await tx.jobSource.findMany({ where: { jobId: job.id } });
      const owner = selectCanonicalSource(sources, job);
      const closes = !owner && job.isActive;
      const now = new Date();
      await tx.job.update({ where: { id: job.id }, data: {
        ...(!owner ? { isActive: false, closedAt: job.closedAt ?? now } : {}),
        ...(owner ? { url: owner.url, canonicalTier: owner.sourceTier,
          canonicalSourceKey: owner.sourceKey, canonicalExternalId: owner.externalId } : {}),
      } });
      if (closes) await recordEvents(tx, [{ jobId: job.id, type: 'CLOSED', at: now }]);
      assertSourceRunning();
      return { sourcesDeactivated: changed.count, jobsClosed: closes ? 1 : 0,
        jobsKept: owner ? 1 : 0, urlsReassigned: owner && owner.url !== job.url ? 1 : 0 };
    }, { maxWait: 10_000, timeout: 30_000 });
    if (delta) for (const key of Object.keys(stats) as Array<keyof typeof stats>) stats[key] += delta[key];
  }
  return stats;
}
