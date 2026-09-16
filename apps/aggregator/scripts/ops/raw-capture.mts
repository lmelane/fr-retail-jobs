/** Inspect original bytes or replay an extraction offline. */
import { PrismaClient, AtsType } from '@prisma/client';
import { readInputJson, writePrivateFile } from '../../src/lib/privateFile.js';
import { readRawBlob } from '../../src/capture/store.js';
import { readAdapterObservation } from '../../src/capture/observations.js';
import { compareExtractionResult } from '../../src/capture/manifest.js';
import { replayExtraction } from '../../src/capture/batch.js';
import { fetchAtsJobs } from '../../src/ats/index.js';
import { evidenceHash } from '../../src/lib/evidenceHash.js';
import { objectStoreConfigured, objectStoreFromEnv } from '../../src/retention/objectStore.js';
import { parseCaptureArguments } from '../../src/capture/cliArguments.js';
import { closeBrowser } from '../../src/lib/browser.js';

const options = parseCaptureArguments(process.argv.slice(2));
const arg = (key: string) => options[key];
const db = new PrismaClient();
try {
  const store = objectStoreConfigured() ? objectStoreFromEnv() : undefined;
  if (arg('capture') || arg('observation') || arg('output')) {
    if (arg('capture')) {
      const capture = await db.rawCapture.findUniqueOrThrow({ where: { id: arg('capture')! } });
      if (!capture.blobHash) throw new Error('This request has no captured response body');
      writePrivateFile(arg('out')!, await readRawBlob(db, capture.blobHash, store));
      console.log(JSON.stringify({ format: capture.format, complete: capture.complete, hash: capture.blobHash }));
    } else if (arg('output')) {
      const output = await db.sourceExtraction.findUniqueOrThrow({ where: { id: arg('output')! } });
      writePrivateFile(arg('out')!, await readRawBlob(db, output.outputHash, store));
      console.log(JSON.stringify({ kind: 'EXTRACTION_OUTPUT', batchId: output.batchId, ordinal: output.ordinal, hash: output.outputHash }));
    } else {
      const row = await readAdapterObservation(db, arg('observation')!, store);
      writePrivateFile(arg('out')!, JSON.stringify(row.raw, null, 2) + '\n');
      console.log(JSON.stringify({ kind: 'ADAPTER_OUTPUT', nativeCapture: row.captureBatchId ?? 'HISTORICAL_INPUT_NOT_CAPTURED' }));
    }
  } else if (arg('replay')) {
    if (!arg('config') || !arg('out')) throw new Error('Replay requires the original private --config=<file> and --out=<file>');
    const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: arg('replay')! } });
    const config = readInputJson(arg('config')!, 2 * 1024 * 1024) as Record<string, unknown>;
    if (![1, 2].includes(batch.formatVersion) || evidenceHash(config) !== batch.configHash || !Object.values(AtsType).includes(batch.sourceKind as AtsType)) {
      throw new Error('Replay requires a supported capture format, its original configuration and recorded source kind');
    }
    const result = await replayExtraction(db, batch.id, () => fetchAtsJobs(batch.sourceKind as AtsType, config), store);
    writePrivateFile(arg('out')!, JSON.stringify(result, null, 2) + '\n');
    const comparison = await compareExtractionResult(db, batch.id, result, store);
    console.log(JSON.stringify({ batchId: batch.id, jobs: result.jobs.length, ...comparison,
      originalReader: batch.readerRevision, executionBudget: batch.executionBudget }));
    if (!comparison.exact) process.exitCode = 1;
  } else throw new Error('Use --capture=<id>, --observation=<id>, --output=<id>, or --replay=<batch id>');
} finally { await closeBrowser().catch(() => undefined); await db.$disconnect(); }
