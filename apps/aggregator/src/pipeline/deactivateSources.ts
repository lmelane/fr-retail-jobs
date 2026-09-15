import { lockOccupationTaxonomy } from '@catwalks/db/occupations';
import { publicationJobPatch } from '../publication/presentation.js';
import type { Prisma, PrismaClient } from '@prisma/client';
import { lockCompanyRows, lockSourceWrites } from '../lib/writeLocks.js';
import { randomUUID } from 'node:crypto';
import { evidenceHash } from '../lib/evidenceHash.js';
import { quarantineSnapshot } from './refreshManifest.js';
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
  // An explicit Job scope cannot include unattached publications. Otherwise a
  // retired source must drain these observations too, without any Job event.
  if (!Object.keys(jobWhere).length) {
    const detached = await prisma.jobSource.findMany({ where: { AND: [sourceWhere, { jobId: null, isActive: true }] }, select: { id: true, sourceKey: true } });
    const batchId = `quarantine-deactivation:${randomUUID()}`;
    for (const item of detached) stats.sourcesDeactivated += await prisma.$transaction(async tx => {
      await lockSourceWrites(tx, item.sourceKey, true);
      assertSourceRunning();
      const source = await tx.jobSource.findFirst({ where: { AND: [sourceWhere, { id: item.id, jobId: null, isActive: true }] }, omit: { raw: true } });
      if (!source) return 0;
      const before = quarantineSnapshot(source);
      await tx.jobSource.update({ where: { id: source.id }, data: { isActive: false } });
      await tx.dataCorrection.create({ data: { batchId, planHash: evidenceHash({ before, disposition }),
        commitHash: process.env.RAILWAY_GIT_COMMIT_SHA ?? 'LOCAL_WORKTREE', finding: 'QUARANTINE_SOURCE_DEACTIVATION',
        entityType: 'JobSource', entityId: source.id, before, after: { ...before, isActive: false }, evidence: { disposition } } });
      assertSourceRunning();
      return 1;
    }, { maxWait: 10_000, timeout: 30_000 });
  }
  return stats;
}
