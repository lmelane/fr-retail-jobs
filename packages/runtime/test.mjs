import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntime, contractSha256, target, assertBusinessUrl } from './index.mjs';

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
  assert.throws(() => validateRuntime('worker', ['ingest-all'], env, built, now), /argv/);
});
test('canary requires exact arguments, unique run ID and a bounded deadline', () => {
  const env = { ...fixture('worker', 'production-ohmycream'), PIPELINE_PAUSED: '0', CATWALKS_RUN_ID: id,
    CATWALKS_RUN_DEADLINE: new Date(now + 600_000).toISOString() };
  const args = ['ingest', '--source=oh-my-cream', '--no-geocode'];
  assert.equal(validateRuntime('worker', args, env, built, now).proof.runId, id);
  for (const deadline of [undefined, 'invalid', new Date(now - 1).toISOString(), new Date(now + 901_000).toISOString()])
    assert.throws(() => validateRuntime('worker', args, { ...env, CATWALKS_RUN_DEADLINE: deadline }, built, now));
  assert.throws(() => validateRuntime('worker', args, { ...env, CATWALKS_RUN_ID: undefined }, built, now));
  assert.throws(() => validateRuntime('worker', [...args, '--source=other'], env, built, now), /argv/);
});
test('API attests public values without copying secrets', () => {
  const env = fixture('api'); env.CATALOGUE_API_KEY = 'credential-not-for-logs';
  const result = validateRuntime('api', [], env, built, now);
  assert.equal(result.proof.role, 'api');
  assert.ok(!JSON.stringify(result.proof).includes(env.CATALOGUE_API_KEY));
  assert.ok(!JSON.stringify(result.proof).includes(env.DATABASE_URL));
});
test('source and redirect boundaries reject every other business origin without a request', () => {
  const before = process.env.CATWALKS_RUNTIME_PROFILE;
  try {
    process.env.CATWALKS_RUNTIME_PROFILE = 'validation-ohmycream';
    assert.doesNotThrow(() => assertBusinessUrl('https://careers.ohmycream.com/jobs.json'));
    for (const url of ['https://other.example', 'https://careers.ohmycream.com.evil.test',
      'http://careers.ohmycream.com', 'https://careers.ohmycream.com:8443/jobs', 'https://a:b@careers.ohmycream.com'])
      assert.throws(() => assertBusinessUrl(url), /outside selected profile/);
    process.env.CATWALKS_RUNTIME_PROFILE = 'validation-paused';
    assert.throws(() => assertBusinessUrl('https://careers.ohmycream.com'), /outside selected profile/);
  } finally { if (before === undefined) delete process.env.CATWALKS_RUNTIME_PROFILE; else process.env.CATWALKS_RUNTIME_PROFILE = before; }
});
