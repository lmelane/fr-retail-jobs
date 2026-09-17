import type { PrismaClient, Source } from '@prisma/client';
import { vi } from 'vitest';
import { captureIdentityFixture } from './sourceIdentityFixture.js';
import { recordSourceIdentityReview } from '../connectors/sourceIdentity.js';
import { validateCapturedSource } from '../connectors/sourceValidation.js';
import { accessFixture } from './sourceAccessFixture.js';

/** Call with a real collector's synthetic native response already captured.
 * No gate, SQL trigger, parser or replay is stubbed. */
export async function admissionFixture(db: PrismaClient, source: Source, batchId: string) {
  const previous = globalThis.fetch;
  let identity;
  try {
    identity = await recordSourceIdentityReview(db, await captureIdentityFixture(db, source), true);
  } finally { vi.stubGlobal('fetch', previous); }
  const validation = await validateCapturedSource(db, batchId);
  if (validation.verdict !== 'VALIDATED') throw new Error('Admission fixture requires genuinely qualified native bytes');
  const access = await accessFixture(db, source, batchId);
  return { identity, validation, ...access };
}
