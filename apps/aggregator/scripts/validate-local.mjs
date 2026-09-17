/** Repeatable test run on a fresh local Postgres. Never accepts a caller's database URL. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const name = `catwalks-validation-${randomUUID()}`;
const password = randomUUID();
// Exact image used by the 2026-09-15 rehearsal. Update deliberately with CI.
const image = 'postgres@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2';
let child;
let interrupted = false;
let container;
let dockerEndpoint;
const stop = () => {
  interrupted = true;
  if (child?.pid) {
    // npm/npx also spawn children; stop the entire test process group.
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

async function run(command, args, { capture = false, env = process.env, cleanup = false } = {}) {
  if (interrupted && !cleanup) throw Error('Validation interrupted');
  if (command === 'docker' && dockerEndpoint) {
    // Pin all calls, including cleanup, to the socket that was validated.
    args = ['--host', dockerEndpoint, ...args];
    env = { ...env };
    delete env.DOCKER_CONTEXT;
    delete env.DOCKER_HOST;
  }
  return new Promise((resolve, reject) => {
    let output = '';
    child = spawn(command, args, { cwd: root, env, detached: true,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    child.stdout?.on('data', data => { output += data; });
    child.stderr?.on('data', data => { output += data; });
    child.once('error', reject);
    child.once('exit', code => {
      child = undefined;
      code === 0 ? resolve(output.trim()) : reject(Error(`${command} failed (${code ?? 'signal'})${capture ? `: ${output.trim()}` : ''}`));
    });
  });
}

try {
  if (process.argv.length > 2) throw Error('Usage: npm run test:local (no database/target arguments)');
  // A remote Docker daemon would make localhost point at a different database.
  const context = await run('docker', ['context', 'inspect',
    ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : [])], { capture: true });
  const contextEndpoint = JSON.parse(context)[0]?.Endpoints?.docker?.Host;
  const endpoint = process.env.DOCKER_CONTEXT ? contextEndpoint : process.env.DOCKER_HOST || contextEndpoint;
  if (!endpoint?.startsWith('unix://')) throw Error('Validation requires a local Docker Unix socket');
  dockerEndpoint = endpoint;
  // An exact digest already cached locally is sufficient; registry availability
  // must not block an otherwise isolated validation.
  try { await run('docker', ['image', 'inspect', image], { capture: true }); }
  catch { await run('docker', ['pull', image]); }
  container = name;
  await run('docker', ['create', '--name', name, '--label', 'catwalks.purpose=validation',
    '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql:rw,size=1g',
    '--env', 'POSTGRES_USER=catwalks', '--env', 'POSTGRES_DB=catwalks_validation_test',
    '--env', 'POSTGRES_PASSWORD', image], { capture: true, env: { ...process.env, POSTGRES_PASSWORD: password } });
  await run('docker', ['start', container], { capture: true });
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt++) {
    try {
      await run('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'catwalks', '-d', 'catwalks_validation_test'], { capture: true });
      ready = true;
    } catch (error) {
      if (interrupted || attempt === 39) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  const address = await run('docker', ['port', container, '5432/tcp'], { capture: true });
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw Error('Unexpected test database binding');
  const url = `postgresql://catwalks:${password}@${address}/catwalks_validation_test`;
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, PGOPTIONS: '',
    READ_ONLY_CORPUS_TEST: '0', PYTHONDONTWRITEBYTECODE: '1' };
  console.log(`Validation: ${container}; fresh migrations, aggregator and API tests.`);
  for (const args of [
    ['prisma', 'generate', '--schema', 'packages/db/prisma/schema.prisma'],
    ['prisma', 'migrate', 'deploy', '--schema', 'packages/db/prisma/schema.prisma'],
  ]) await run('npx', ['--no-install', ...args], { env });
  for (const args of [
    ['run', 'check:layout', '-w', '@catwalks/aggregator'], ['run', 'typecheck'],
    ['run', 'test', '-w', '@catwalks/aggregator'], ['run', 'test', '-w', '@catwalks/api'],
  ]) await run('npm', args, { env });
  await run('python3', ['-m', 'unittest', 'discover', '-s', 'apps/aggregator/scripts/ops/tests'], { env });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (container) {
    try { await run('docker', ['rm', '--force', '--volumes', container], { cleanup: true, capture: true }); }
    catch { console.error(`Could not remove test container ${container}`); process.exitCode = 1; }
  }
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
