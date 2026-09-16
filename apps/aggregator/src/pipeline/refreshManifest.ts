import { PRESENTATION_FIELDS } from '@catwalks/db/publication-presentation';
import { evidenceHash } from '../lib/evidenceHash.js';
import type { PrismaClient, JobSource } from '@prisma/client';
import { insertMaintenancePlan } from '../lib/maintenancePlan.js';

export const REFRESH_LIMITS = { staleHours: 48, maxCloseRatio: 0.05, minCloseForGuard: 50 } as const;
/** Version 4: an absence proof names its admitted capture, never a run correlation. */
export const REFRESH_MANIFEST_VERSION = 4;
export type RefreshLimits = { staleHours: number; maxCloseRatio: number; minCloseForGuard: number };
export type ManifestEntry = {
  jobSourceId: string; sourceKey: string; externalId: string; jobId: string | null;
  observedAt: string; beforeHash: string;
  state: 'ABSENT_FROM_PROVEN_ENUMERATION' | 'DECLARED_DEADLINE_ELAPSED';
  proof: { kind: 'ENUMERATION'; captureBatchId: string; hash: string } | { kind: 'DEADLINE'; expiresAt: string; hash: string };
  consequence: 'JOB_KEPT_BY_ANOTHER_SOURCE' | 'JOB_CANDIDATE_FOR_CLOSURE' | 'JOB_ALREADY_INACTIVE' | 'QUARANTINED_PUBLICATION';
};
export type RefreshManifest = {
  version: typeof REFRESH_MANIFEST_VERSION; mode: 'DEACTIVATE_REPRESENTATIONS'; allowedSourceKeys: string[];
  entries: ManifestEntry[]; limits: RefreshLimits; planHash: string; createdAt: string;
};

/** A held publication has its own lifecycle, without a fabricated parent Job. */
export function quarantineSnapshot(source: Omit<JobSource, 'raw'>) {
  return JSON.parse(JSON.stringify({ id: source.id, jobId: source.jobId,
    sourceKey: source.sourceKey, externalId: source.externalId, url: source.url,
    isActive: source.isActive, lastSeenAt: source.lastSeenAt, expiresAt: source.expiresAt,
    expiryEvidence: source.expiryEvidence, quarantinedAt: source.quarantinedAt, quarantineReason: source.quarantineReason,
    captureBatchId: source.captureBatchId, captureOutputId: source.captureOutputId }));
}

