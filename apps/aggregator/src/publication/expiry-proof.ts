import type { Prisma } from '@prisma/client';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { readCapturedPublication } from '../capture/publication.js';
import { readRawBlob } from '../capture/store.js';
import type { ObjectStore } from '../retention/objectStore.js';
import { retainedPublicationIdentity } from './recovery.js';

export type ExpiryPublicationProof =
  | { origin: 'RETAINED_RAW'; rawHash: string }
  | { origin: 'NATIVE_CAPTURE'; batchId: string; outputId: string; outputHash: string };
export class ExpiryPublicationReview extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
export type ExpiryReadBudget = { used: number; limit: number };
export type ExpiryPublicationInput = {
  sourceKey: string;
  externalId: string;
  url: string;
  raw: unknown;
  observedAt: Date;
  captureBatchId: string | null;
  captureOutputId: string | null;
};

/** Bind the date-bearing RAW to its own native publication. A capture reference
 * can never fall back to a historical reader when its provenance is invalid. */
export async function readExpiryPublicationProof(
  db: Prisma.TransactionClient,
  source: { kind: string; config: Prisma.JsonValue },
  input: ExpiryPublicationInput,
  context: { bodies: Map<string, Buffer>; budget: ExpiryReadBudget; store?: ObjectStore; allowFetch: boolean },
): Promise<ExpiryPublicationProof> {
  // An immutable extraction is still a reader's output. Check the current
  // native identity rules even when that older output has valid provenance.
  const identity = retainedPublicationIdentity(source.kind, input.raw, {
    externalId: input.externalId,
    url: input.url,
    observedAt: input.observedAt,
    config: source.config as Record<string, unknown>,
  });
  if (identity.status !== 'VERIFIED') throw new ExpiryPublicationReview(`EXPIRY_PUBLICATION_${identity.reason}`);
  if (!input.captureBatchId && !input.captureOutputId) {
    return { origin: 'RETAINED_RAW', rawHash: identity.rawHash };
  }
  if (!input.captureBatchId || !input.captureOutputId)
    throw new ExpiryPublicationReview('EXPIRY_CAPTURE_PROVENANCE_INCOMPLETE');
  const output = await db.sourceExtraction.findUnique({
    where: { id: input.captureOutputId },
    select: { outputHash: true, output: { select: { byteLength: true } } },
  });
  if (!output) throw new ExpiryPublicationReview('EXPIRY_CAPTURE_OUTPUT_MISSING');
  if (!context.bodies.has(output.outputHash)) {
    if (!context.allowFetch) throw new Error('Expiry capture was not prefetched before write locks');
    context.budget.used += output.output.byteLength;
    if (context.budget.used > context.budget.limit) throw new Error('Expiry capture exceeds the bounded page size');
    try {
      context.bodies.set(output.outputHash, await readRawBlob(db, output.outputHash, context.store));
    } catch {
      throw new ExpiryPublicationReview('EXPIRY_CAPTURE_ARCHIVE_UNAVAILABLE');
    }
  }
  try {
    const result = await readCapturedPublication(db, input, undefined, context.bodies);
    if (result.batch.sourceKind !== KIND_TO_ATS[source.kind]) throw new Error('Captured adapter differs');
    if (result.captured.publicationHold || result.captured.publicationWithdrawnAt)
      throw new Error('Captured publication is held');
    return {
      origin: 'NATIVE_CAPTURE',
      batchId: input.captureBatchId,
      outputId: input.captureOutputId,
      outputHash: result.outputHash,
    };
  } catch {
    throw new ExpiryPublicationReview('EXPIRY_CAPTURE_PUBLICATION_MISMATCH');
  }
}
