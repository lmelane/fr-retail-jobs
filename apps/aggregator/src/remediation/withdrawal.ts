import type { PrismaClient } from '@prisma/client';
import { json, type RepairPlan, type Row } from './plan.js';

/** Repair only administrative closures demonstrated by an immutable correction
 * receipt. Never infer this from a missing CLOSED event alone. */
export async function planAdministrativeWithdrawals(prisma: PrismaClient,
  spec: { batchId: string; originalFinding: string; reason: string }): Promise<RepairPlan> {
  if (!spec.batchId || !spec.originalFinding || !['OUT_OF_SCOPE', 'IDENTITY_CONTRADICTED'].includes(spec.reason)) throw new Error('Reviewed withdrawal specification required');
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const receipts = await tx.dataCorrection.findMany({ where: { finding: spec.originalFinding, entityType: 'Job' }, orderBy: { id: 'asc' } });
    const operations: RepairPlan['operations'] = [];
    const companyIds = new Set<string>(), sourceKeys = new Set<string>();
    const seen = new Set<string>();
    for (const receipt of receipts) {
      const before = receipt.before as Row, after = receipt.after as Row;
      if (!before || !after || before.isActive !== true || before.closedAt !== null || after.isActive !== false || typeof after.closedAt !== 'string') continue;
      if (seen.has(receipt.entityId)) throw new Error(`Multiple administrative transitions require review: ${receipt.entityId}`);
      seen.add(receipt.entityId);
      const job = await tx.job.findUniqueOrThrow({ where: { id: receipt.entityId }, include: { sources: true }, omit: { searchText: true } });
      if (job.withdrawnAt && job.withdrawalReason === spec.reason && !job.isActive && job.closedAt === null) continue;
      if (job.isActive || job.mergedIntoId || job.closedAt?.toISOString() !== after.closedAt || job.withdrawnAt || !job.sources.length || job.sources.some(s => s.isActive)) throw new Error(`Administrative evidence no longer matches: ${job.id}`);
      const closed = await tx.jobEvent.findFirst({ where: { jobId: job.id, type: 'CLOSED', at: { gte: new Date(after.closedAt) } } });
      if (closed) throw new Error(`Later employer closure must be reviewed: ${job.id}/${closed.id}`);
      const keys = [...new Set(job.sources.map(s => s.sourceKey))];
      const sources = await tx.source.findMany({ where: { key: { in: keys } }, select: { key: true, status: true } });
      if (sources.length !== keys.length || sources.some(s => s.status !== 'RETIRED')) throw new Error(`Source withdrawal not established: ${job.id}`);
      for (const key of keys) sourceKeys.add(key);
      companyIds.add(job.companyId);
      const { sources: _sources, ...row } = job;
      operations.push({ entity: 'Job', id: job.id, before: json(row),
        patch: { closedAt: null, withdrawnAt: after.closedAt, withdrawalReason: spec.reason },
        reason: `Administrative removal recorded by immutable correction ${receipt.id}; no employer closure asserted`,
        evidence: { originalCorrection: { id: receipt.id, batchId: receipt.batchId, planHash: receipt.planHash } } });
    }
    return { version: 1, batchId: spec.batchId, finding: 'ADMINISTRATIVE_WITHDRAWAL_LIFECYCLE', createdAt: new Date().toISOString(),
      sourceKeys: [...sourceKeys].sort(), companyIds: [...companyIds].sort(), operations,
      evidence: { originalFinding: spec.originalFinding,
        preserve: 'Job IDs, RAW, original correction receipts, original events, visibility, first/last seen and true closures remain intact' },
      invariants: ['lifecycle', 'excluded-identities'], excludedSourceKeys: [...sourceKeys].sort() };
  }, { timeout: 180_000 });
}
