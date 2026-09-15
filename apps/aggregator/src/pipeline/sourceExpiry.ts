import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { declaredExpiry, EXPIRY_READER_VERSION, type ExpiryEvidence } from '../normalize/expiry.js';
import { lockCompanyRows, lockSourceWrites } from '../lib/writeLocks.js';
import { PIPELINE_VERSION } from './version.js';

function digest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
const rawHash = (raw: unknown) => createHash('sha256').update(JSON.stringify(raw)).digest('hex');
type Entry = {
  id: string; jobId: string; companyId: string; sourceKey: string; externalId: string; kind: string;
  lastSeenAt: string; rawHash: string; before: { expiresAt: string | null; expiryEvidence: Prisma.JsonValue };
  expiresAt: string | null; evidence: ExpiryEvidence;
};
export type ExpiryBackfillPlan = { version: 1; allowedKeys: string[]; entries: Entry[]; planHash: string };
const hashPlan = (plan: Omit<ExpiryBackfillPlan, 'planHash'>) => digest(plan);

/** Cursor pages keep RAW reads bounded. Empty scope is always a no-op. */
export async function planSourceExpiries(db: PrismaClient, keys: string[], afterId?: string, limit = 250) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Expiry page size must be 1–1000');
  const allowedKeys = [...new Set(keys)].sort();
  const catalogue = await db.source.findMany({ where: { key: { in: allowedKeys } }, select: { key: true, kind: true } });
  const kinds = new Map(catalogue.map(source => [source.key, source.kind]));
  for (const key of allowedKeys) if (!kinds.has(key)) throw new Error(`Unknown source: ${key}`);
  const rows = await db.jobSource.findMany({ where: { sourceKey: { in: allowedKeys }, ...(afterId ? { id: { gt: afterId } } : {}) },
    orderBy: { id: 'asc' }, take: limit, include: { job: { select: { companyId: true } } } });
  const entries: Entry[] = [];
  for (const row of rows) {
    const expiry = declaredExpiry(kinds.get(row.sourceKey)!, row.raw);
    if (!expiry || ((row.expiresAt?.getTime() ?? null) === (expiry.expiresAt?.getTime() ?? null) && digest(row.expiryEvidence) === digest(expiry.evidence))) continue;
    entries.push({ id: row.id, jobId: row.jobId, companyId: row.job.companyId, sourceKey: row.sourceKey,
      externalId: row.externalId, kind: kinds.get(row.sourceKey)!, lastSeenAt: row.lastSeenAt.toISOString(), rawHash: rawHash(row.raw),
      before: { expiresAt: row.expiresAt?.toISOString() ?? null, expiryEvidence: row.expiryEvidence },
      expiresAt: expiry.expiresAt?.toISOString() ?? null, evidence: expiry.evidence });
  }
  const body = { version: 1 as const, allowedKeys, entries };
  return { plan: { ...body, planHash: hashPlan(body) }, scanned: rows.length, nextCursor: rows.at(-1)?.id };
}

/** An immutable batch records exact before/after values; retries never repeat writes. */
export async function applySourceExpiries(db: PrismaClient, plan: ExpiryBackfillPlan, expectedHash: string, commitHash: string) {
  const { planHash, ...body } = plan;
  if (plan.version !== 1 || planHash !== expectedHash || hashPlan(body) !== planHash || !/^[a-f0-9]{40}$/.test(commitHash)) {
    throw new Error('Invalid expiry plan, hash or revision');
  }
  if (plan.entries.length > 1000 || new Set(plan.entries.map(entry => entry.id)).size !== plan.entries.length ||
    plan.entries.some(entry => !plan.allowedKeys.includes(entry.sourceKey) || entry.evidence.readerVersion !== EXPIRY_READER_VERSION)) {
    throw new Error('Invalid expiry plan scope');
  }
  if (!plan.entries.length) return { written: 0, alreadyApplied: false };
  const batchId = `source-expiry:${planHash}`;
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${batchId}, 0))`;
    for (const key of [...new Set(plan.entries.map(entry => entry.sourceKey))].sort()) await lockSourceWrites(tx, key, true);
    await lockCompanyRows(tx, plan.entries.map(entry => entry.companyId));
    const applied = await tx.dataCorrection.findMany({ where: { batchId }, select: { entityId: true, planHash: true } });
    if (applied.length) {
      const ids = new Set(applied.map(row => row.entityId));
      if (ids.size !== plan.entries.length || plan.entries.some(entry => !ids.has(entry.id)) || applied.some(row => row.planHash !== planHash)) {
        throw new Error('Expiry audit mismatch');
      }
      return { written: 0, alreadyApplied: true };
    }
    const catalogue = await tx.source.findMany({ where: { key: { in: plan.allowedKeys } }, select: { key: true, kind: true } });
    const kinds = new Map(catalogue.map(source => [source.key, source.kind]));
    const rows = await tx.jobSource.findMany({ where: { id: { in: plan.entries.map(entry => entry.id) } }, include: { job: { select: { companyId: true } } } });
    const current = new Map(rows.map(row => [row.id, row]));
    // Validate every entry before writing any entry in the batch.
    for (const entry of plan.entries) {
      const row = current.get(entry.id);
      const derived = row ? declaredExpiry(entry.kind, row.raw) : undefined;
      if (!row || row.jobId !== entry.jobId || row.job.companyId !== entry.companyId || row.sourceKey !== entry.sourceKey ||
        row.externalId !== entry.externalId || kinds.get(entry.sourceKey) !== entry.kind ||
        row.lastSeenAt.toISOString() !== entry.lastSeenAt || rawHash(row.raw) !== entry.rawHash ||
        digest({ expiresAt: row.expiresAt?.toISOString() ?? null, expiryEvidence: row.expiryEvidence }) !== digest(entry.before) ||
        !derived || (derived.expiresAt?.toISOString() ?? null) !== entry.expiresAt || digest(derived.evidence) !== digest(entry.evidence)) {
        throw new Error(`Stale or unsupported expiry evidence: ${entry.id}`);
      }
    }
    for (const entry of plan.entries) {
      // The deadline remains replayable after JobSource.raw changes. Existing
      // JSONB payloads may have a different key order from their first capture.
      const row = current.get(entry.id)!;
      await tx.sourceObservation.upsert({
        where: { sourceKey_externalId_contentHash: { sourceKey: entry.sourceKey, externalId: entry.externalId, contentHash: entry.rawHash } },
        create: { sourceKey: entry.sourceKey, externalId: entry.externalId, contentHash: entry.rawHash,
          raw: row.raw as Prisma.InputJsonValue, pipelineVersion: PIPELINE_VERSION, observedAt: row.lastSeenAt }, update: {},
      });
      await tx.jobSource.update({ where: { id: entry.id }, data: { expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null, expiryEvidence: entry.evidence } });
    }
    await tx.dataCorrection.createMany({ data: plan.entries.map(entry => ({ batchId, planHash, commitHash,
      finding: 'SOURCE_DECLARED_EXPIRY', entityType: 'JobSource', entityId: entry.id,
      before: entry.before, after: { expiresAt: entry.expiresAt, expiryEvidence: entry.evidence },
      evidence: { ...entry.evidence, jobId: entry.jobId, sourceKey: entry.sourceKey, externalId: entry.externalId, lastSeenAt: entry.lastSeenAt },
    })) });
    return { written: plan.entries.length, alreadyApplied: false };
  }, { maxWait: 15_000, timeout: 60_000 });
}
