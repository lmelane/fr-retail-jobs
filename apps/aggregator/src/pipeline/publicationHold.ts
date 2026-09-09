import { deactivateSources } from './deactivateSources.js';
import { publicationDisposition } from './publicationDisposition.js';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { NormalizedJob } from '../types.js';
import { lockSourceWrites } from '../lib/writeLocks.js';
import { assertSourceRunning } from '../lib/sourceBudget.js';
import { PIPELINE_VERSION } from './version.js';

/** Preserve a defective employer posting without creating a public job or
 * deleting/changing an earlier representation. Unresolved content defects block absence attestation; explicit closed
 * application endpoints remain eligible for the normal delayed closure rules. */
export async function archivePublicationHold(db: PrismaClient, sourceKey: string, job: NormalizedJob): Promise<void> {
  if (!job.publicationHold || job.raw == null) throw new Error('Publication hold requires reason and source evidence');
  const raw = { publicationHold: job.publicationHold, sourcePayload: job.raw };
  const contentHash = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
  await db.$transaction(async tx => {
    await lockSourceWrites(tx, sourceKey);
    assertSourceRunning();
    const source = await tx.source.findUniqueOrThrow({ where: { key: sourceKey }, select: { status: true } });
    if (source.status === 'RETIRED') throw new Error('Cannot archive a retired source');
    await tx.sourceObservation.upsert({
      where: { sourceKey_externalId_contentHash: { sourceKey, externalId: job.externalId, contentHash } },
      create: { sourceKey, externalId: job.externalId, contentHash, raw: raw as Prisma.InputJsonValue, pipelineVersion: PIPELINE_VERSION }, update: {},
    });
    assertSourceRunning();
  });
  const withdrawn = job.publicationWithdrawnAt;
  const disposition = publicationDisposition(job.publicationHold);
  if (withdrawn && disposition) {
    if (!Number.isFinite(withdrawn.getTime()) || withdrawn.getTime() > Date.now()) throw new Error('Invalid withdrawal observation time');
    // Reuse the existing history-preserving lifecycle writer. A newer ingestion
    // wins the race; the observation cannot deactivate a re-attested posting.
    await deactivateSources(db, { sourceKey, externalId: job.externalId, lastSeenAt: { lt: withdrawn } }, disposition);
  }
}
