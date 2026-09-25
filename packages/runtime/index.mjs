import { readFileSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const targetUrl = new URL('../../docs/operations/railway/runtime-target.json', import.meta.url);
const releaseUrl = new URL('./release.json', import.meta.url);
export const target = JSON.parse(readFileSync(targetUrl, 'utf8'));
export const contractSha256 = createHash('sha256').update(readFileSync(targetUrl)).digest('hex');
export const release = existsSync(releaseUrl) ? JSON.parse(readFileSync(releaseUrl, 'utf8')) : null;

const fail = reason => { throw new Error(`Runtime contract rejected: ${reason}`); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

/** The service each role runs as; a process may only attest as the service its role names. */
export const SERVICE_OF_ROLE = { api: 'catwalks-catalogue-api', worker: 'catwalks-ingestion-worker', 'direct-sync': 'catwalks-direct-sync' };
/** D-444: the direct-sync service runs one command, the public-list reader; no argument widens or retargets it. */
export const DIRECT_SYNC_COMMAND = 'direct-liste';
export function directSyncArguments(argv) {
  if (argv.length !== 1 || argv[0] !== DIRECT_SYNC_COMMAND) fail('unsupported direct-sync argv');
  return argv;
}

/** Execution scope is an argument, never a release-specific source allowlist. */
export function workerArguments(argv) {
  // The existing source-add parser owns its public definition contract. The
  // worker validates it before heartbeat/schema/network, then runs that CLI.
  if (argv[0] === 'source-add' && argv.length > 1) return argv;
  if (argv.length === 1 && argv[0] === 'scheduled') return ['ingest-all'];
  if (argv.length === 0 || (argv.length === 1 && argv[0] === 'ingest-all')) return ['ingest-all'];
  const args = argv[0]?.startsWith('--source=') ? ['ingest', ...argv] : argv;
  if (args[0] !== 'ingest') fail('unsupported worker argv');
  const sources = args.slice(1).filter(a => /^--source=[a-z0-9][a-z0-9_-]*$/.test(a));
  if (sources.length !== 1 || args.slice(1).some(a => a !== sources[0] && a !== '--no-geocode') ||
      new Set(args).size !== args.length) fail('targeted argv requires exactly one source');
  return args;
}

/** Railway cron is UTC-only. Both UTC candidates launch; exactly one enters
 * the pipeline at 18:00 Europe/Paris, including the DST transition dates. */
export function scheduledRunDue(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(now) === '18';
}

/** Pure validation, shared only by the catalogue API and ingestion worker. */
export function validateRuntime(role, argv, env, built, now = Date.now()) {
  if (!Object.hasOwn(SERVICE_OF_ROLE, role)) fail('unknown role');
  if (!built || !/^[a-f0-9]{40}$/.test(built.gitSha) || built.contractSha256 !== contractSha256)
    fail('missing or inconsistent embedded release');
  const profile = target.profiles.find(p => p.name === env.CATWALKS_RUNTIME_PROFILE);
  if (!profile) fail('missing or unknown profile');
  if (!profile.roles.includes(role)) fail('profile does not allow this role');
  const service = target.services.find(s => s.name === SERVICE_OF_ROLE[role]);
  if (!service) fail('service of this role is not in the contract');
  // The direct-sync reader is a scheduled job like the worker: the same explicit pause rule governs it, but through its
  // OWN service variable. Pausing the worker does not pause direct-sync, and the reverse.
  const scheduled = role === 'worker' || role === 'direct-sync';
  if (scheduled && !['0', '1'].includes(env.PIPELINE_PAUSED)) fail('PIPELINE_PAUSED must be 0 or 1');
  const running = scheduled && env.PIPELINE_PAUSED === '0';
  if (role === 'api' && argv.length) fail('API argv must be empty');
  if (running) (role === 'direct-sync' ? directSyncArguments : workerArguments)(argv);

  const values = { ...service.environment, CATWALKS_RUNTIME_PROFILE: profile.name };
  if (scheduled) values.PIPELINE_PAUSED = profile.workerPaused === 'environment' ? env.PIPELINE_PAUSED : profile.workerPaused;
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
    if (env.CATWALKS_RUN_DEADLINE !== undefined) {
      deadline = Date.parse(env.CATWALKS_RUN_DEADLINE);
      if (!Number.isFinite(deadline) || deadline <= now || deadline - now > profile.optionalDeadlineMaximumSeconds * 1000)
        fail('expired or excessive run window');
    }
  }
  return { profile, service, deadline, proof: {
    event: 'runtime.attested', role, profile: profile.name, gitSha: built.gitSha, contractSha256,
    argv, values, secretNames, privateConfigurationNames: privateNames,
    generatedEnvironment: Object.fromEntries([...generatedNames, ...serviceDomainNames].filter(k => env[k] !== undefined).map(k => [k, env[k]])),
    imageEnvironment: Object.fromEntries(osNames.filter(k => env[k] !== undefined).map(k => [k, env[k]])),
    database: dbTarget, runId: running ? env.CATWALKS_RUN_ID : null,
    deadline: running ? env.CATWALKS_RUN_DEADLINE ?? null : null,
    pid: process.pid, node: process.version, at: new Date(now).toISOString(),
  }};
}

export function attestRuntime(role, argv) {
  // Local developer CLI remains available; a built image or Railway process
  // always requires the contract. No opt-out flag exists in deployed images.
  if (!release && !process.env.RAILWAY_PROJECT_ID && !process.env.CATWALKS_RUNTIME_PROFILE) return null;
  // A cron launch gets a fresh identity; an explicit debug run may supply its own.
  if ((role === 'worker' || role === 'direct-sync') && process.env.PIPELINE_PAUSED === '0') process.env.CATWALKS_RUN_ID ??= randomUUID();
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
  // Host/path/method authorization belongs to the source's existing access decision.
  // http.ts still checks that decision and the SSRF boundary on every redirect hop.
  if (!profile?.roles.includes('worker') || profile.workerPaused === '1' || process.env.PIPELINE_PAUSED !== '0' ||
      !['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    fail('business egress outside running worker');
}
