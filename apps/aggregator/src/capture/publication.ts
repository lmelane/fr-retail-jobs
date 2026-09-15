import type { Prisma } from '@prisma/client';
import type { ObjectStore } from '../retention/objectStore.js';
import { readRawBlob } from './store.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import type { NormalizedJob } from '../types.js';
import { digestBytes } from './context.js';

type ArchivedJob = Omit<NormalizedJob, 'postedAt' | 'validThrough' | 'publicationWithdrawnAt'> & {
  postedAt?: string; validThrough?: string; publicationWithdrawnAt?: string;
};

type Input = { sourceKey: string; externalId: string; url?: string; raw?: unknown;
  captureBatchId?: string | null; captureOutputId?: string | null };

/** Bind one publication to its immutable output. Repair prefetches cold bodies
 * before acquiring write locks and passes the verified bodies to this reader. */
export async function readCapturedPublication(db: Prisma.TransactionClient, input: Input,
  store?: ObjectStore, bodies?: ReadonlyMap<string, Buffer>) {
  if (!input.captureBatchId || !input.captureOutputId) throw new Error('Publication requires a new native capture');
  const batch = await db.captureBatch.findUnique({ where: { id: input.captureBatchId }, include: { outcome: true } });
  if (!batch || batch.sourceKey !== input.sourceKey || batch.outcome?.status !== 'EXTRACTED') throw new Error('Adapter output refers to an invalid capture batch');
  const output = await db.sourceExtraction.findUnique({ where: { id: input.captureOutputId } });
  if (!output || output.batchId !== batch.id || output.externalId !== input.externalId) throw new Error('Adapter output refers to another captured job');
  const bytes = bodies ? bodies.get(output.outputHash) : await readRawBlob(db, output.outputHash, store);
  if (!bytes) throw new Error('Captured body was not prefetched');
  if (digestBytes(bytes) !== output.outputHash) throw new Error('Captured body hash differs');
  const captured = JSON.parse(bytes.toString('utf8')) as ArchivedJob;
  if (captured.externalId !== input.externalId || evidenceHash(captured.raw ?? null) !== evidenceHash(input.raw ?? null) ||
    input.url !== undefined && input.url !== captured.url) throw new Error('Adapter RAW or application URL differs from the captured output');
  return { captured, batch, outputHash: output.outputHash };
}
