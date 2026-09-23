/** Real launchers, no database/server: a pause must precede every operational side effect. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const sideEffect = 'PAUSE_TEST_SIDE_EFFECT';
// Module loading remains real. Intercept network transport and only the operation's
// input/output files; TSX may read/compile application modules normally.
const probe = `
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const fail = name => () => { process.stderr.write('${sideEffect}:' + name + '\\n'); process.exit(97); };
globalThis.fetch = fail('fetch');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const option = Array.isArray(args[0]) ? args[0][0] : args[0];
  const path = typeof option === 'string' ? option : option?.path;
  // TSX contacts its parent through a local Unix pipe while loading modules.
  if (typeof path === 'string' && path.startsWith('/') && option?.port === undefined) return connect.apply(this, args);
  return fail('socket')();
};
tls.connect = fail('tls');
for (const api of [dns, dnsPromises]) {
  for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6']) api[name] = fail('dns');
}
for (const api of [http, https]) {
  api.request = fail('http'); api.get = fail('http');
}
for (const api of [fs, fsp]) {
  for (const name of ['readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'mkdir', 'mkdirSync', 'open', 'openSync']) {
    if (!api[name]) continue;
    const original = api[name];
    api[name] = function(path, ...args) {
      const value = path instanceof URL ? path.pathname : String(path);
      if (value.startsWith(process.env.PAUSE_TEST_FILES + '/')) return fail('file')();
      return original.call(this, path, ...args);
    };
  }
}
syncBuiltinESMExports();
`;

function withProcess(work) {
  const directory = mkdtempSync(join(tmpdir(), 'catwalks-pause-test-'));
  const files = { input: join(directory, 'candidate.json'), output: join(directory, 'reports') };
  const env = {
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    HOME: directory,
    TMPDIR: tmpdir(),
    // Deliberately unparsable: even a regression cannot connect to a real database.
    DATABASE_URL: 'invalid-pause-test-database-url', DIRECT_URL: 'invalid-pause-test-database-url',
    PIPELINE_PAUSED: '1', PIPELINE_CMD: 'ingest-all', EGRESS_PROBE: '1',
    TSX_DISABLE_CACHE: '1', PAUSE_TEST_FILES: directory,
    NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(probe)}`,
  };
  const launch = (command, args, value = '1', overrides = {}) => spawnSync(command, args, {
    cwd: root, env: { ...env, ...overrides, PIPELINE_PAUSED: value }, encoding: 'utf8', timeout: 20_000,
  });
  try { work({ directory, files, launch }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

const node = (script, args = []) => [process.execPath, ['--import', 'tsx', script, ...args]];
const cli = (...args) => node('apps/aggregator/src/cli.ts', args);
const onboard = (...args) => node('apps/aggregator/scripts/ops/source-onboard.mts', args);
const cases = [
  ['start.sh', () => ['sh', ['apps/aggregator/start.sh']]],
  ['start.sh normal', () => ['sh', ['apps/aggregator/start.sh', 'ingest-all']]],
  ['start.sh targeted', () => ['sh', ['apps/aggregator/start.sh', 'ingest', '--source=another-source']]],
  ['CLI ingest', () => cli('ingest', '--source=witness', '--no-geocode')],
  ['CLI geocode', () => cli('geocode')],
  ['CLI direct-sync', () => cli('direct-sync')],
  ['source-campaign', files => node('apps/aggregator/scripts/ops/source-campaign.mts',
    [`--candidates=${files.input}`, `--out-dir=${files.output}`, '--keys=witness', '--ingest'])],
  ['source-add', files => node('apps/aggregator/scripts/ops/source-add.mts', [
    '--key=witness', '--name=Witness', '--kind=teamtailor', '--careers-url=https://careers.example.com',
    '--official-domain=example.com', '--tier=ATS_OFFICIAL', '--reviewer=pause-test',
    '--setting=origin=https://careers.example.com', `--out-dir=${files.output}`,
  ])],
  ['source-onboard register --apply', files => onboard('register', files.input, '--apply', `--out=${files.output}`)],
  ['source-onboard collect --apply', files => onboard('collect', 'witness', '--apply', `--out=${files.output}`)],
  ['source-onboard evidence --apply', files => onboard('evidence', 'witness', '--apply', '--purpose=access',
    '--revision=witness-revision', '--url=https://careers.example.com/robots.txt', `--out=${files.output}`)],
];

for (const [name, command] of cases) {
  test(`${name}: paused before input/output files, database or network`, () => withProcess(({ directory, files, launch }) => {
    const result = launch(...command(files));
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, new RegExp(sideEffect));
    const lines = result.stdout.trim().split('\n');
    assert.equal(lines.length, 1, result.stdout);
    const event = JSON.parse(lines[0]);
    assert.equal(event.event, 'pipeline.paused');
    assert.equal(event.state, 'PAUSED');
    assert.equal(event.workStarted, false);
    assert.deepEqual(readdirSync(directory), [], 'No source dossier read or report directory created');
  }));

  test(`${name}: invalid pause refuses work`, () => withProcess(({ directory, files, launch }) => {
    const result = launch(...command(files), 'false');
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /PIPELINE_PAUSED must be 0 or 1/);
    assert.doesNotMatch(result.stderr, new RegExp(sideEffect));
    assert.equal(result.stdout, '');
    assert.deepEqual(readdirSync(directory), []);
  }));
}

test('the subprocess probe actively prevents network and operational file access', () => withProcess(({ files, launch }) => {
  for (const code of ["await fetch('https://example.com')", `await import('node:fs').then(fs => fs.readFileSync(${JSON.stringify(files.input)}))`]) {
    const result = launch(process.execPath, ['--input-type=module', '-e', code]);
    assert.ifError(result.error);
    assert.equal(result.status, 97);
    assert.match(result.stderr, new RegExp(sideEffect));
  }
}));

const revision = 'a'.repeat(40);
for (const [name, args, pause, env, error] of [
  ['unknown argument', ['--typo'], '1', {}, /Expected --preflight/],
  ['unpaused', ['--preflight', `--expected-revision=${revision}`], '0', {}, /requires PIPELINE_PAUSED=1/],
  ['wrong deployed revision', ['--preflight', `--expected-revision=${revision}`], '1', { RAILWAY_GIT_COMMIT_SHA: 'b'.repeat(40) }, /revision mismatch/],
  ['missing heartbeat', ['--preflight', `--expected-revision=${revision}`], '1', { RAILWAY_GIT_COMMIT_SHA: revision }, /requires configured heartbeat/],
]) {
  test(`worker preflight rejects ${name} before any network or DB access`, () => withProcess(({ launch }) => {
    const result = launch(...node('apps/aggregator/scripts/ops/worker-status.mts', args), pause, env);
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.doesNotMatch(result.stderr, new RegExp(sideEffect));
    const event = JSON.parse(result.stdout.trim());
    assert.equal(event.event, 'worker.status_failed');
    assert.match(event.error.message, error);
  }));
}

test('paused preflight: real read-only DB, heartbeat failure, and live run outside displayed ten',
  { skip: !process.env.PREFLIGHT_TEST_DATABASE_URL }, async () => {
    const url = new URL(process.env.PREFLIGHT_TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && /^\/catwalks_preflight_test_[a-z0-9_]+$/.test(url.pathname));
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient({ datasourceUrl: url.href });
    assert.equal(await db.pipelineRun.count(), 0, 'Requires a dedicated empty test database');
    let status = 200;
    let requests = 0;
    const server = createServer((_req, response) => { requests++; response.writeHead(status).end(); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const run = () => new Promise((resolve, reject) => {
      const child = spawn(...node('apps/aggregator/scripts/ops/worker-status.mts', ['--preflight', `--expected-revision=${revision}`]), {
        cwd: root, env: { ...process.env, DATABASE_URL: url.href, DIRECT_URL: url.href, PIPELINE_PAUSED: '1',
          RAILWAY_GIT_COMMIT_SHA: revision, HEALTHCHECK_PING_URL: `http://127.0.0.1:${server.address().port}` },
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000,
      });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
      child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr,
        event: JSON.parse(stdout.trim().split('\n').at(-1)) }));
    });
    try {
      const healthy = await run();
      assert.equal(healthy.code, 0, healthy.stderr);
      assert.equal(healthy.event.event, 'worker.paused_preflight');
      assert.equal(healthy.event.heartbeat, 'pinged');
      assert.equal(healthy.event.pause.workStarted, false);
      assert.equal(await db.pipelineRun.count(), 0);
      status = 503;
      const failed = await run();
      assert.equal(failed.code, 1);
      assert.match(failed.event.error.message, /heartbeat not acknowledged/);
      assert.equal(await db.pipelineRun.count(), 0);
      // This live run is older than ten stale ones: a display limit must not hide it.
      await db.pipelineRun.createMany({ data: Array.from({ length: 11 }, (_, i) => ({
        id: `preflight-${i}`, command: 'test', startedAt: new Date(Date.now() - (i === 0 ? 600_000 : 180_000)),
      })) });
      await db.pipelineEvent.create({ data: { id: 'preflight-alive', runId: 'preflight-0',
        event: 'run.alive', level: 'info', fingerprint: 'test', payload: {} } });
      const before = requests;
      const busy = await run();
      assert.equal(busy.code, 1);
      assert.match(busy.event.error.message, /observed a live pipeline/);
      assert.equal(requests, before, 'No heartbeat before the live-run refusal');
      assert.equal(await db.pipelineRun.count(), 11, 'The command did not create a run');
      assert.equal(await db.captureBatch.count(), 0);
    } finally {
      await db.pipelineEvent.deleteMany({ where: { id: 'preflight-alive' } });
      await db.pipelineRun.deleteMany({ where: { id: { in: Array.from({ length: 11 }, (_, i) => `preflight-${i}`) } } });
      await db.$disconnect();
      await new Promise(resolve => server.close(resolve));
    }
  });
