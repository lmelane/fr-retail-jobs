import { createHash } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';

export const REFRESH_LIMITS = { staleHours: 48, maxCloseRatio: 0.05, minCloseForGuard: 50 } as const;
export type RefreshLimits = { staleHours: number; maxCloseRatio: number; minCloseForGuard: number };
export type ManifestEntry = {
  jobSourceId: string; sourceKey: string; externalId: string; jobId: string;
  observedAt: string; jobBeforeHash: string;
  state: 'ABSENT_FROM_PROVEN_ENUMERATION' | 'DECLARED_DEADLINE_ELAPSED';
  proof: { kind: 'ENUMERATION'; runId: string; hash: string } | { kind: 'DEADLINE'; expiresAt: string; hash: string };
  consequence: 'JOB_KEPT_BY_ANOTHER_SOURCE' | 'JOB_CANDIDATE_FOR_CLOSURE' | 'JOB_ALREADY_INACTIVE';
};
export type RefreshManifest = {
  version: 2; mode: 'DEACTIVATE_REPRESENTATIONS'; allowedSourceKeys: string[];
  entries: ManifestEntry[]; limits: RefreshLimits; planHash: string; createdAt: string;
};

export function evidenceHash(value: unknown): string {
  const stable = (v: unknown): unknown => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(stable)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

/** Only state used or changed by refresh; descriptions and raw bodies stay in their own archives. */
export function refreshSnapshot(job: { id: string; companyId: string; isActive: boolean; mergedIntoId: string | null;
  closedAt: Date | null; withdrawnAt: Date | null; withdrawalReason: string | null; reopenedCount: number;
  canonicalSourceKey: string | null; canonicalExternalId: string | null; canonicalTier: string | null; url: string;
  sources: { id: string; jobId: string; sourceKey: string; externalId: string; sourceTier: string; isActive: boolean; lastSeenAt: Date; expiresAt: Date | null; expiryEvidence: unknown; url: string }[] }) {
  return JSON.parse(JSON.stringify({ id: job.id, companyId: job.companyId, isActive: job.isActive, mergedIntoId: job.mergedIntoId,
    closedAt: job.closedAt, withdrawnAt: job.withdrawnAt, withdrawalReason: job.withdrawalReason, reopenedCount: job.reopenedCount,
    canonicalSourceKey: job.canonicalSourceKey, canonicalExternalId: job.canonicalExternalId, canonicalTier: job.canonicalTier, url: job.url,
    sources: job.sources.map(source => ({ id: source.id, jobId: source.jobId, sourceKey: source.sourceKey, externalId: source.externalId,
      sourceTier: source.sourceTier, isActive: source.isActive, lastSeenAt: source.lastSeenAt, expiresAt: source.expiresAt,
      expiryEvidence: source.expiryEvidence, url: source.url })).sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

export function manifestHash(keys: readonly string[], entries: readonly ManifestEntry[], limits: RefreshLimits = REFRESH_LIMITS): string {
  return evidenceHash({ version: 2, mode: 'DEACTIVATE_REPRESENTATIONS', allowedSourceKeys: [...keys].sort(),
    entries: [...entries].sort((a, b) => a.jobSourceId.localeCompare(b.jobSourceId)), limits });
}
export function freezeManifest(keys: readonly string[], entries: readonly ManifestEntry[], limits: RefreshLimits = REFRESH_LIMITS): RefreshManifest {
  return { version: 2, mode: 'DEACTIVATE_REPRESENTATIONS', allowedSourceKeys: [...keys].sort(),
    entries: [...entries].sort((a, b) => a.jobSourceId.localeCompare(b.jobSourceId)), limits,
    planHash: manifestHash(keys, entries, limits), createdAt: new Date().toISOString() };
}
export function verifyManifest(manifest: RefreshManifest): { valid: boolean; problems: string[] } {
  const problems: string[] = [];
  if (manifest.version !== 2 || manifest.mode !== 'DEACTIVATE_REPRESENTATIONS' || !Array.isArray(manifest.allowedSourceKeys) ||
    !Array.isArray(manifest.entries) || !manifest.limits) return { valid: false, problems: ['unsupported refresh manifest'] };
  const { staleHours, maxCloseRatio, minCloseForGuard } = manifest.limits;
  if (!Number.isFinite(staleHours) || staleHours <= 0 || !Number.isFinite(maxCloseRatio) || maxCloseRatio < 0 || maxCloseRatio > 1 ||
    !Number.isInteger(minCloseForGuard) || minCloseForGuard < 1) problems.push('invalid refresh limits');
  if (manifestHash(manifest.allowedSourceKeys, manifest.entries, manifest.limits) !== manifest.planHash) problems.push('invalid plan hash');
  const allowed = new Set(manifest.allowedSourceKeys), ids = new Set<string>(), parents = new Map<string, string>();
  for (const entry of manifest.entries) {
    if (!allowed.has(entry.sourceKey)) problems.push(`outside source scope: ${entry.sourceKey}`);
    if (ids.has(entry.jobSourceId)) problems.push(`duplicate representation: ${entry.jobSourceId}`);
    ids.add(entry.jobSourceId);
    if (!entry.jobSourceId || !entry.jobId || !entry.externalId || !Number.isFinite(Date.parse(entry.observedAt)) ||
      !/^[a-f0-9]{64}$/.test(entry.jobBeforeHash) || !entry.proof || !/^[a-f0-9]{64}$/.test(entry.proof.hash)) problems.push('invalid entry evidence');
    if (entry.state === 'ABSENT_FROM_PROVEN_ENUMERATION' ? entry.proof?.kind !== 'ENUMERATION' || !entry.proof.runId
      : entry.state === 'DECLARED_DEADLINE_ELAPSED' ? entry.proof?.kind !== 'DEADLINE' || !Number.isFinite(Date.parse(entry.proof.expiresAt)) : true) problems.push('invalid deactivation proof');
    if (!['JOB_KEPT_BY_ANOTHER_SOURCE', 'JOB_CANDIDATE_FOR_CLOSURE', 'JOB_ALREADY_INACTIVE'].includes(entry.consequence)) problems.push('invalid job consequence');
    const previous = parents.get(entry.jobId);
    if (previous && previous !== entry.jobBeforeHash) problems.push(`inconsistent job snapshot: ${entry.jobId}`);
    parents.set(entry.jobId, entry.jobBeforeHash);
  }
  return { valid: problems.length === 0, problems };
}

export function compareTouched(manifest: RefreshManifest, touched: readonly string[]) {
  const expected = new Set(manifest.entries.map(entry => entry.jobSourceId)), actual = new Set(touched);
  const missing = [...expected].filter(id => !actual.has(id)), unexpected = [...actual].filter(id => !expected.has(id));
  return { equal: missing.length === 0 && unexpected.length === 0, missing, unexpected };
}

export async function storeRefreshManifest(db: PrismaClient, manifest: RefreshManifest, revision: string) {
  const check = verifyManifest(manifest);
  if (!check.valid || !/^[a-f0-9]{40}$/.test(revision)) throw new Error(`Invalid maintenance plan: ${check.problems.join('; ')}`);
  await db.maintenancePlan.createMany({ data: [{ id: manifest.planHash, kind: 'REFRESH_DEACTIVATION', version: 2,
    revision, body: manifest as unknown as Prisma.InputJsonValue }], skipDuplicates: true });
  await loadRefreshManifest(db, manifest.planHash);
  return { planHash: manifest.planHash, entries: manifest.entries.length };
}

export async function loadRefreshManifest(db: PrismaClient, planHash: string): Promise<RefreshManifest> {
  if (!/^[a-f0-9]{64}$/.test(planHash)) throw new Error('Invalid maintenance plan hash');
  const row = await db.maintenancePlan.findUniqueOrThrow({ where: { id: planHash } });
  if (row.kind !== 'REFRESH_DEACTIVATION' || row.version !== 2) throw new Error('Unsupported maintenance plan');
  const manifest = row.body as unknown as RefreshManifest;
  const check = verifyManifest(manifest);
  if (!check.valid || manifest.planHash !== planHash) throw new Error(`Stored maintenance plan hash mismatch: ${planHash}`);
  return manifest;
}
