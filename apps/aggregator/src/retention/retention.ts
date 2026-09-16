import { Prisma, type PrismaClient } from '@prisma/client';
import { evidenceHash } from '../lib/evidenceHash.js';
import { archiveAdapterObservation } from '../capture/observations.js';
import { archiveRawBlob } from '../capture/store.js';
import type { ObjectStore } from './objectStore.js';

export const HOT_RETENTION_DAYS = 14;
// Archive retention is a minimum. Referenced proof is never automatically erased.
export const ARCHIVE_MINIMUM_MONTHS = 12;
type RetentionBody = { version: 1; keys: string[]; cutoff: string;
  observations: { id: string; sourceKey: string; contentHash: string }[]; blobs: string[] };
export type RetentionPlan = RetentionBody & { planHash: string };

/** Bounded, reviewed pages. Historical inputs remain explicitly without native captures. */
export async function planRetention(db: PrismaClient, keys: string[], now = new Date(), limit = 250): Promise<RetentionPlan> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Retention page size must be 1–1000');
  const allowed = [...new Set(keys)].sort();
  const cutoff = new Date(now.getTime() - HOT_RETENTION_DAYS * 86_400_000);
  const observations = await db.sourceObservation.findMany({ where: { sourceKey: { in: allowed }, observedAt: { lt: cutoff },
    raw: { not: Prisma.DbNull } }, select: { id: true, sourceKey: true, contentHash: true }, orderBy: { id: 'asc' }, take: limit });
  const blobs = await db.rawBlob.findMany({ where: { body: { isNot: null },
    captures: { none: { capturedAt: { gte: cutoff } } }, observations: { none: { observedAt: { gte: cutoff } } },
    extractions: { none: { capturedAt: { gte: cutoff } } }, manifests: { none: { completedAt: { gte: cutoff } } },
    OR: [{ captures: { some: { batch: { sourceKey: { in: allowed } } } } }, { observations: { some: { sourceKey: { in: allowed } } } }, { extractions: { some: { batch: { sourceKey: { in: allowed } } } } }, { manifests: { some: { batch: { sourceKey: { in: allowed } } } } }],
  }, select: { hash: true }, orderBy: { hash: 'asc' }, take: limit });
  const body: RetentionBody = { version: 1, keys: allowed, cutoff: cutoff.toISOString(), observations, blobs: blobs.map(blob => blob.hash) };
  return { ...body, planHash: evidenceHash(body) };
}

export async function applyRetention(db: PrismaClient, plan: RetentionPlan, expectedHash: string, store: ObjectStore) {
  const { planHash, ...body } = plan;
  const cutoff = new Date(plan.cutoff);
  if (plan.version !== 1 || planHash !== expectedHash || evidenceHash(body) !== planHash || !Number.isFinite(cutoff.getTime()) ||
    cutoff.getTime() > Date.now() - HOT_RETENTION_DAYS * 86_400_000 || plan.observations.length > 1000 || plan.blobs.length > 1000 ||
    new Set(plan.observations.map(row => row.id)).size !== plan.observations.length || new Set(plan.blobs).size !== plan.blobs.length ||
    plan.observations.some(row => !plan.keys.includes(row.sourceKey)) || plan.blobs.some(hash => !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error('Invalid retention plan');
  }
  const current = await db.sourceObservation.findMany({ where: { id: { in: plan.observations.map(row => row.id) } },
    select: { id: true, sourceKey: true, contentHash: true, observedAt: true } });
  const byId = new Map(current.map(row => [row.id, row]));
  for (const expected of plan.observations) {
    const row = byId.get(expected.id);
    if (!row || row.sourceKey !== expected.sourceKey || row.contentHash !== expected.contentHash || row.observedAt >= cutoff) throw new Error('Retention observation changed');
  }
  const scopedBlobs = await db.rawBlob.count({ where: { hash: { in: plan.blobs }, OR: [
    { captures: { some: { batch: { sourceKey: { in: plan.keys } } } } },
    { observations: { some: { sourceKey: { in: plan.keys } } } },
    { extractions: { some: { batch: { sourceKey: { in: plan.keys } } } } },
    { manifests: { some: { batch: { sourceKey: { in: plan.keys } } } } },
  ] } });
  if (scopedBlobs !== plan.blobs.length) throw new Error('Retention blob is missing or outside the source scope');
  let purged = 0;
  for (const row of plan.observations) if ((await archiveAdapterObservation(db, row.id, store, cutoff)).purged) purged++;
  for (const hash of plan.blobs) if ((await archiveRawBlob(db, hash, store, cutoff)).purged) purged++;
  return { observations: plan.observations.length, purged };
}
