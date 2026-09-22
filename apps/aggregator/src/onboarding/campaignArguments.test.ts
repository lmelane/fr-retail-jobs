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
