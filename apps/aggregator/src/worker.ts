/** Railway and local processes use the same entry point; never applies migrations. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pingHeartbeat } from './pipeline/heartbeat.js';
import { log } from './observability/logger.js';
import { exitIfPipelinePaused } from './lib/pipelinePause.js';
import { attestRuntime, workerArguments, scheduledCommand, directSyncArguments, DIRECT_SYNC_COMMAND, LIGHT_PASS_COMMAND } from '@catwalks/runtime';
import { sourceLaunchArguments } from './onboarding/launch.js';
import { isRunCompletion, workerOutcome, type RunCompletion, type CompletionStatus } from './lib/runCompletion.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
if (process.argv[2] === 'source-add') sourceLaunchArguments(process.argv.slice(3));
// D-444 : le lecteur de la liste publique est son propre service (`catwalks-direct-sync`), attesté sous son rôle.
const role = process.argv[2] === DIRECT_SYNC_COMMAND ? 'direct-sync' : 'worker';
const attestation = attestRuntime(role, process.argv.slice(2));
if (!['0', '1'].includes(process.env.PIPELINE_PAUSED ?? '')) throw new Error('PIPELINE_PAUSED must be 0 or 1 (explicit worker setting required)');
exitIfPipelinePaused(process.argv[2] ?? 'ingest-all');
const argv = process.argv.slice(2);
// R-143 §1 : hors de l'heure du RUN, le même cron lance une passe légère de découverte, s'il est l'heure d'en lancer une
// (jamais dans la fenêtre 15:30-18:30 UTC). Inerte tant que le cron du service reste celui du seul RUN.
const scheduled = argv[0] === 'scheduled' ? scheduledCommand(new Date()) : null;
const lightPass = role === 'worker' && scheduled === LIGHT_PASS_COMMAND;
if (argv[0] === 'scheduled' && !scheduled) {
  console.log(JSON.stringify({ event: 'worker.schedule_skipped', timeZone: 'Europe/Paris', requiredHour: 18 }));
  process.exit(0);
}
// Preserve the existing local maintenance CLI; deployed ingestion stays normal or source-scoped.
const [command, ...args] = role === 'direct-sync' ? directSyncArguments(argv)
  : lightPass ? (workerArguments(argv), [LIGHT_PASS_COMMAND])
  : !attestation && argv.length && argv[0] !== 'scheduled' && !argv[0].startsWith('--source=') ? argv : workerArguments(argv);
if (!['ingest-all', 'ingest', 'refresh', 'health-report', 'direct-sync', DIRECT_SYNC_COMMAND, 'source-add', LIGHT_PASS_COMMAND].includes(command)) throw new Error('Unsupported worker command');
// La surveillance Healthchecks est celle du RUN quotidien : une passe légère ne la touche jamais. Un succès à 22:00
// effacerait l'échec du RUN de 16:00 ; un échec la ferait sonner pour une passe que le RUN suivant rattrape.
const monitored = command !== LIGHT_PASS_COMMAND;
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
  if (attestation && monitored && await pingHeartbeat('start') !== 'pinged') throw new Error('Worker start heartbeat not acknowledged');
  const schema = await child(['node_modules/prisma/build/index.js', 'migrate', 'status', '--schema', 'packages/db/prisma/schema.prisma']);
  if (schema) throw new Error('Worker schema readiness failed');
  const code = await child(command === 'source-add'
    ? ['--import', 'tsx', 'apps/aggregator/scripts/ops/source-add.mts', ...args]
    : ['--import', 'tsx', 'apps/aggregator/src/cli.ts', command, ...args], command !== 'source-add');
  const outcome = workerOutcome(code, terminal, command !== 'source-add');
  process.exitCode = outcome.exitCode;
  state = outcome.state;
  // Also covers a child that exits before its DB observability could start.
  if (process.exitCode && monitored) await pingHeartbeat(false);
} catch (error) {
  state = 'FAILED';
  process.exitCode = 1;
  await log.error('worker.failed', { command, error });
  if (monitored) await pingHeartbeat(false);
}
console.log(JSON.stringify({ event: 'worker.finished', command, state, exitCode: process.exitCode, at: new Date().toISOString() }));
