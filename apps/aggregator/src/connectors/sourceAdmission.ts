import type { Prisma, CaptureBatch } from '@prisma/client';
import { readIdentitySource } from './sourceRegistryRead.js';
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
  /*
   * L'IDENTITÉ VIENT DU REGISTRE (lot F5, 18/09/2026). Plus de revue par capture : `Source.maison`
   * dit qui recrute, `Source.portalScope` dit si le portail ne sert qu'une Maison. L'admission
   * retient la RÉVISION du registre — qui change dès qu'une de ces colonnes change, donc protège
   * mieux qu'une revue valable 30 jours.
   */
  const validation = await requireSourceValidation(tx, source.currentRevisionId);
  return { validation };
}

/** A fresh result must pass its own offline validation. The admission retains
 * the earlier calibration that justified starting the network collection. */
export async function requireIngestionPublication(tx: Prisma.TransactionClient, batch: Pick<CaptureBatch, 'id' | 'sourceKey' | 'sourceRevisionId'>) {
  const admission = await tx.sourceIngestionAdmission.findUnique({ where: { batchId: batch.id } });
  if (!admission || admission.policyVersion !== SOURCE_ADMISSION_POLICY) throw new SourceAdmissionGateError('ADMISSION_MISSING', 'Publication requires a collection admitted before transport');
  const { validation } = await ingestionQualifications(tx, batch.sourceKey);
  /*
   * Le registre a-t-il changé PENDANT la collecte ? Avant F5 cette question se posait sur
   * l'identifiant de la revue ; elle se pose désormais sur la RÉVISION de la source, que le
   * déclencheur `Source_record_revision` renouvelle dès que maison, config, kind, careersDomain,
   * jobUrlPattern, tier ou tenantKey change. C'est une garde plus stricte, pas plus lâche : une
   * revue restait valable 30 jours après une modification, une révision non.
   */
  const source = await readIdentitySource(tx, batch.sourceKey);
  if (!source || source.currentRevisionId !== batch.sourceRevisionId) {
    throw new SourceAdmissionGateError('IDENTITY_SUPERSEDED', 'Registry revision changed during collection; collect again');
  }
  if (validation.captureBatchId !== batch.id) throw new SourceAdmissionGateError('CAPTURE_NOT_VALIDATED', 'Publication requires the current validation of this exact collection');
}
