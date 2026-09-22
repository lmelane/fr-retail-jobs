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
});
