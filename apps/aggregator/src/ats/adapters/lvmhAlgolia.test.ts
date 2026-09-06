import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));

import { fetchJson } from '../../lib/http.js';
import { fetchLvmhJobs, lvmhLanguage } from './lvmhAlgolia.js';

const mockJson = vi.mocked(fetchJson);
beforeEach(() => mockJson.mockReset());

/** Un hit Algolia réel (2026-09-06), blocs de texte tronqués. */
const HIT = JSON.parse(readFileSync(new URL('./__fixtures__/l2-lvmh-hit.json', import.meta.url), 'utf8'));

/**
 * l2 (2026-09-06) — mesuré sur l'index entier : `publicationTimestamp` présent sur
 * 5 490/5 490 hits (nombre, secondes) et `language` sur 5 490/5 490 (EN 3 502,
 * FR 1 051, ZH-HANS 570, IT 211…). La date était déjà mappée ; la langue jamais.
 */
describe('lvmhLanguage', () => {
  it('rend le code ISO-639-1 en minuscules, sans script ni région', () => {
    expect(lvmhLanguage('EN')).toBe('en');
    expect(lvmhLanguage('ZH-HANS')).toBe('zh');
    expect(lvmhLanguage('fr')).toBe('fr');
  });
  it('corrige le « SP » maison en espagnol et refuse le vide', () => {
    expect(lvmhLanguage('SP')).toBe('es');
    expect(lvmhLanguage(undefined)).toBeUndefined();
    expect(lvmhLanguage('')).toBeUndefined();
  });
});

describe('fetchLvmhJobs — l2 : date et langue du hit', () => {
  it('mappe publicationTimestamp (secondes) en postedAt et language en ISO', async () => {
    mockJson.mockResolvedValueOnce({ hits: [HIT], nbHits: 1 } as never);
    const { jobs } = await fetchLvmhJobs({ country: null });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].postedAt?.getTime()).toBe(Number(HIT.publicationTimestamp) * 1000);
    expect(jobs[0].language).toBe(String(HIT.language).toLowerCase().split('-')[0]);
    expect(jobs[0].company).toBe(HIT.maison);
  });
});
