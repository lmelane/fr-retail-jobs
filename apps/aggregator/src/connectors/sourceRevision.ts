import type { Prisma } from '@prisma/client';
import type { AtsType } from '@prisma/client';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { effectiveSourceConfig } from './sourceConfig.js';
import { requireSourceAccess } from './sourceAccess.js';
import { SourceAccessGateError } from './accessScope.js';
import { CAPTURE_ADOPTION_POLICY, requireIngestionPublication } from './sourceAdmission.js';

export type SourceBinding = { revisionId: string; requireActive?: boolean };
type RegistryState = { currentRevisionId: string; status: string; kind: string; configText: string };

/** Call inside the batch-creation transaction; configuration updates wait for
 * this shared row lock. No network is performed while holding the lock. */
export async function bindSourceRevision(db: Prisma.TransactionClient, sourceKey: string,
  config: Record<string, unknown>, kind?: AtsType, expected?: SourceBinding): Promise<string | undefined> {
  const [source] = await db.$queryRaw<RegistryState[]>`
    SELECT "currentRevisionId", status, kind, config::text AS "configText"
    FROM "Source" WHERE key=${sourceKey} FOR SHARE`;
  if (!source) {
    if (expected) throw new Error('Capture source is no longer registered');
    return undefined; // An unregistered probe is not a source validation.
  }
  if (source.status === 'RETIRED' || expected?.requireActive && source.status !== 'ACTIVE') throw new Error('Capture source is not available for collection');
  if (expected && source.currentRevisionId !== expected.revisionId) throw new Error('Capture source configuration changed before collection');
  if (!kind || KIND_TO_ATS[source.kind] !== kind) throw new Error('Capture reader differs from the registered source');
  if (evidenceHash(effectiveSourceConfig(JSON.parse(source.configText))) !== evidenceHash(config)) throw new Error('Capture settings differ from the registered source');
  return source.currentRevisionId;
}

/** Recheck at the publication write boundary, after acquiring lifecycle locks.
 * A completed old capture remains historical evidence but cannot publish under
 * a replacement source configuration. Unbound probes remain readable but can never authorize a public write. */
export async function requireCurrentCaptureRevision(db: Prisma.TransactionClient,
  batch: { id: string; sourceKey: string; sourceRevisionId: string | null; accessDecisionId: string | null }) {
  if (!batch.sourceRevisionId) throw new Error('Publication requires a registered native capture');
  const [source] = await db.$queryRaw<{ currentRevisionId: string; status: string }[]>`
    SELECT "currentRevisionId", status FROM "Source" WHERE key=${batch.sourceKey} FOR SHARE`;
  if (!source || source.status !== 'ACTIVE' || source.currentRevisionId !== batch.sourceRevisionId) throw new Error('Captured source revision is no longer current');
  const access = await requireSourceAccess(db, { key: batch.sourceKey, currentRevisionId: source.currentRevisionId });
  const governing = batch.accessDecisionId ?? await adoptedAccessDecision(db, batch.id);
  if (!governing || access.decision.id !== governing) throw new SourceAccessGateError('ACCESS_SUPERSEDED', 'Publication requires the access decision that governed this collection');
  await requireIngestionPublication(db, batch);
}

/**
 * The access decision bound to a qualification capture when the ingestion adopted it (lecture unique): that capture was
 * collected without one, and its adoption records the decision that covers its whole journal. Read only for an
 * adoption admission, so a database without the adoption table keeps every other path unchanged.
 */
async function adoptedAccessDecision(db: Prisma.TransactionClient, batchId: string): Promise<string | null> {
  const admission = await db.sourceIngestionAdmission.findUnique({ where: { batchId }, select: { policyVersion: true } });
  if (admission?.policyVersion !== CAPTURE_ADOPTION_POLICY) return null;
  return (await db.sourceCaptureAdoption.findUnique({ where: { batchId }, select: { accessDecisionId: true } }))?.accessDecisionId ?? null;
}
