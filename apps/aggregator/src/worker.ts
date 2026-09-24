/** Railway and local processes use the same entry point; never applies migrations. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pingHeartbeat } from './pipeline/heartbeat.js';
import { log } from './observability/logger.js';
import { exitIfPipelinePaused } from './lib/pipelinePause.js';
import { attestRuntime, workerArguments, scheduledRunDue } from '@catwalks/runtime';
import { sourceLaunchArguments } from './onboarding/launch.js';
import { isRunCompletion, workerOutcome, type RunCompletion, type CompletionStatus } from './lib/runCompletion.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
if (process.argv[2] === 'source-add') sourceLaunchArguments(process.argv.slice(3));
const attestation = attestRuntime('worker', process.argv.slice(2));
if (!['0', '1'].includes(process.env.PIPELINE_PAUSED ?? '')) throw new Error('PIPELINE_PAUSED must be 0 or 1 (explicit worker setting required)');
exitIfPipelinePaused(process.argv[2] ?? 'ingest-all');
const argv = process.argv.slice(2);
if (argv[0] === 'scheduled' && !scheduledRunDue()) {
  console.log(JSON.stringify({ event: 'worker.schedule_skipped', timeZone: 'Europe/Paris', requiredHour: 18 }));
  process.exit(0);
}
// Preserve the existing local maintenance CLI; deployed ingestion stays normal or source-scoped.
const [command, ...args] = !attestation && argv.length && argv[0] !== 'scheduled' && !argv[0].startsWith('--source=') ? argv : workerArguments(argv);
if (!['ingest-all', 'ingest', 'refresh', 'health-report', 'direct-sync', 'source-add'].includes(command)) throw new Error('Unsupported worker command');
console.log(JSON.stringify({ event: 'worker.started', state: 'RUNNING', command, pid: process.pid, at: new Date().toISOString() }));
let terminal: RunCompletion | undefined;
let state: CompletionStatus = 'FAILED';
async function child(argv: string[], observe = false): Promise<number> {
  if (attestation?.deadline && Date.now() >= attestation.deadline) throw new Error('Worker run window expired');
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, argv, { cwd: root, env: process.env, stdio: observe ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit' });
    if (observe) processChild.on('message', message => {
      if (isRunCompletion(message, command, process.env.CATWALKS_RUN_ID)) terminal = message;
    });
    let forcedExit = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (signal: NodeJS.Signals) => {
      forcedExit = true; processChild.kill(signal);
      killTimer ??= setTimeout(() => processChild.kill('SIGKILL'), 10_000);
      killTimer.unref();
    };
    const deadlineTimer = attestation?.deadline ? setTimeout(() => stop('SIGTERM'), Math.max(1, attestation.deadline - Date.now())) : undefined;
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    const detach = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); clearTimeout(deadlineTimer); clearTimeout(killTimer); };
    processChild.once('error', error => { detach(); reject(error); });
    processChild.once('exit', (code, signal) => { detach(); resolve(forcedExit ? 143 : code ?? (signal === 'SIGINT' ? 130 : 143)); });
  });
}
try {
  if (attestation && await pingHeartbeat('start') !== 'pinged') throw new Error('Worker start heartbeat not acknowledged');
  const schema = await child(['node_modules/prisma/build/index.js', 'migrate', 'status', '--schema', 'packages/db/prisma/schema.prisma']);
  if (schema) throw new Error('Worker schema readiness failed');
  const code = await child(command === 'source-add'
    ? ['--import', 'tsx', 'apps/aggregator/scripts/ops/source-add.mts', ...args]
    : ['--import', 'tsx', 'apps/aggregator/src/cli.ts', command, ...args], command !== 'source-add');
  const outcome = workerOutcome(code, terminal, command !== 'source-add');
  process.exitCode = outcome.exitCode;
  state = outcome.state;
  // Also covers a child that exits before its DB observability could start.
  if (process.exitCode) await pingHeartbeat(false);
} catch (error) {
  state = 'FAILED';
  process.exitCode = 1;
  await log.error('worker.failed', { command, error });
  await pingHeartbeat(false);
}
console.log(JSON.stringify({ event: 'worker.finished', command, state, exitCode: process.exitCode, at: new Date().toISOString() }));
