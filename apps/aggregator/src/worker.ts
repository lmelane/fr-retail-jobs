/** Railway and local processes use the same entry point; never applies migrations. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pingHeartbeat } from './pipeline/heartbeat.js';
import { log } from './observability/logger.js';
import { exitIfPipelinePaused } from './lib/pipelinePause.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const [command = process.env.PIPELINE_CMD ?? 'ingest-all', ...args] = process.argv.slice(2);
exitIfPipelinePaused(command);
if (!['ingest-all', 'ingest', 'refresh', 'health-report', 'direct-sync', 'source-add'].includes(command)) throw new Error('Unsupported worker command');
console.log(JSON.stringify({ event: 'worker.started', state: 'RUNNING', command, pid: process.pid, at: new Date().toISOString() }));
async function child(argv: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, argv, { cwd: root, env: process.env, stdio: 'inherit' });
    const stop = (signal: NodeJS.Signals) => { processChild.kill(signal); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    const detach = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); };
    processChild.once('error', error => { detach(); reject(error); });
    processChild.once('exit', (code, signal) => { detach(); resolve(code ?? (signal === 'SIGINT' ? 130 : 143)); });
  });
}
try {
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
