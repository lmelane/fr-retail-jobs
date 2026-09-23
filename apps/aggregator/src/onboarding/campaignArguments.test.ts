import { describe, it, expect } from 'vitest';
import { campaignArguments, selectCandidates } from './campaignArguments.js';
const base = ['--candidates=input', '--out-dir=proof', '--keys=one,two', '--reviewer=test'];
describe('bounded campaign definition', () => {
  it('selects only explicit keys in requested order', () => {
    const args = campaignArguments([...base, '--limit=1', '--ingest']);
    expect(selectCandidates([{key:'two'}, {key:'one'}, {key:'other'}], args)).toEqual([{key:'one'}]);
    expect(args.ingest).toBe(true);
  });
  it.each(['--keys=', '--keys', '--all', '--resume', '--limit=-1', '--limit=NaN', '--deadline-ms=0', '--ingest=0'])('refuses ambiguous %s', extra => {
    expect(() => campaignArguments([...base,extra])).toThrow();
  });
  it('refuses missing and duplicate sources', () => {
    const args = campaignArguments(base);
    expect(() => selectCandidates([{key:'one'}],args)).toThrow();
    expect(() => selectCandidates([{key:'one'}, {key:'one'}, {key:'two'}],args)).toThrow();
    expect(() => campaignArguments(base.filter(x => !x.startsWith('--keys=')))).toThrow();
  });
});

it('requires the exact revision to resume qualification of a single paused source', async () => {
  const { sourceQualificationRefusal } = await import('./campaignArguments.js');
  const revision = 'f35d1b6e-f09e-4608-b38f-cb1526afe802';
  const single = ['--candidates=input', '--out-dir=proof', '--keys=one', '--reviewer=test', `--resume-revision=${revision}`];
  expect(campaignArguments(single).resumeRevision).toBe(revision);
  expect(() => campaignArguments([...base, `--resume-revision=${revision}`])).toThrow();
  expect(sourceQualificationRefusal('PAUSED', revision)).toContain('PAUSED');
  expect(sourceQualificationRefusal('PAUSED', revision, 'changed')).toContain('changed');
  expect(sourceQualificationRefusal('RETIRED', revision, revision)).toContain('RETIRED');
  expect(sourceQualificationRefusal('PAUSED', revision, revision)).toBeNull();
  expect(sourceQualificationRefusal('ACTIVE', revision)).toBeNull();
});
