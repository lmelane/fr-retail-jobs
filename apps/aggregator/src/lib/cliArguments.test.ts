import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateCliArguments } from './cliArguments.js';
it('rejects unsupported scope flags instead of widening an ingestion run', () => {
  for (const [command,args] of [['ingest-all',['--only=ganni-talentrecruiter']],['ingest-all',['--source=ganni-talentrecruiter']],['ingest',['--source=']],['ingest',['--source','ganni']],['ingest',['--source=a','--source=b']]] as const)
    expect(() => validateCliArguments(command,[...args])).toThrow();
  expect(() => validateCliArguments('ingest',['--source=ganni-talentrecruiter','--no-geocode'])).not.toThrow();
  expect(() => validateCliArguments('ingest-all',[])).not.toThrow();
});
it('preserves valid operational commands and rejects ambiguous values', () => {
  expect(() => validateCliArguments('retire-source',['source-key','--external-prefix=https://'])).not.toThrow();
  expect(() => validateCliArguments('export-companies',['output.csv'])).not.toThrow();
  expect(() => validateCliArguments('discover',['--input=roster.csv','--limit=50','--concurrency=2','--fresh'])).not.toThrow();
  for (const args of [['--limit=NaN'],['--limit=-1'],['--limit=2.5']]) expect(() => validateCliArguments('classify-jobs',args)).toThrow();
  expect(() => validateCliArguments('promote',[])).toThrow();
});
it('fails the actual CLI before observability, database or egress initialization', () => {
  const result=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('../cli.ts',import.meta.url)),'ingest-all','--only=ganni-talentrecruiter'],
    { encoding:'utf8', timeout:10000, env:{...process.env,DATABASE_URL:'postgresql://invalid:invalid@127.0.0.1:1/invalid',EGRESS_PROBE:'1'} });
  expect(result.status).toBe(2); expect(result.stderr).toBe('');
  const records=result.stdout.trim().split('\n').map(line=>JSON.parse(line));
  expect(records).toHaveLength(1); expect(records[0]).toMatchObject({event:'command.invalid_arguments',durable:false,data:{workStarted:false}});
  expect(result.stdout).toContain('Unsupported option'); expect(result.stdout).not.toContain('run.started');
});
