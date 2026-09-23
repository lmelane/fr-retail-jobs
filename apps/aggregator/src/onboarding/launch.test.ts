import { describe, expect, it } from 'vitest';
import { sourceLaunchArguments } from './launch.js';
const args = ['--key=oh-my-cream', '--name=Oh My Cream', '--kind=teamtailor', '--careers-url=https://careers.ohmycream.com/jobs',
  '--official-domain=ohmycream.com', '--tier=EMPLOYER_DIRECT', '--reviewer=test', '--setting=origin=https://careers.ohmycream.com'];
describe('one-source operational definition', () => {
  it('builds a typed candidate without an edited JSON or state flag', () => {
    expect(sourceLaunchArguments(args).candidate).toMatchObject({ key: 'oh-my-cream', careersDomain: 'careers.ohmycream.com', config: { origin: 'https://careers.ohmycream.com' }, portalScope: null });
  });
  it.each(['--key=another', '--all=true', '--status=ACTIVE', '--setting=origin=https://other.example', '--setting=token=secret'])('rejects ambiguous scope or private inputs: %s', option => {
    expect(() => sourceLaunchArguments([...args, option])).toThrow();
  });
  it('requires the definition, official domain and reviewer', () => {
    for (let i = 0; i < args.length; i++) expect(() => sourceLaunchArguments(args.filter((_, j) => j !== i))).toThrow();
  });
  it('preserves an explicitly reviewed native URL pattern for an existing draft', () => {
    const pattern = 'https://careers.ohmycream.com/jobs/{id}';
    expect(sourceLaunchArguments([...args, `--job-url-pattern=${pattern}`]).candidate?.jobUrlPattern).toBe(pattern);
    expect(() => sourceLaunchArguments([...args, '--job-url-pattern=https://user:secret@example.com/{id}'])).toThrow();
  });
});

it('keeps qualification and child ingestion run IDs distinct without changing the runtime bindings', async () => {
  const { ingestionChildEnvironment } = await import('./launch.js');
  const env = { CATWALKS_RUNTIME_PROFILE: 'production', CATWALKS_RUN_ID: '11111111-1111-4111-8111-111111111111', PIPELINE_PAUSED: '0', DATABASE_URL: 'fixture' };
  const a = ingestionChildEnvironment(env), b = ingestionChildEnvironment(env);
  expect(a.CATWALKS_RUN_ID).not.toBe(env.CATWALKS_RUN_ID);
  expect(a.CATWALKS_RUN_ID).not.toBe(b.CATWALKS_RUN_ID);
  expect({ ...a, CATWALKS_RUN_ID: env.CATWALKS_RUN_ID }).toEqual(env);
  expect(env.CATWALKS_RUN_ID).toBe('11111111-1111-4111-8111-111111111111');
});

describe('explicit registered source qualification', () => {
  const revision = 'f35d1b6e-f09e-4608-b38f-cb1526afe802';
  const argv = ['--key=urbn-hub', `--registered-revision=${revision}`, '--official-domain=urbn.com', '--reviewer=test'];
  it('selects one stored revision without overrides or implicit source selection', () => {
    expect(sourceLaunchArguments(argv)).toMatchObject({ candidate: null, registered: { key: 'urbn-hub', revision, domain: 'urbn.com' } });
    for (const extra of ['--setting=origin=https://other.example', '--name=Other', '--all=true', '--registered-revision=other'])
      expect(() => sourceLaunchArguments([...argv, extra])).toThrow();
    for (let i = 0; i < argv.length; i++) expect(() => sourceLaunchArguments(argv.filter((_, j) => i !== j))).toThrow();
  });
  it('preserves structured configuration and refuses a changed, foreign or retired source', async () => {
    const { registeredSourceCandidate } = await import('./launch.js');
    const request = { key: 'urbn-hub', revision, domain: 'urbn.com' };
    const source = { key: request.key, currentRevisionId: revision, status: 'PAUSED', maison: 'URBN', kind: 'icims',
      config: { origin: 'https://careers-urbn.icims.com', detailOrigins: ['https://stores-na-urbn.icims.com'] },
      careersDomain: 'careers-urbn.icims.com', tier: 'GROUP_OFFICIAL', jobUrlPattern: null, portalScope: 'MULTI_BRAND', note: 'reviewed' };
    expect(registeredSourceCandidate(request, source, 'test')).toMatchObject({ config: source.config, portalScope: 'MULTI_BRAND', note: 'reviewed' });
    expect(source.status).toBe('PAUSED');
    for (const patch of [{ key: 'other' }, { currentRevisionId: 'changed' }, { status: 'RETIRED' }])
      expect(() => registeredSourceCandidate(request, { ...source, ...patch }, 'test')).toThrow();
  });
});
