import type { Prisma, PrismaClient } from '@prisma/client';
import type { ObjectStore } from '../retention/objectStore.js';
import { readRawBlob, storeRawBlob } from './store.js';
import { captureReaderRevision } from './revision.js';
import { lockSourceWrites } from '../lib/writeLocks.js';
import { MAX_MANIFEST_OUTPUTS } from './manifest.js';

export const SOURCE_COMPLETION_POLICY = 'native-ingestion-completion/1';
const MAX_REASON_LENGTH = 200;

/** A sealed output the ingestion loop did not publish, with its named fate. Published
 * outputs are every other output of the manifest; they are not listed twice. */
export type OutputFate = {
  ordinal: number; externalId: string | null;
  disposition: 'HELD' | 'WRITE_FAILED' | 'SKIPPED_OUT_OF_SECTOR';
  /** A bounded code (hold reason, error class name, filter name), never a message that could carry a URL or a parameter. */
  reason: string;
};
export type CompletionReport = { version: 1; policy: typeof SOURCE_COMPLETION_POLICY; batchId: string; outputs: number; fates: OutputFate[] };
export type CompletionCounts = { published: number; held: number; writeFailed: number; skipped: number };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const DISPOSITIONS = new Set<OutputFate['disposition']>(['HELD', 'WRITE_FAILED', 'SKIPPED_OUT_OF_SECTOR']);

function validFate(value: unknown): value is OutputFate {
  return object(value) && Number.isSafeInteger(value.ordinal) && (value.ordinal as number) >= 0 &&
    (value.externalId === null || (typeof value.externalId === 'string' && value.externalId.length > 0)) &&
    DISPOSITIONS.has(value.disposition as OutputFate['disposition']) &&
    typeof value.reason === 'string' && value.reason.length > 0 && value.reason.length <= MAX_REASON_LENGTH && !/[\r\n]/.test(value.reason);
}

/** Counts are derived from the fates; a row whose columns disagree with its report is refused on read. */
export function completionCounts(outputs: number, fates: readonly OutputFate[]): CompletionCounts {
  const held = fates.filter(fate => fate.disposition === 'HELD').length;
  const writeFailed = fates.filter(fate => fate.disposition === 'WRITE_FAILED').length;
  const skipped = fates.filter(fate => fate.disposition === 'SKIPPED_OUT_OF_SECTOR').length;
  return { published: outputs - fates.length, held, writeFailed, skipped };
}

function checkFates(fates: readonly OutputFate[], outputs: { ordinal: number; externalId: string | null }[]) {
  const byOrdinal = new Map(outputs.map(output => [output.ordinal, output]));
  const seen = new Set<number>();
  for (const fate of fates) {
    if (!validFate(fate)) throw new Error('Invalid output fate');
    const output = byOrdinal.get(fate.ordinal);
    if (!output || seen.has(fate.ordinal) || output.externalId !== fate.externalId) throw new Error('Output fate does not match the sealed extraction outputs');
    seen.add(fate.ordinal);
  }
}

/** Record, once, what became of every output of an admitted collection. Called after
 * the last per-output writer, under the source lifecycle lock; SQL refuses probes,
 * failed captures and counts that leave an output unaccounted for. */
export async function recordIngestionCompletion(db: PrismaClient, batchId: string, fates: readonly OutputFate[]) {
  const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: batchId }, include: { outcome: true, ingestionAdmission: true } });
  if (batch.purpose !== 'JOBS' || batch.outcome?.status !== 'EXTRACTED' || !batch.ingestionAdmission) throw new Error('Ingestion completion requires an admitted, sealed job extraction');
  const outputs = await db.sourceExtraction.findMany({ where: { batchId }, select: { ordinal: true, externalId: true }, orderBy: { ordinal: 'asc' }, take: MAX_MANIFEST_OUTPUTS + 1 });
  if (outputs.length !== batch.outcome.extractedCount || outputs.length > MAX_MANIFEST_OUTPUTS) throw new Error('Ingestion completion outputs differ from the sealed extraction');
  checkFates(fates, outputs);
  const report: CompletionReport = { version: 1, policy: SOURCE_COMPLETION_POLICY, batchId, outputs: outputs.length,
    fates: [...fates].sort((a, b) => a.ordinal - b.ordinal) };
  const counts = completionCounts(outputs.length, report.fates);
  const reportHash = await storeRawBlob(db, Buffer.from(JSON.stringify(report)));
  const readerRevision = captureReaderRevision();
  return db.$transaction(async tx => {
    await lockSourceWrites(tx, batch.sourceKey);
    const existing = await tx.sourceIngestionCompletion.findUnique({ where: { batchId } });
    if (existing) {
      if (existing.reportHash !== reportHash) throw new Error('Ingestion completion already recorded with a different report');
      return existing;
    }
    return tx.sourceIngestionCompletion.create({ data: { batchId, reportHash, ...counts, readerRevision, policyVersion: SOURCE_COMPLETION_POLICY } });
  }, { maxWait: 10_000, timeout: 30_000 });
}

/** Read and verify the immutable completion of a batch: the report bytes must match the
 * stored hash, and the stored counts must be exactly those derived from the report. */
export async function readIngestionCompletion(db: Pick<Prisma.TransactionClient, 'sourceIngestionCompletion' | 'rawBlob'>, batchId: string, store?: ObjectStore) {
  const row = await db.sourceIngestionCompletion.findUnique({ where: { batchId } });
  if (!row) return null;
  const value: unknown = JSON.parse((await readRawBlob(db, row.reportHash, store)).toString('utf8'));
  if (!object(value) || value.version !== 1 || value.policy !== SOURCE_COMPLETION_POLICY || value.batchId !== batchId ||
    !Number.isSafeInteger(value.outputs) || (value.outputs as number) < 0 || !Array.isArray(value.fates) || !value.fates.every(validFate) ||
    row.policyVersion !== SOURCE_COMPLETION_POLICY) throw new Error('Invalid ingestion completion report');
  const report = value as CompletionReport;
  const ordinals = new Set(report.fates.map(fate => fate.ordinal));
  if (ordinals.size !== report.fates.length || report.fates.some(fate => fate.ordinal >= report.outputs)) throw new Error('Invalid ingestion completion report');
  const counts = completionCounts(report.outputs, report.fates);
  if (counts.published !== row.published || counts.held !== row.held || counts.writeFailed !== row.writeFailed || counts.skipped !== row.skipped) {
    throw new Error('Ingestion completion row differs from its immutable report');
  }
  return { row, report };
}
