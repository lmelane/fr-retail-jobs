import { lockOccupationTaxonomy } from '@catwalks/db/occupations';
import { publicationJobPatch } from '../publication/presentation.js';
import type { Prisma, PrismaClient } from '@prisma/client';
import { lockCompanyRows } from '../lib/writeLocks.js';
import { selectApplySource } from '@catwalks/db/publications';
import { recordEvents, changedEvents, diffStructuralFields, structuralValuesOf } from './jobEvents.js';
import { recordOccupationObservation } from '../occupation/persist.js';
import { assertSourceRunning } from '../lib/sourceBudget.js';
import { deactivateJob, type DeactivationDisposition } from './lifecycle.js';

/** Close source attestations without deleting offer URLs or their history. */
export async function deactivateSources(
  prisma: PrismaClient,
  sourceWhere: Prisma.JobSourceWhereInput,
  disposition: DeactivationDisposition,
  jobWhere: Prisma.JobWhereInput = {},
) {
  const stats = { sourcesDeactivated: 0, jobsClosed: 0, jobsWithdrawn: 0, jobsKept: 0, urlsReassigned: 0 };
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
      const owner = selectApplySource(sources, job);
      const now = new Date();
      const transition = !owner ? deactivateJob(job, disposition, now) : null;
      const changedOwner = owner && (owner.sourceKey !== job.canonicalSourceKey || owner.externalId !== job.canonicalExternalId || owner.url !== job.url);
      const content = changedOwner ? publicationJobPatch(owner, await lockOccupationTaxonomy(tx)) : {};
      const written = await tx.job.update({ where: { id: job.id }, data: { ...transition?.data, ...content } });
      if (changedOwner) {
        await recordOccupationObservation(tx, written, job);
        await recordEvents(tx, changedEvents(job.id, diffStructuralFields(structuralValuesOf(job), structuralValuesOf(content)), now));
      }
      if (transition) await recordEvents(tx, [{ jobId: job.id, type: transition.type, at: now,
        ...(disposition.kind === 'WITHDRAWN' ? { after: disposition.reason } : {}) }]);
      assertSourceRunning();
      return { sourcesDeactivated: changed.count, jobsClosed: transition?.type === 'CLOSED' ? 1 : 0,
        jobsWithdrawn: transition?.type === 'WITHDRAWN' ? 1 : 0,
        jobsKept: owner ? 1 : 0, urlsReassigned: owner && owner.url !== job.url ? 1 : 0 };
    }, { maxWait: 10_000, timeout: 30_000 });
    if (delta) for (const key of Object.keys(stats) as Array<keyof typeof stats>) stats[key] += delta[key];
  }
  return stats;
}
