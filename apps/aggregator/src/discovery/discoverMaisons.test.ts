import { expect, it } from 'vitest';
import { loadDeadNames, parseRosterCsv, discoveryTaskKey } from './discoverMaisons.js';

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoveryOutputDirectory, loadProcessed } from './discoverMaisons.js';

it('expires dead-domain observations without depending on a historical export', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discovery-'));
  try {
    const file = join(dir, 'dead.tsv');
    writeFileSync(file, 'name\ta\tb\tc\td\tcheckedAt\nFresh\t\t\t\t\t2026-09-09\nStale\t\t\t\t\t2026-07-01\nUndated\t\t\t\t\t\n');
    expect([...loadDeadNames(file, new Date('2026-09-10'))]).toEqual(['fresh']);
    expect(loadDeadNames(file, new Date('2026-11-10')).size).toBe(0);
    expect(loadDeadNames(undefined).size).toBe(0);
    expect(() => loadDeadNames(join(dir, 'missing.tsv'))).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('isolates discovery progress between output directories', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discovery-'));
  try {
    const file = join(dir, 'progress.jsonl');
    writeFileSync(file, JSON.stringify({taskKey:'one', status:'ats', checkedAt:'2026-09-09'})+'\n');
    expect([...loadProcessed(file, Date.parse('2026-09-10'))]).toEqual(['one']);
    expect(loadProcessed(join(dir,'other.jsonl')).size).toBe(0);
    expect(discoveryOutputDirectory(dir)).toBe(dir);
    for (const path of ['../../', '../../data', '../../src'])
      expect(() => discoveryOutputDirectory(fileURLToPath(new URL(path, import.meta.url)))).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('preserves a quoted business name containing commas', () => {
  expect(parseRosterCsv('name,url\n"Maison, Inc.",https://brand.com/careers'))
    .toEqual([{ name: 'Maison, Inc.', url: 'https://brand.com/careers' }]);
});
it('keeps regional portals separate and preserves non-Latin identities', () => {
  expect(discoveryTaskKey({name:'集团',url:'https://brand.com/fr'})).not.toBe(discoveryTaskKey({name:'集团',url:'https://brand.com/us'}));
  expect(discoveryTaskKey({name:'集团',url:'https://brand.com'})).not.toBe(discoveryTaskKey({name:'公司',url:'https://brand.com'}));
});
