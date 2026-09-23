import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntime, contractSha256, target, assertBusinessUrl, workerArguments, scheduledRunDue } from './index.mjs';

const built = { gitSha: 'a'.repeat(40), contractSha256 };
const now = Date.now();
const id = '11111111-1111-4111-8111-111111111111';
function fixture(role = 'worker', profile = 'production-paused') {
  const service = target.services[role === 'api' ? 0 : 1];
  return { ...service.environment, CATWALKS_RUNTIME_PROFILE: profile,
    DATABASE_URL: 'postgresql://fixture:fixture@postgres.railway.internal/railway',
    ...Object.fromEntries(Object.keys(service.secretBindings).filter(k => k !== 'DATABASE_URL').map(k => [k, 'fixture'])),
    ...Object.fromEntries(Object.keys(service.privateConfigurationBindings ?? {}).map(k => [k, 'fixture'])),
    RAILWAY_SERVICE_NAME: service.name, RAILWAY_SERVICE_ID: id, RAILWAY_DEPLOYMENT_ID: id,
    RAILWAY_PROJECT_ID: target.scope.productionProjectId, RAILWAY_ENVIRONMENT_ID: target.scope.productionEnvironmentId,
  };
}
test('unknown configuration, missing pause and wrong database stop before work', () => {
  const env = fixture();
  assert.equal(validateRuntime('worker', [], env, built, now).profile.workerPaused, '1');
  for (const key of ['EGRESS_PROBE', 'PIPELINE_CMD', 'RAILWAY_RUN_COMMAND', 'NODE_OPTIONS', 'TYPO'])
    assert.throws(() => validateRuntime('worker', [], { ...env, [key]: 'anything' }, built, now), /unexpected environment/);
  for (const value of [undefined, '', 'false', '0'])
    assert.throws(() => validateRuntime('worker', [], { ...env, PIPELINE_PAUSED: value }, built, now));
  assert.throws(() => validateRuntime('worker', [], { ...env, DATABASE_URL: 'postgresql://a:b@wrong/railway' }, built, now), /database/);
  assert.throws(() => validateRuntime('worker', [], env, { ...built, contractSha256: 'bad' }, now), /embedded release/);
  assert.doesNotThrow(() => validateRuntime('worker', ['ingest-all'], env, built, now));
});
test('normal execution selects every ACTIVE source; explicit source stays a run argument', () => {
  const env = { ...fixture('worker', 'production'), PIPELINE_PAUSED: '0', CATWALKS_RUN_ID: id };
  for (const argv of [[], ['ingest-all']]) {
    assert.deepEqual(workerArguments(argv), ['ingest-all']);
    assert.equal(validateRuntime('worker', argv, env, built, now).deadline, null);
  }
  for (const source of ['oh-my-cream', 'another-source']) {
    const argv = ['ingest', `--source=${source}`, '--no-geocode'];
    assert.deepEqual(workerArguments(argv), argv);
    assert.equal(validateRuntime('worker', argv, env, built, now).proof.runId, id);
    assert.deepEqual(workerArguments([`--source=${source}`]), ['ingest', `--source=${source}`]);
  }
  for (const argv of [['ingest'], ['ingest', '--source='], ['ingest', '--source=a', '--source=b'],
    ['ingest', '--source=a', '--source=a'], ['ingest', '--source=a', '--typo'], ['ingest-all', '--source=a'], ['refresh']])
    assert.throws(() => validateRuntime('worker', argv, env, built, now), /argv/);
  assert.throws(() => validateRuntime('worker', [], { ...env, INGEST_ONLY_KEYS: 'oh-my-cream' }, built, now), /unexpected environment/);
  assert.throws(() => validateRuntime('worker', [], { ...env, CATWALKS_RUN_ID: undefined }, built, now), /unique run ID/);
  // Pause overrides normal or targeted arguments, without needing run identity/deadline.
  const paused = { ...fixture('worker', 'production'), PIPELINE_PAUSED: '1' };
  for (const argv of [[], ['ingest-all'], ['ingest', '--source=anything']])
    assert.equal(validateRuntime('worker', argv, paused, built, now).proof.runId, null);
});
test('an optional bounded run deadline remains validated', () => {
  const env = { ...fixture('worker', 'production'), PIPELINE_PAUSED: '0', CATWALKS_RUN_ID: id };
  assert.equal(validateRuntime('worker', [], { ...env, CATWALKS_RUN_DEADLINE: new Date(now + 600_000).toISOString() }, built, now).deadline, now + 600_000);
  for (const deadline of ['', 'invalid', new Date(now - 1).toISOString(), new Date(now + 901_000).toISOString()])
    assert.throws(() => validateRuntime('worker', [], { ...env, CATWALKS_RUN_DEADLINE: deadline }, built, now), /run window/);
});
test('API attests public values without copying secrets', () => {
  const env = fixture('api'); env.CATALOGUE_API_KEY = 'credential-not-for-logs';
  const result = validateRuntime('api', [], env, built, now);
  assert.equal(result.proof.role, 'api');
  assert.ok(!JSON.stringify(result.proof).includes(env.CATALOGUE_API_KEY));
  assert.ok(!JSON.stringify(result.proof).includes(env.DATABASE_URL));
});
test('runtime egress follows pause; source access and SSRF remain in the HTTP layer', () => {
  const before = { profile: process.env.CATWALKS_RUNTIME_PROFILE, pause: process.env.PIPELINE_PAUSED };
  try {
    process.env.CATWALKS_RUNTIME_PROFILE = 'production';
    process.env.PIPELINE_PAUSED = '0';
    for (const url of ['https://careers.ohmycream.com/jobs.json', 'https://other.example/jobs', 'http://other.example/jobs'])
      assert.doesNotThrow(() => assertBusinessUrl(url));
    for (const url of ['file:///etc/passwd', 'https://a:b@careers.ohmycream.com'])
      assert.throws(() => assertBusinessUrl(url), /outside running worker/);
    process.env.PIPELINE_PAUSED = '1';
    assert.throws(() => assertBusinessUrl('https://careers.ohmycream.com'), /outside running worker/);
    process.env.PIPELINE_PAUSED = '0';
    process.env.CATWALKS_RUNTIME_PROFILE = 'production-paused';
    assert.throws(() => assertBusinessUrl('https://careers.ohmycream.com'), /outside running worker/);
  } finally {
    for (const [key, value] of [['CATWALKS_RUNTIME_PROFILE', before.profile], ['PIPELINE_PAUSED', before.pause]])
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

// Spring and autumn clock changes never shift the requested local run hour.
for (const day of ['2026-03-28','2026-03-29','2026-09-23','2026-10-24','2026-10-25','2026-12-01']) {
  test(`exactly one daily Paris run on ${day}`, () => {
    const due = [16,17].filter(hour => scheduledRunDue(new Date(`${day}T${hour}:00:00Z`)));
    assert.equal(due.length, 1);
    const winter = ['2026-03-28','2026-10-25','2026-12-01'].includes(day);
    assert.equal(due[0], winter ? 17 : 16);
    assert.ok(scheduledRunDue(new Date(`${day}T${due[0]}:09:00Z`)));
  });
}
test('scheduled invocation uses the normal worker and rejects extra arguments', () => {
  assert.deepEqual(workerArguments(['scheduled']), ['ingest-all']);
  assert.throws(() => workerArguments(['scheduled', '--source=one']), /argv/);
});