/** Only state used or changed by refresh; descriptions and raw bodies stay in their own archives. */
export function refreshSnapshot(job: { id: string; companyId: string; isActive: boolean; mergedIntoId: string | null;
  closedAt: Date | null; withdrawnAt: Date | null; withdrawalReason: string | null; reopenedCount: number;
  canonicalSourceKey: string | null; canonicalExternalId: string | null; canonicalTier: string | null; url: string;
  sources: { id: string; jobId: string | null; sourceKey: string; externalId: string; sourceTier: string; isActive: boolean; lastSeenAt: Date; expiresAt: Date | null; expiryEvidence: unknown; url: string; captureBatchId?: string | null; captureOutputId?: string | null; presentation?: unknown }[] }) {
  return JSON.parse(JSON.stringify({ id: job.id, companyId: job.companyId, isActive: job.isActive, mergedIntoId: job.mergedIntoId,
    closedAt: job.closedAt, withdrawnAt: job.withdrawnAt, withdrawalReason: job.withdrawalReason, reopenedCount: job.reopenedCount,
    contentHash: evidenceHash(Object.fromEntries(PRESENTATION_FIELDS.map(key => [key, (job as unknown as Record<string, unknown>)[key] ?? null]))),
    canonicalSourceKey: job.canonicalSourceKey, canonicalExternalId: job.canonicalExternalId, canonicalTier: job.canonicalTier, url: job.url,
    sources: job.sources.map(source => ({ id: source.id, jobId: source.jobId, sourceKey: source.sourceKey, externalId: source.externalId,
      sourceTier: source.sourceTier, isActive: source.isActive, lastSeenAt: source.lastSeenAt, expiresAt: source.expiresAt,
      expiryEvidence: source.expiryEvidence, presentationHash: evidenceHash(source.presentation ?? null), captureBatchId: source.captureBatchId ?? null, captureOutputId: source.captureOutputId ?? null, url: source.url })).sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

export function manifestHash(keys: readonly string[], entries: readonly ManifestEntry[], limits: RefreshLimits = REFRESH_LIMITS): string {
  return evidenceHash({ version: REFRESH_MANIFEST_VERSION, mode: 'DEACTIVATE_REPRESENTATIONS', allowedSourceKeys: [...keys].sort(),
    entries: [...entries].sort((a, b) => a.jobSourceId.localeCompare(b.jobSourceId)), limits });
}
export function freezeManifest(keys: readonly string[], entries: readonly ManifestEntry[], limits: RefreshLimits = REFRESH_LIMITS): RefreshManifest {
  return { version: REFRESH_MANIFEST_VERSION, mode: 'DEACTIVATE_REPRESENTATIONS', allowedSourceKeys: [...keys].sort(),
    entries: [...entries].sort((a, b) => a.jobSourceId.localeCompare(b.jobSourceId)), limits,
    planHash: manifestHash(keys, entries, limits), createdAt: new Date().toISOString() };
}
export function verifyManifest(manifest: RefreshManifest): { valid: boolean; problems: string[] } {
  const problems: string[] = [];
  if (manifest.version !== REFRESH_MANIFEST_VERSION || manifest.mode !== 'DEACTIVATE_REPRESENTATIONS' || !Array.isArray(manifest.allowedSourceKeys) ||
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
    if (!entry.jobSourceId || (entry.jobId !== null && (typeof entry.jobId !== 'string' || !entry.jobId)) || !entry.externalId || !Number.isFinite(Date.parse(entry.observedAt)) ||
      !/^[a-f0-9]{64}$/.test(entry.beforeHash) || !entry.proof || !/^[a-f0-9]{64}$/.test(entry.proof.hash)) problems.push('invalid entry evidence');
    if (entry.state === 'ABSENT_FROM_PROVEN_ENUMERATION' ? entry.proof?.kind !== 'ENUMERATION' || typeof entry.proof.captureBatchId !== 'string' || !entry.proof.captureBatchId
      : entry.state === 'DECLARED_DEADLINE_ELAPSED' ? entry.proof?.kind !== 'DEADLINE' || !Number.isFinite(Date.parse(entry.proof.expiresAt)) : true) problems.push('invalid deactivation proof');
    if (!['JOB_KEPT_BY_ANOTHER_SOURCE', 'JOB_CANDIDATE_FOR_CLOSURE', 'JOB_ALREADY_INACTIVE', 'QUARANTINED_PUBLICATION'].includes(entry.consequence)) problems.push('invalid job consequence');
    if ((entry.jobId === null) !== (entry.consequence === 'QUARANTINED_PUBLICATION')) problems.push('invalid quarantine consequence');
    if (entry.jobId === null) continue;
    const previous = parents.get(entry.jobId);
    if (previous && previous !== entry.beforeHash) problems.push(`inconsistent job snapshot: ${entry.jobId}`);
    parents.set(entry.jobId, entry.beforeHash);
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
  await insertMaintenancePlan(db, { id: manifest.planHash, kind: 'REFRESH_DEACTIVATION', version: REFRESH_MANIFEST_VERSION, revision, body: manifest });
  await loadRefreshManifest(db, manifest.planHash);
  return { planHash: manifest.planHash, entries: manifest.entries.length };
}

/** Earlier stored plans (version 3, run-correlated proofs) remain readable history but can no longer be applied. */
export async function loadRefreshManifest(db: PrismaClient, planHash: string): Promise<RefreshManifest> {
  if (!/^[a-f0-9]{64}$/.test(planHash)) throw new Error('Invalid maintenance plan hash');
  const row = await db.maintenancePlan.findUniqueOrThrow({ where: { id: planHash } });
  if (row.kind !== 'REFRESH_DEACTIVATION' || row.version !== REFRESH_MANIFEST_VERSION) throw new Error('Unsupported maintenance plan');
  const manifest = row.body as unknown as RefreshManifest;
  const check = verifyManifest(manifest);
  if (!check.valid || manifest.planHash !== planHash) throw new Error(`Stored maintenance plan hash mismatch: ${planHash}`);
  return manifest;
}
