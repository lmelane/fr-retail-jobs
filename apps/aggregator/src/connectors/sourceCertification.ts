import type { Prisma } from '@prisma/client';
import { captureReaderRevision } from '../capture/revision.js';

export const SOURCE_VALIDATION_POLICY = 'source-validation-20260916-v1';
export const SOURCE_VALIDATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type GateCode = 'VALIDATION_MISSING' | 'READER_STALE' | 'CAPTURE_STALE' | 'ATTEMPT_ORDER_UNKNOWN' | 'CAPTURE_SUPERSEDED';
export class SourceValidationGateError extends Error {
  constructor(readonly code: GateCode, message: string) {
    super(message); this.name = 'SourceValidationGateError';
  }
}

/** Called after locking the current registry row, together with identity and
 * access checks. A newer rejection supersedes an earlier successful validation. */
export async function requireSourceValidation(db: Prisma.TransactionClient, revisionId: string, now = new Date()) {
  const validation = await db.sourceValidation.findFirst({ where: { sourceRevisionId: revisionId },
    orderBy: { sequence: 'desc' }, include: { captureBatch: true } });
  if (!validation || validation.verdict !== 'VALIDATED' || validation.captureBatch.purpose !== 'JOBS') throw new SourceValidationGateError('VALIDATION_MISSING', 'no current validated native offer capture or proven empty feed');
  if (validation.policyVersion !== SOURCE_VALIDATION_POLICY || validation.readerRevision !== captureReaderRevision()) throw new SourceValidationGateError('READER_STALE', 'native validation must be repeated with the current reader');
  const age = now.getTime() - validation.captureBatch.startedAt.getTime();
  if (!Number.isFinite(age) || age < -300_000 || age > SOURCE_VALIDATION_MAX_AGE_MS) throw new SourceValidationGateError('CAPTURE_STALE', 'native capture must have been observed within 24 hours');
  // A failed or still-running attempt has no successful manifest to validate.
  // It must not leave an earlier success eligible for a new activation or ingestion. Database
  // allocation order is independent of clock corrections and timestamp ties.
  // Promotion and ingestion hold the registry row lock used by new captures.
  if (validation.captureBatch.attemptOrdinal === null) throw new SourceValidationGateError('ATTEMPT_ORDER_UNKNOWN', 'capture predates ordered source attempts; collect again');
  const competing = await db.captureBatch.findFirst({ where: { sourceRevisionId: revisionId, purpose: 'JOBS',
    attemptOrdinal: { gt: validation.captureBatch.attemptOrdinal } }, select: { id: true } });
  if (competing) throw new SourceValidationGateError('CAPTURE_SUPERSEDED', 'a newer capture attempt requires a new native validation');
  return validation;
}
