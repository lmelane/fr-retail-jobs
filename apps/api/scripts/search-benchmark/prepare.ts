import { createReadStream, createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { readNdjson } from './ndjson';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { join } from 'node:path';
import { SEARCH_VOCABULARY_VERSION } from '../../lib/search-vocabulary';
import { snapshotModel, type SnapshotMetadata } from './model';

async function main() {
  const [snapshot, output] = process.argv.slice(2);
  if (!snapshot || !output) throw new Error('Usage: prepare.ts snapshot_directory output_ndjson');
  const expected = JSON.parse(readFileSync(join(snapshot, 'manifest.json'), 'utf8'));
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(snapshot, 'catalogue.ndjson'))) hash.update(chunk);
  if (hash.digest('hex') !== expected.sha256) throw new Error('Snapshot hash mismatch');
  const out = createWriteStream(output, { flags: 'wx', mode: 0o600 });
  const finished = once(out, 'finish');
  let model: ReturnType<typeof snapshotModel> | undefined, metadata: SnapshotMetadata | undefined, count = 0;
  for await (const record of readNdjson(join(snapshot, 'catalogue.ndjson'))) {
    const r = record as { type: string; job: Parameters<ReturnType<typeof snapshotModel>['document']>[0] } & SnapshotMetadata;
    if (r.type === 'metadata') { metadata = r; model = snapshotModel(r); }
    if (r.type === 'job' || r.type === 'direct') {
      if (!model) throw new Error('Missing metadata');
      if (!out.write(JSON.stringify(model.document(r.job, r.type === 'direct')) + '\n')) await once(out, 'drain');
      count++;
    }
  }
  out.end(); await finished;
  if (count !== expected.counts.aggregate + expected.counts.direct) throw new Error('Projection count mismatch');
  const projectionHash = createHash('sha256');
  for await (const chunk of createReadStream(output)) projectionHash.update(chunk);
  writeFileSync(output + '.metadata.json', JSON.stringify({ ...metadata, searchVocabularyVersion: SEARCH_VOCABULARY_VERSION, snapshotSha256: expected.sha256,
    projectionSha256: projectionHash.digest('hex') }), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ prepared: count, snapshot: expected.sha256, projection: output }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
