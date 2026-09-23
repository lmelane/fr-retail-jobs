import type { Prisma, Source } from '@prisma/client';
import { accessStatus, readLatestSourceAccess } from '../connectors/sourceAccess.js';
import { requireSourceValidation } from '../connectors/sourceCertification.js';
import { readAttestingCapture } from '../pipeline/attestingCapture.js';
import { sourceEligibility } from '../pipeline/refreshPlan.js';

export const OPERATIONAL_MODES = ['FULL_AUTOMATION', 'PUBLISH_NO_CLOSE', 'EVIDENCE_ONLY', 'PAUSED_BLOCKED'] as const;
export type OperationalMode = (typeof OPERATIONAL_MODES)[number];
export type ModeDecision = { mode: OperationalMode; reasons: string[]; nextAction: string };

/** Reporting uses the same current gates as publication and closure. Health
 * history and superseded identity reviews never grant or deny those rights. */
export async function readOperationalMode(db: Prisma.TransactionClient, source: Source, now = new Date()): Promise<ModeDecision> {
  if (source.status !== 'ACTIVE') return { mode: 'PAUSED_BLOCKED', reasons: [`source ${source.status}`],
    nextAction: source.note?.trim() || 'documenter le motif et la condition de reprise' };
  const access = accessStatus(source, (await readLatestSourceAccess(db, [source.key])).get(source.key) ?? null, now);
  if (!access.passed) return { mode: 'PAUSED_BLOCKED', reasons: [access.code ?? 'ACCESS_UNKNOWN'],
    nextAction: ['ACCESS_STALE', 'ACCESS_MISSING'].includes(access.code ?? '') ? 'le prochain run renouvelle automatiquement la qualification d’accès' : 'résoudre le refus d’accès documenté' };
  try { await requireSourceValidation(db, source.currentRevisionId, now); }
  catch (error) { return { mode: 'EVIDENCE_ONLY', reasons: [error instanceof Error ? error.message : 'qualification indisponible'],
    nextAction: 'le prochain run qualifie les RAW avec le lecteur courant avant admission' }; }
  const attestation = await readAttestingCapture(db, source.key, now);
  const closure = attestation.ok ? sourceEligibility(attestation.capture.facts, attestation.capture.evidence) : null;
  if (!attestation.ok || !closure?.eligible) return { mode: 'PUBLISH_NO_CLOSE',
    reasons: attestation.ok ? closure!.reasons : attestation.reasons,
    nextAction: 'attendre une énumération complète, admise, scellée et achevée pour prouver une absence' };
  return { mode: 'FULL_AUTOMATION', reasons: ['qualification et preuve d’énumération courantes'],
    nextAction: 'surveiller le prochain cycle ; le refresh revérifie chaque publication et ses garde-fous' };
}
