/** One new source, through the same qualified campaign as the Golden Path. */
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { exitIfPipelinePaused } from '../../src/lib/pipelinePause.js';
import { sourceLaunchArguments } from '../../src/onboarding/launch.js';
import { writePrivateFile } from '../../src/lib/privateFile.js';

exitIfPipelinePaused('source-add');
const input = sourceLaunchArguments(process.argv.slice(2));
const out = input.outDir ? resolve(input.outDir) : mkdtempSync(join(tmpdir(), 'catwalks-source-'));
if (input.outDir) {
  if (existsSync(out)) throw new Error('Source report directory must be new');
  mkdirSync(out, { recursive: true, mode: 0o700 });
}
const file = join(out, 'candidate.json');
writePrivateFile(file, JSON.stringify([input.candidate]) + '\n');
const child = spawn(process.execPath, ['--import', 'tsx', 'apps/aggregator/scripts/ops/source-campaign.mts',
  `--candidates=${file}`, `--out-dir=${out}/campaign`, `--keys=${input.candidate.key}`, '--limit=1',
  `--reviewer=${input.reviewer}`, '--ingest'], {
  cwd: fileURLToPath(new URL('../../../../', import.meta.url)), env: process.env, stdio: 'inherit',
});
const stop = (signal: NodeJS.Signals) => { child.kill(signal); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
child.once('error', () => { console.error(JSON.stringify({ event: 'source.add.failed', error: 'child_start_failed' })); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  process.off('SIGTERM', stop); process.off('SIGINT', stop);
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143);
  console.log(JSON.stringify({ event: 'source.add.finished', sourceKey: input.candidate.key,
    state: process.exitCode ? 'FAILED' : 'COMPLETED', exitCode: process.exitCode, reports: out }));
});
