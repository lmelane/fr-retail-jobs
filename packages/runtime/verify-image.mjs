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
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000 }).trim();

/**
 * Start the image as one service of the contract, offline, under the paused production profile. A scheduled service
 * (worker, direct-sync) must attest and exit paused; the API must attest and become ready. The direct-sync service
 * (D-444) runs the worker's image with its own start command: it is verified on the worker's receipt.
 */
async function verify(target_, command) {
  const scheduled = target_.name !== 'catwalks-catalogue-api';
  const env = {
    ...target_.environment,
    ...Object.fromEntries(Object.keys(target_.secretBindings).map(k => [k, 'offline-fixture'])),
    ...Object.fromEntries(Object.keys(target_.privateConfigurationBindings ?? {}).map(k => [k, 'offline-fixture'])),
    DATABASE_URL: 'postgresql://fixture:fixture@postgres.railway.internal/railway',
    CATWALKS_RUNTIME_PROFILE: 'production-paused',
    RAILWAY_PROJECT_ID: target.scope.productionProjectId,
    RAILWAY_ENVIRONMENT_ID: target.scope.productionEnvironmentId,
    RAILWAY_SERVICE_NAME: target_.name,
    RAILWAY_SERVICE_ID: randomUUID(), RAILWAY_DEPLOYMENT_ID: randomUUID(),
  };
  let container;
  try {
    container = docker('run', '-d', '--network=none', ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), receipt.image, ...command);
    let logs = '', state;
    for (let i = 0; i < 60; i++) {
      state = JSON.parse(docker('inspect', container))[0].State;
      logs = docker('logs', container);
      if (scheduled ? !state.Running : /Ready in/.test(logs) || !state.Running) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const events = logs.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const proof = events.filter(e => e.event === 'runtime.attested');
    if (proof.length !== 1 || proof[0].gitSha !== receipt.gitSha || proof[0].contractSha256 !== receipt.contractSha256)
      throw new Error(`Missing or mismatched image attestation (${target_.name}): ${logs}`);
    if (scheduled) {
      const pauses = events.filter(e => e.event === 'pipeline.paused');
      if (state.Running || state.ExitCode !== 0 || pauses.length !== 1 || pauses[0].workStarted !== false || pauses[0].businessRequests !== 0)
        throw new Error(`${target_.name} did not exit paused: ${logs}`);
    } else if (!state.Running || !/Ready in/.test(logs)) throw new Error(`API did not start: ${logs}`);
    return { status: 'PASS', network: 'none', role: proof[0].role, gitSha: proof[0].gitSha };
  } finally { if (container) docker('rm', '-f', container); }
}

receipt.offlineEntrypoint = await verify(service, []);
console.log(JSON.stringify({ service: service.name, ...receipt.offlineEntrypoint }));
// Services that run this very image with their own command (D-444: catwalks-direct-sync on the worker image).
for (const shared of target.services.filter(s => s.imageOf === service.name)) {
  receipt.sharedOfflineEntrypoints = { ...receipt.sharedOfflineEntrypoints, [shared.name]: await verify(shared, shared.startCommand.split(' ')) };
  console.log(JSON.stringify({ service: shared.name, image: receipt.image, ...receipt.sharedOfflineEntrypoints[shared.name] }));
}
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
