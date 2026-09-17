import { deactivateCapturedPublication } from './deactivateSources.js';
import { publicationDisposition } from './publicationDisposition.js';
import type { PrismaClient } from '@prisma/client';
import type { NormalizedJob } from '../types.js';
import { lockSourceWrites } from '../lib/writeLocks.js';
import { assertSourceRunning } from '../lib/sourceBudget.js';
import { requireCurrentCaptureRevision } from '../connectors/sourceRevision.js';
import { archiveAdapterOutput } from '../capture/observations.js';
import { enforcePublicationPolicy } from '../capture/publicationPolicy.js';

/** Preserve held native evidence; any resulting withdrawal rechecks admission
 * in the same transaction that changes the public representation. */
export async function archivePublicationHold(db: PrismaClient, sourceKey: string, job: NormalizedJob): Promise<void> {
  const input = structuredClone({ ...job, sourceKey });
  if (!input.publicationHold || input.raw == null) throw new Error('Publication hold requires reason and source evidence');
  await db.$transaction(async tx => {
    await lockSourceWrites(tx, sourceKey);
    assertSourceRunning();
    const capture = await archiveAdapterOutput(tx, input);
    await requireCurrentCaptureRevision(tx, capture.batch);
    await enforcePublicationPolicy(tx, capture, input, 'HOLD');
    assertSourceRunning();
  });
  if (input.publicationWithdrawnAt && publicationDisposition(input.publicationHold)) {
    await deactivateCapturedPublication(db, input);
  }
}
