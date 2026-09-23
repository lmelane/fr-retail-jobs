/** Railway and local processes use the same entry point; never applies migrations. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pingHeartbeat } from './pipeline/heartbeat.js';
import { log } from './observability/logger.js';
import { exitIfPipelinePaused } from './lib/pipelinePause.js';
import { attestRuntime } from '@catwalks/runtime';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const attestation = attestRuntime('worker', process.argv.slice(2));
if (!['0', '1'].includes(process.env.PIPELINE_PAUSED ?? '')) throw new Error('PIPELINE_PAUSED must be 0 or 1 (explicit worker setting required)');
const [command = 'paused', ...args] = process.argv.slice(2);
exitIfPipelinePaused(command);
if (!['ingest-all', 'ingest', 'refresh', 'health-report', 'direct-sync', 'source-add'].includes(command)) throw new Error('Unsupported worker command');
console.log(JSON.stringify({ event: 'worker.started', state: 'RUNNING', command, pid: process.pid, at: new Date().toISOString() }));
async function child(argv: string[]): Promise<number> {
  if (attestation?.deadline && Date.now() >= attestation.deadline) throw new Error('Worker run window expired');
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, argv, { cwd: root, env: process.env, stdio: 'inherit' });
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
  process.exitCode = await child(command === 'source-add'
    ? ['--import', 'tsx', 'apps/aggregator/scripts/ops/source-add.mts', ...args]
    : ['--import', 'tsx', 'apps/aggregator/src/cli.ts', command, ...args]);
  // Also covers a child that exits before its DB observability could start.
  if (process.exitCode) await pingHeartbeat(false);
} catch (error) {
  process.exitCode = 1;
  await log.error('worker.failed', { command, error });
  await pingHeartbeat(false);
}
console.log(JSON.stringify({ event: 'worker.finished', command, state: process.exitCode ? 'FAILED' : 'COMPLETED', exitCode: process.exitCode, at: new Date().toISOString() }));
