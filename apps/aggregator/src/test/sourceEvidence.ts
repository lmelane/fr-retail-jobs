import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

export async function archiveSourceEnumeration(db: Prisma.TransactionClient, sourceKey: string, ids: string[], at = new Date()) {
  const runId = randomUUID();
  await db.pipelineRun.create({ data: { id: runId, command: 'lifecycle-test', status: 'COMPLETED', startedAt: at, finishedAt: at } });
  await db.pipelineEvent.create({ data: { id: randomUUID(), runId, at, sourceKey,
    event: 'source.enumeration_observed', level: 'info', fingerprint: runId,
    payload: { enumeration: { termination: 'FULL_RESPONSE', pageEvidence: [{ canonicalIds: ids }], issues: [] } },
  } });
  return runId;
}

/** Persist a complete source cycle, including a genuinely empty listing. */
export async function recordSourceEvidence(db: Prisma.TransactionClient, sourceKey: string, options: {
  status?: string; observedIds?: string[]; canAttestAbsence?: boolean; at?: Date;
} = {}) {
  const ids = options.observedIds ?? [], at = options.at ?? new Date();
  const runId = await archiveSourceEnumeration(db, sourceKey, ids, at);
  const status = options.status ?? 'OK';
  await db.sourceRun.create({ data: { runId, sourceKey, status, jobs: ids.length, fetched: ids.length,
    declaredTotal: ids.length, errors: 0, truncated: false, complete: true,
    canAttestAbsence: options.canAttestAbsence ?? status === 'OK', ranAt: at } });
  return runId;
}

export async function clearSourceEvidence(db: Prisma.TransactionClient) {
  const runs = await db.pipelineRun.findMany({ where: { command: 'lifecycle-test' }, select: { id: true } });
  const runIds = runs.map(run => run.id);
  await db.pipelineEvent.deleteMany({ where: { runId: { in: runIds } } });
  await db.pipelineRun.deleteMany({ where: { id: { in: runIds } } });
}
