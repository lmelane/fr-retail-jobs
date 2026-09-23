import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const targetUrl = new URL('../../docs/operations/railway/runtime-target.json', import.meta.url);
const releaseUrl = new URL('./release.json', import.meta.url);
export const target = JSON.parse(readFileSync(targetUrl, 'utf8'));
export const contractSha256 = createHash('sha256').update(readFileSync(targetUrl)).digest('hex');
export const release = existsSync(releaseUrl) ? JSON.parse(readFileSync(releaseUrl, 'utf8')) : null;

const fail = reason => { throw new Error(`Runtime contract rejected: ${reason}`); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

/** Pure validation, shared only by the catalogue API and ingestion worker. */
export function validateRuntime(role, argv, env, built, now = Date.now()) {
  if (!['api', 'worker'].includes(role)) fail('unknown role');
  if (!built || !/^[a-f0-9]{40}$/.test(built.gitSha) || built.contractSha256 !== contractSha256)
    fail('missing or inconsistent embedded release');
  const profile = target.profiles.find(p => p.name === env.CATWALKS_RUNTIME_PROFILE);
  if (!profile) fail('missing or unknown profile');
  if (role === 'api' && !profile.name.endsWith('-paused')) fail('API requires base profile');
  const service = target.services[role === 'api' ? 0 : 1];
  const running = role === 'worker' && profile.workerPaused === '0';
  const expectedArgs = role === 'api' ? [] : profile.workerCommand.split(' ').slice(2);
  if (JSON.stringify(argv) !== JSON.stringify(expectedArgs)) fail('argv differs from profile');

  const values = { ...service.environment, CATWALKS_RUNTIME_PROFILE: profile.name };
  if (role === 'worker') values.PIPELINE_PAUSED = profile.workerPaused;
  for (const [name, value] of Object.entries(values)) if (env[name] !== value) fail(`value differs: ${name}`);
  const secretNames = Object.keys(service.secretBindings);
  const privateNames = Object.keys(service.privateConfigurationBindings ?? {});
  for (const name of [...secretNames, ...privateNames]) if (!env[name]?.trim()) fail(`missing binding: ${name}`);
  const generatedNames = target.processPolicy.platformGeneratedNames;
  const serviceDomainNames = Object.keys(env).filter(k => new RegExp(target.processPolicy.generatedServiceDomainVariables.pattern).test(k));
  const osNames = target.processPolicy.imageAndOsNames;
  const allowed = new Set([...Object.keys(values), ...secretNames, ...privateNames, ...generatedNames, ...serviceDomainNames, ...osNames,
    ...(running ? target.processPolicy.runEnvironmentNames : [])]);
  const unknown = Object.keys(env).filter(k => !allowed.has(k));
  if (unknown.length) fail(`unexpected environment keys: ${unknown.sort().join(',')}`);
  const db = (() => { try { return new URL(env.DATABASE_URL); } catch { fail('invalid database binding'); } })();
  const dbTarget = target.processPolicy.databaseTargets[profile.database];
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || db.hostname !== dbTarget.hostname ||
      decodeURIComponent(db.pathname.slice(1)) !== dbTarget.database || !db.username || !db.password)
    fail('wrong database binding');
  if (env.RAILWAY_PROJECT_ID !== target.scope.productionProjectId) fail('wrong project');
  for (const key of ['RAILWAY_SERVICE_ID', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_DEPLOYMENT_ID'])
    if (!uuid(env[key])) fail(`missing platform identity: ${key}`);
  if (env.RAILWAY_SERVICE_NAME !== service.name) fail('wrong service name');
  const isProduction = env.RAILWAY_ENVIRONMENT_ID === target.scope.productionEnvironmentId;
  if (isProduction !== (profile.database === 'production')) fail('profile/environment mismatch');
  if (env.RAILWAY_GIT_COMMIT_SHA && env.RAILWAY_GIT_COMMIT_SHA !== built.gitSha) fail('source revision mismatch');
  let deadline = null;
  if (running) {
    if (!uuid(env.CATWALKS_RUN_ID)) fail('missing unique run ID');
    deadline = Date.parse(env.CATWALKS_RUN_DEADLINE ?? '');
    if (!Number.isFinite(deadline) || deadline <= now || deadline - now > profile.maximumDurationSeconds * 1000)
      fail('expired or excessive run window');
  }
  return { profile, service, deadline, proof: {
    event: 'runtime.attested', role, profile: profile.name, gitSha: built.gitSha, contractSha256,
    argv, values, secretNames, privateConfigurationNames: privateNames,
    generatedEnvironment: Object.fromEntries([...generatedNames, ...serviceDomainNames].filter(k => env[k] !== undefined).map(k => [k, env[k]])),
    imageEnvironment: Object.fromEntries(osNames.filter(k => env[k] !== undefined).map(k => [k, env[k]])),
    database: dbTarget, runId: running ? env.CATWALKS_RUN_ID : null,
    deadline: running ? env.CATWALKS_RUN_DEADLINE : null,
    pid: process.pid, node: process.version, at: new Date(now).toISOString(),
  }};
}

export function attestRuntime(role, argv) {
  // Local developer CLI remains available; a built image or Railway process
  // always requires the contract. No opt-out flag exists in deployed images.
  if (!release && !process.env.RAILWAY_PROJECT_ID && !process.env.CATWALKS_RUNTIME_PROFILE) return null;
  const checked = validateRuntime(role, argv, process.env, release);
  console.log(JSON.stringify(checked.proof));
  return checked;
}

/** Business HTTP boundary, before DNS/fetch and on every redirect hop. */
export function assertBusinessUrl(value) {
  const name = process.env.CATWALKS_RUNTIME_PROFILE;
  if (!name && !release) return;
  const profile = target.profiles.find(p => p.name === name);
  let url;
  try { url = new URL(value); } catch { fail('invalid business URL'); }
  if (!profile || url.protocol !== 'https:' || url.port || url.username || url.password ||
      !profile.businessHosts.includes(url.hostname)) fail('business egress outside selected profile');
}
