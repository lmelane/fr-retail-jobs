import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNdjson } from '../scripts/search-benchmark/ndjson';
import { snapshotModel, type SnapshotMetadata } from '../scripts/search-benchmark/model';

describe('frozen search benchmark', () => {
  it('preserves Unicode line separators inside native JSON strings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'catwalks-search-'));
    try {
      const file = join(directory, 'rows.ndjson');
      const rows = [{ title: 'Concept Designer\u2028Design Team', body: 'a'.repeat(70000) + '\u2029suffix' }, { title: '次の職種' }];
      await writeFile(file, rows.map(r => JSON.stringify(r)).join('\n'));
      const actual = [];
      for await (const r of readNdjson(file)) actual.push(r);
      expect(actual).toEqual(rows);
    } finally { await rm(directory, { recursive: true }); }
  });
  it('les métiers du document sont ceux de ses colonnes, jamais une relecture du vocabulaire (search-5, D-475 point 38)', () => {
    const metadata = { asOf: '2026-09-23T00:00:00Z', companies: [], aliases: [], sectorConcepts: [],
      occupationRelease: { id: 'fixture', manifest: { occupations: [
        { key: 'manager', labels: { en: 'Store Manager' } },
        { key: 'deputy', labels: { en: 'Assistant Store Manager' } },
      ], families: [] } } } as unknown as SnapshotMetadata;
    const model = snapshotModel(metadata);
    // Prémisse : l'intitulé nomme un métier du vocabulaire, que l'ancienne indexation lisait.
    const native = { id: '1', title: 'Assistant Store Manager', company: 'Test', countryCode: 'FR' };
    expect(model.document(native)).toMatchObject({ roles: [], titleRoles: [] });
    expect(model.document({ ...native, titleRoles: ['deputy'] })).toMatchObject({ roles: ['deputy'], titleRoles: ['deputy'] });
    expect(model.document({ ...native, occupationCode: 'deputy', titleRoles: ['deputy'] }).roles).toEqual(['deputy']);
    const direct = model.document({ ...native, occupationCode: 'deputy', titleRoles: ['deputy'] }, true);
    expect(direct.id).toBe('cw_1');
    expect(direct.origin).toBe(0);
    expect(direct.roles).toEqual(['deputy']);
  });
});
