import type { PrismaClient, SourceValidation } from '@prisma/client';
import { SourceIdentityGateError, identityReviewOrder, requireSourceIdentity, sourceIdentityHash, sourceSubjectKey } from '../connectors/sourceIdentity.js';
import { readIdentitySource } from '../connectors/sourceRegistryRead.js';
import { SourceValidationGateError, requireSourceValidation } from '../connectors/sourceCertification.js';
import { accessStatus } from '../connectors/sourceAccess.js';

export const validationReport = (validation: SourceValidation) => ({
  id: validation.id, sequence: validation.sequence.toString(), sourceRevisionId: validation.sourceRevisionId,
  captureBatchId: validation.captureBatchId, readerRevision: validation.readerRevision, policyVersion: validation.policyVersion,
  verdict: validation.verdict, validatedAt: validation.validatedAt, report: validation.report,
});

/** A profile identifies exactly what a reviewer is examining, without exporting private configuration. */
export async function sourceIdentityProfile(db: PrismaClient, key: string) {
  const source = await readIdentitySource(db, key);
  if (!source) throw new Error('Source does not exist');
  return { sourceKey: source.key, sourceRevisionId: source.currentRevisionId, tenantKey: source.tenantKey,
    subjectKey: sourceSubjectKey(source), sourceHash: sourceIdentityHash(source) };
}

/** Current gates, read on one snapshot. This is not a new review or technical decision. */
export async function sourceStatus(db: PrismaClient, key: string) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const source = await readIdentitySource(tx, key);
    if (!source) throw new Error('Source does not exist');
    const gate = async (fn: () => Promise<unknown>) => {
      try { await fn(); return { passed: true, code: null as string | null }; }
      catch (error) {
        if (!(error instanceof SourceIdentityGateError) && !(error instanceof SourceValidationGateError)) throw error;
        return { passed: false, code: error.code };
      }
    };
    const identity = await gate(() => requireSourceIdentity(tx, source));
    const native = await gate(() => requireSourceValidation(tx, source.currentRevisionId));
    const review = await tx.sourceIdentityReview.findFirst({ where: { sourceKey: key }, orderBy: identityReviewOrder,
      select: { id: true, sourceRevisionId: true, sequence: true, verdict: true, checkedAt: true } });
    const validation = await tx.sourceValidation.findFirst({ where: { sourceRevisionId: source.currentRevisionId }, orderBy: { sequence: 'desc' } });
    const attempt = await tx.captureBatch.findFirst({ where: { sourceRevisionId: source.currentRevisionId, purpose: 'JOBS' },
      orderBy: [{ attemptOrdinal: { sort: 'desc', nulls: 'last' } }, { startedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, attemptOrdinal: true, startedAt: true, formatVersion: true,
        outcome: { select: { status: true, completedAt: true, extractedCount: true } } } });
    const accessDecision = await tx.sourceAccessDecision.findFirst({ where: { sourceKey: key }, orderBy: { sequence: 'desc' } });
    const access = accessStatus(source, accessDecision);
    const importedAccessObservation = await tx.sourceAccessArchive.findUnique({ where: { sourceKey: key } });
    // Observed dates are for inspection, never a source-qualification decision
    // order. Evidence captures have no job-attempt ordinal.
    const evidenceCaptures = await tx.captureBatch.findMany({ where: { sourceRevisionId: source.currentRevisionId,
      purpose: { in: ['SOURCE_IDENTITY', 'SOURCE_ACCESS'] } }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: 10,
      select: { id: true, purpose: true, startedAt: true, outcome: { select: { status: true, completedAt: true } },
        captures: { orderBy: { sequence: 'desc' }, take: 1, select: { id: true, status: true, complete: true } } } });
    return { importedAccessObservation: importedAccessObservation ? { sourceKey: key, sourceId: importedAccessObservation.sourceId, archivedAt: importedAccessObservation.archivedAt, authoritative: false } : null,
      key, status: source.status, sourceRevisionId: source.currentRevisionId, identity, native, access,
      latestIdentityReview: review ? { ...review, sequence: review.sequence?.toString() ?? null } : null,
      latestCaptureAttempt: attempt ? { ...attempt, attemptOrdinal: attempt.attemptOrdinal?.toString() ?? null } : null,
      evidenceCaptures,
      latestTechnicalValidation: validation ? validationReport(validation) : null,
      promotionGatesPass: !['ACTIVE', 'RETIRED'].includes(source.status) && !!source.config && Object.keys(source.config).length > 0 && identity.passed && native.passed && access.passed };
  }, { isolationLevel: 'RepeatableRead' });
}
