import type { Prisma } from '@prisma/client';
import { evidenceHash } from './evidenceHash.js';

/** Send JSON as text: Prisma's JSON input conversion can round finite numbers
 * (48.775130000000004 becomes 48.77513), breaking content-addressed plans. */
type StoredPlanInput = {
  id: string; kind: string; version: number; revision: string; body: unknown;
};
export async function insertMaintenancePlan(db: Prisma.TransactionClient, plan: StoredPlanInput) {
  await db.$executeRaw`INSERT INTO "MaintenancePlan" (id, kind, version, revision, body)
    VALUES (${plan.id}, ${plan.kind}, ${plan.version}, ${plan.revision}, ${JSON.stringify(plan.body)}::jsonb)
    ON CONFLICT (id) DO NOTHING`;
}

export async function storeMaintenancePlan(db: Prisma.TransactionClient, plan: StoredPlanInput) {
  await insertMaintenancePlan(db, plan);
  const saved = await db.maintenancePlan.findUniqueOrThrow({ where: { id: plan.id } });
  if (saved.kind !== plan.kind || saved.version !== plan.version || saved.revision !== plan.revision ||
    evidenceHash(saved.body) !== evidenceHash(plan.body)) throw new Error('Stored maintenance plan differs');
  return saved;
}

/** Preserve JSON number values in the immutable before/after journal. */
export async function recordDataCorrection(db: Prisma.TransactionClient, entry: {
  id: string; batchId: string; planHash: string; commitHash: string; finding: string;
  entityType: string; entityId: string; before: unknown; after: unknown; evidence: unknown;
}) {
  await db.$executeRaw`INSERT INTO "DataCorrection"
    (id, "batchId", "planHash", "commitHash", finding, "entityType", "entityId", "before", "after", evidence)
    VALUES (${entry.id}, ${entry.batchId}, ${entry.planHash}, ${entry.commitHash}, ${entry.finding},
      ${entry.entityType}, ${entry.entityId}, ${JSON.stringify(entry.before)}::jsonb,
      ${JSON.stringify(entry.after)}::jsonb, ${JSON.stringify(entry.evidence)}::jsonb)`;
}
