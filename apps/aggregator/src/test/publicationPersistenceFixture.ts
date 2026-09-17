import './setup-integration.js';
import { vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { evidenceHash } from '../lib/evidenceHash.js';
import { persistExtractionManifest } from '../capture/manifest.js';
import { persistExtractionOutputs } from '../capture/store.js';
import { upsertDeduplicated as write } from '../dedup/upsert.js';
import { archivePublicationHold as hold } from '../pipeline/publicationHold.js';
import { SCOPE_HOLD } from '../pipeline/scopeDecisions.js';
import type { NormalizedJob } from '../types.js';

// Persistence-only tests isolate admission. Synthetic immutable outputs exercise
// the real RAW binding and all persistence/identity/lifecycle code. They are NOT
// native qualifications. publicationBoundary/sourceAdmission/capture/repair tests
// use the real gate and never import this module. No production bypass exists.
vi.mock('../connectors/sourceRevision.js', async importOriginal => ({
  ...await importOriginal<typeof import('../connectors/sourceRevision.js')>(),
  requireCurrentCaptureRevision: vi.fn(async () => undefined),
}));

async function captured<T extends NormalizedJob>(db: PrismaClient, sourceKey: string, input: T): Promise<T> {
  const job = structuredClone(input);
  const native = { ...job };
  // Scope decisions are internal policy, always downstream of native capture.
  if (native.publicationHold === SCOPE_HOLD) { delete native.publicationHold; delete native.publicationWithdrawnAt; }
  const batch = await db.captureBatch.create({ data: { sourceKey, configHash: evidenceHash({}), sourceKind: 'atsType' in input ? String(input.atsType) : undefined, readerRevision: 'synthetic-persistence-fixture' } });
  const [outputId] = await persistExtractionOutputs(db, batch.id, [native]);
  const manifestHash = await persistExtractionManifest(db, batch.id, { jobs: [native] });
  await db.captureOutcome.create({ data: { batchId: batch.id, status: 'EXTRACTED', extractedCount: 1, manifestHash, outputHash: evidenceHash([native]) } });
  return { ...job, captureBatchId: batch.id, captureOutputId: outputId };
}

export async function upsertDeduplicated(...[db, candidate, taxonomy]: Parameters<typeof write>) {
  return write(db, await captured(db, candidate.sourceKey, candidate), taxonomy);
}
export async function archivePublicationHold(db: PrismaClient, sourceKey: string, job: NormalizedJob) {
  return hold(db, sourceKey, await captured(db, sourceKey, job));
}
