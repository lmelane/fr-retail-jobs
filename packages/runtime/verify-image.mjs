/** Exercise the image's real default entrypoint with no network or real credentials. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { target } from './index.mjs';

const receiptPath = process.argv[2];
if (!receiptPath || process.argv.length !== 3) throw new Error('Usage: node packages/runtime/verify-image.mjs receipt.json');
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const service = target.services.find(s => s.name === receipt.service);
if (!service || !receipt.image?.includes('@sha256:')) throw new Error('Unknown service or unpinned image');
const worker = service.name === 'catwalks-ingestion-worker';
const env = {
  ...service.environment,
  ...Object.fromEntries(Object.keys(service.secretBindings).map(k => [k, 'offline-fixture'])),
  ...Object.fromEntries(Object.keys(service.privateConfigurationBindings ?? {}).map(k => [k, 'offline-fixture'])),
  DATABASE_URL: 'postgresql://fixture:fixture@postgres.railway.internal/railway',
  CATWALKS_RUNTIME_PROFILE: 'production-paused',
  RAILWAY_PROJECT_ID: target.scope.productionProjectId,
  RAILWAY_ENVIRONMENT_ID: target.scope.productionEnvironmentId,
  RAILWAY_SERVICE_NAME: service.name,
  RAILWAY_SERVICE_ID: randomUUID(), RAILWAY_DEPLOYMENT_ID: randomUUID(),
};
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000 }).trim();
let container;
try {
  container = docker('run', '-d', '--network=none', ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), receipt.image);
  let logs = '', state;
  for (let i = 0; i < 60; i++) {
    state = JSON.parse(docker('inspect', container))[0].State;
    logs = docker('logs', container);
    if (worker ? !state.Running : /Ready in/.test(logs) || !state.Running) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const events = logs.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const proof = events.filter(e => e.event === 'runtime.attested');
  if (proof.length !== 1 || proof[0].gitSha !== receipt.gitSha || proof[0].contractSha256 !== receipt.contractSha256)
    throw new Error(`Missing or mismatched image attestation: ${logs}`);
  if (worker) {
    const pauses = events.filter(e => e.event === 'pipeline.paused');
    if (state.Running || state.ExitCode !== 0 || pauses.length !== 1 || pauses[0].workStarted !== false || pauses[0].businessRequests !== 0)
      throw new Error(`Worker did not exit paused: ${logs}`);
  } else if (!state.Running || !/Ready in/.test(logs)) throw new Error(`API did not start: ${logs}`);
  receipt.offlineEntrypoint = { status: 'PASS', network: 'none', role: worker ? 'worker' : 'api', gitSha: proof[0].gitSha };
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ service: service.name, ...receipt.offlineEntrypoint }));
} finally { if (container) docker('rm', '-f', container); }
