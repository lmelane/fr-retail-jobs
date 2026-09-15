/** Inspect original bytes, derived observations, or replay an extraction offline. */
import { PrismaClient, AtsType } from '@prisma/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { readRawBlob } from '../../src/capture/store.js';
import { readAdapterObservation } from '../../src/capture/observations.js';
import { replayExtraction } from '../../src/capture/batch.js';
import { fetchAtsJobs } from '../../src/ats/index.js';
import { evidenceHash } from '../../src/lib/evidenceHash.js';
import { objectStoreConfigured, objectStoreFromEnv } from '../../src/retention/objectStore.js';

const arg = (key: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const db = new PrismaClient();
try {
  const store = objectStoreConfigured() ? objectStoreFromEnv() : undefined;
  const selected = ['capture', 'observation', 'output', 'replay'].filter(key => arg(key));
  if (selected.length !== 1) throw new Error('Choose exactly one capture, observation, output or replay');
  if (arg('capture') || arg('observation') || arg('output')) {
    if (!arg('out')) throw new Error('Reading native or derived content requires a private --out=<file>');
    if (arg('capture')) {
      const capture = await db.rawCapture.findUniqueOrThrow({ where: { id: arg('capture')! } });
      if (!capture.blobHash) throw new Error('This request has no captured response body');
      writeFileSync(arg('out')!, await readRawBlob(db, capture.blobHash, store), { mode: 0o600 });
      console.log(JSON.stringify({ format: capture.format, complete: capture.complete, hash: capture.blobHash }));
    } else if (arg('output')) {
      const output = await db.sourceExtraction.findUniqueOrThrow({ where: { id: arg('output')! } });
      writeFileSync(arg('out')!, await readRawBlob(db, output.outputHash, store), { mode: 0o600 });
      console.log(JSON.stringify({ kind: 'EXTRACTION_OUTPUT', batchId: output.batchId, ordinal: output.ordinal, hash: output.outputHash }));
    } else {
      const row = await readAdapterObservation(db, arg('observation')!, store);
      writeFileSync(arg('out')!, JSON.stringify(row.raw, null, 2) + '\n', { mode: 0o600 });
      console.log(JSON.stringify({ kind: 'ADAPTER_OUTPUT', nativeCapture: row.captureBatchId ?? 'HISTORICAL_INPUT_NOT_CAPTURED' }));
    }
  } else if (arg('replay')) {
    if (!arg('config') || !arg('out')) throw new Error('Replay requires the original private --config=<file> and --out=<file>');
    const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: arg('replay')! }, include: { outcome: true } });
    const config = JSON.parse(readFileSync(arg('config')!, 'utf8')) as Record<string, unknown>;
    if (batch.formatVersion !== 1 || evidenceHash(config) !== batch.configHash || !Object.values(AtsType).includes(batch.sourceKind as AtsType)) {
      throw new Error('Replay requires a supported capture format, its original configuration and recorded source kind');
    }
    const result = await replayExtraction(db, batch.id, () => fetchAtsJobs(batch.sourceKind as AtsType, config), store);
    writeFileSync(arg('out')!, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    const matches = batch.outcome?.outputHash === evidenceHash(result.jobs);
    console.log(JSON.stringify({ batchId: batch.id, jobs: result.jobs.length, matchesRecordedOutput: matches, originalReader: batch.readerRevision }));
    if (!matches) process.exitCode = 1;
  } else throw new Error('Use --capture=<id>, --observation=<id>, --output=<id>, or --replay=<batch id>');
} finally { await db.$disconnect(); }
