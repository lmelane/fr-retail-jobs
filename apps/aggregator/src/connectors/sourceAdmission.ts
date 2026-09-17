import type { Prisma, CaptureBatch } from '@prisma/client';
import { readIdentitySource } from './sourceRegistryRead.js';
import { requireSourceIdentity } from './sourceIdentity.js';
import { requireSourceValidation } from './sourceCertification.js';

export const SOURCE_ADMISSION_POLICY = 'native-ingestion-admission/1';
export class SourceAdmissionGateError extends Error {
  constructor(readonly code: 'ADMISSION_MISSING' | 'IDENTITY_SUPERSEDED' | 'CAPTURE_NOT_VALIDATED', message: string) {
    super(message); this.name = 'SourceAdmissionGateError';
  }
}

/** Called inside batch allocation, after locking and checking the registry.
 * Return the exact decisions, not a boolean inferred from operational status. */
export async function ingestionQualifications(tx: Prisma.TransactionClient, sourceKey: string) {
  const source = await readIdentitySource(tx, sourceKey);
  if (!source || source.status !== 'ACTIVE') throw new SourceAdmissionGateError('ADMISSION_MISSING', 'Active registered source required for ingestion');
  const identity = await requireSourceIdentity(tx, source);
  const validation = await requireSourceValidation(tx, source.currentRevisionId);
  return { identity, validation };
}

/** A fresh result must pass its own offline validation. The admission retains
 * the earlier calibration that justified starting the network collection. */
export async function requireIngestionPublication(tx: Prisma.TransactionClient, batch: Pick<CaptureBatch, 'id' | 'sourceKey' | 'sourceRevisionId'>) {
  const admission = await tx.sourceIngestionAdmission.findUnique({ where: { batchId: batch.id } });
  if (!admission || admission.policyVersion !== SOURCE_ADMISSION_POLICY) throw new SourceAdmissionGateError('ADMISSION_MISSING', 'Publication requires a collection admitted before transport');
  const { identity, validation } = await ingestionQualifications(tx, batch.sourceKey);
  if (identity.id !== admission.identityReviewId) throw new SourceAdmissionGateError('IDENTITY_SUPERSEDED', 'Identity decision changed during collection; collect again');
  if (validation.captureBatchId !== batch.id) throw new SourceAdmissionGateError('CAPTURE_NOT_VALIDATED', 'Publication requires the current validation of this exact collection');
}
