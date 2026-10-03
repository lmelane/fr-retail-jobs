import { describe, expect, it } from 'vitest';
import { selectAnchorDuplicates } from './anchorDuplicates.js';

/**
 * Lumentee, production lue le 03/10/2026 (lecture seule) : cinq représentations actives de « D2C Growth Marketer », une
 * par ancre de https://lumentee.com/careers/. Identifiants et adresses réels.
 */
const row = (id: string, url: string, jobId: string, title = 'D2C Growth Marketer') => ({ id, url, title, isActive: true, jobId });
const rows = [
  row('cmueb91zl0svhoi35fnxxl07c', 'https://lumentee.com/careers/', 'cmueb91zl0svfoi35f5a0906v'),
  row('cmueb922v0svvoi350b4b0hcx', 'https://lumentee.com/careers/#roles', 'cmueb922v0svtoi353w1hpfep'),
  row('cmueb92180svooi35ds8s6c0f', 'https://lumentee.com/careers/#main', 'cmueb92180svmoi35cdsb5wxf'),
  row('cmueb924d0sw2oi35q6q1iv0t', 'https://lumentee.com/careers/#culture', 'cmueb924d0sw0oi358w0ule8h'),
  row('cmueb925x0sw9oi35fnmfpv9d', 'https://lumentee.com/careers/#', 'cmueb925x0sw7oi354rsh92vl'),
];
const spec = { batchId: 'test', sourceKey: 'lumentee', keepUrl: 'https://lumentee.com/careers/',
  duplicateUrls: ['https://lumentee.com/careers/#roles', 'https://lumentee.com/careers/#main', 'https://lumentee.com/careers/#culture', 'https://lumentee.com/careers/#'],
  statement: 'une seule offre relue par chacune des ancres de la page, publiée cinq fois' };

describe('Copies d’une offre publiées une fois par ancre (Lumentee, 03/10/2026)', () => {
  it('garde la représentation à la vraie adresse et retire les quatre copies nommées', () => {
    const { keep, duplicates } = selectAnchorDuplicates(rows, spec);
    expect(keep.id).toBe('cmueb91zl0svhoi35fnxxl07c');
    expect(duplicates.map((d) => d.url).sort()).toEqual([...spec.duplicateUrls].sort());
  });
  it('refuse une copie qui n’est pas la même page, ou qui porte un autre intitulé', () => {
    const other = [...rows.slice(0, 4), row('x', 'https://lumentee.com/careers/frontend/#', 'j')];
    expect(() => selectAnchorDuplicates(other, { ...spec, duplicateUrls: [...spec.duplicateUrls.slice(0, 3), 'https://lumentee.com/careers/frontend/#'] })).toThrow('Not an anchor');
    const retitled = rows.map((r) => r.url.endsWith('#main') ? { ...r, title: 'Frontend Engineer' } : r);
    expect(() => selectAnchorDuplicates(retitled, spec)).toThrow('Different title');
  });
  it('refuse un compte relu qui a changé, et l’absence de la représentation gardée', () => {
    expect(() => selectAnchorDuplicates(rows.slice(0, 4), spec)).toThrow('Reviewed count changed: 3');
    expect(() => selectAnchorDuplicates(rows.slice(1), spec)).toThrow('kept representation');
  });
});
