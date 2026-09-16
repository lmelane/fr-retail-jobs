import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSourceArguments } from './arguments.js';
import { parseSourceCandidate } from '../connectors/sourceCandidate.js';

describe('source command boundary', () => {
  it.each([
    [], ['apply', 'old-manifest.json', '--apply'], ['collect', 'source'], ['validate', 'batch'], ['promote', 'source', '--apply'],
    ['promote', 'source', '--revision=current'], ['profile', 'source', '--apply'], ['status', 'source', 'extra'],
    ['identity', 'record.json'], ['identity', 'record.json', '--artifact='], ['collect', 'source', '--apply=true'],
    ['collect', 'source', '--apply', '--verified-jobs=9999'], ['collect', 'source', '--apply', '--apply'],
    ['collect', 'source', '--apply', '--deadline-ms=0'], ['collect', 'source', '--apply', '--deadline-ms=NaN'],
    ['collect', 'source', '--apply', '--deadline-ms=1.5'], ['collect', 'source', '--apply', '--deadline-ms=2147483648'],
    ['validate', 'batch', '--apply', '--deadline-ms=100'], ['register', 'candidate.json', '--source=other'],
    ['evidence', 'source', '--apply'],
    ['evidence', 'source', '--purpose=jobs', '--url=https://official.example', '--revision=current', '--apply'],
    ['evidence', 'source', '--purpose=identity', '--url=https://official.example', '--apply'],
    ['relation', 'source', '--capture=batch'], ['relation', 'source', '--official-domain=maison.example'],
    ['relation', 'source', '--capture=batch', '--official-domain=maison.example', '--apply'],
  ])('rejects ambiguous or incomplete invocation %j', (...args) => { expect(() => parseSourceArguments(args)).toThrow(); });
  it('keeps previews separate from explicit writes', () => {
    expect(parseSourceArguments(['register','candidate.json'])).toMatchObject({ command: 'register', apply: false });
    expect(parseSourceArguments(['identity','review.json','--artifact=proof.txt'])).toMatchObject({ apply: false });
    expect(parseSourceArguments(['collect','source','--apply','--deadline-ms=30000'])).toMatchObject({ apply: true });
    expect(parseSourceArguments(['promote','source','--revision=reviewed','--apply'])).toMatchObject({ options: { revision: 'reviewed' } });
    expect(parseSourceArguments(['evidence','source','--purpose=identity','--url=https://official.example','--revision=reviewed','--apply'])).toMatchObject({ command: 'evidence', apply: true });
    expect(parseSourceArguments(['relation','source','--capture=batch','--official-domain=maison.example'])).toMatchObject({ command: 'relation', apply: false });
  });
  it('rejects the actual command before database initialization or reading its target file', () => {
    const result = spawnSync(process.execPath, ['--import','tsx',fileURLToPath(new URL('../../scripts/ops/source-onboard.mts', import.meta.url)),
      'register','nonexistent.json','--verified-jobs=9999'], { encoding:'utf8', timeout:10000,
      env: { ...process.env, DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/invalid', EGRESS_PROBE:'1' } });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unknown or duplicate source option');
    expect(result.stderr).not.toContain('ENOENT');
    expect(result.stderr).not.toContain('connect');
    expect(result.stdout).toBe('');
  });
});

const candidate = { key:'test',maison:'Test',kind:'ashby',config:{board:'test'},careersDomain:'test.example',tier:'ATS_OFFICIAL' };
it.each([null, [], {}, { ...candidate, config: null }, { ...candidate, config: [] }, { ...candidate, config: {} },
  { ...candidate, status: 'ACTIVE' }, { ...candidate, robotsVerdict: 'ALLOWED' }, { ...candidate, verifiedJobCount: 9999 },
  { ...candidate, kind: 'toString' }, { ...candidate, config: { deadlineMs: 5000 } }, { ...candidate, config: { board: NaN } }])
  ('rejects fabricated registry evidence and malformed candidates %j', value => { expect(() => parseSourceCandidate(value)).toThrow(); });
it('freezes an independent finite candidate configuration before registration begins', () => {
  const input = { ...candidate, config: { board: 'test', filters: ['FR'] } };
  const parsed = parseSourceCandidate(input); input.config.filters.push('US');
  expect(parsed.config).toEqual({ board:'test', filters:['FR'] }); expect(Object.isFrozen(parsed.config)).toBe(true);
});
