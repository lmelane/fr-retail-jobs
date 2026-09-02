import { describe, it, expect, vi, afterEach } from 'vitest';
import { geoCacheKey, geocodeLocation } from './geocode.js';

/**
 * Behaviour these tests pin down (BDD):
 *  - one commune must resolve to ONE cache key, whatever spelling a source used,
 *    or the same town is geocoded twice and the rate budget is wasted (G-1);
 *  - the `city` we store must be a town name, never the full postal label the
 *    API echoes back ("12 Rue X 75008 Paris") (G-2).
 * Network is mocked: only the pure key logic and the response mapping are tested.
 */

describe('geoCacheKey — one commune, one key (G-1)', () => {
  it('keys "Paris 08" and "75008 Paris" identically', () => {
    // Both name the same commune; the old code produced "PARIS" vs "75|PARIS".
    expect(geoCacheKey('Paris 08')).toBe(geoCacheKey('75008 Paris'));
  });

  it('keys every Paris spelling to the same value', () => {
    const keys = new Set([
      geoCacheKey('Paris 08'),
      geoCacheKey('75008 Paris'),
      geoCacheKey('Paris, Ile-de-France'),
      geoCacheKey('Paris 8e'),
      geoCacheKey('PARIS CEDEX 08'),
    ]);
    expect(keys.size).toBe(1);
  });

  it('aligns its department with normalizeLocationString', () => {
    // A "75 - Paris" prefix yields department 75 in the normalizer; the key must
    // agree so the entry lands with the postcode-spelled one.
    expect(geoCacheKey('75 - Paris')).toBe(geoCacheKey('75008 Paris'));
  });

  it('still separates true homonyms by department', () => {
    // Saint-Germain-en-Laye (78) and a Saint-Germain in 86 must not collide.
    expect(geoCacheKey('78100 Saint-Germain-en-Laye')).not.toBe(
      geoCacheKey('86310 Saint-Germain'),
    );
  });

  it('is stable and non-empty for a bare city', () => {
    expect(geoCacheKey('Bordeaux')).toBe('BORDEAUX');
  });
});

describe('geocodeLocation — city never falls back to the full label (G-2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchOnce(feature: unknown): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ features: [feature] }),
      })),
    );
  }

  it('does not use `label` as the city when `city` is absent', async () => {
    // A feature with no `city`, only the full postal `label`. The old mapping
    // stored the whole address as the city.
    mockFetchOnce({
      geometry: { coordinates: [2.3, 48.87] },
      properties: {
        label: '12 Rue de la Paix 75008 Paris',
        municipality: 'Paris',
        postcode: '75008',
        citycode: '75108',
        score: 0.9,
      },
    });

    const point = await geocodeLocation('12 rue de la Paix 75008 Paris');
    expect(point).not.toBeNull();
    expect(point?.city).toBe('Paris');
    expect(point?.city).not.toContain('Rue');
  });

  it('falls back to `name` when neither `city` nor `municipality` is present', async () => {
    mockFetchOnce({
      geometry: { coordinates: [0, 47] },
      properties: {
        label: 'Somewhere 12345 Someplace',
        name: 'Someplace',
        postcode: '12345',
        score: 0.9,
      },
    });

    const point = await geocodeLocation('Someplace 12345');
    expect(point?.city).toBe('Someplace');
  });

  it('leaves city undefined rather than storing the label', async () => {
    mockFetchOnce({
      geometry: { coordinates: [1, 46] },
      properties: {
        label: 'Full Postal Label Only',
        postcode: '33000',
        score: 0.9,
      },
    });

    const point = await geocodeLocation('Bordeaux 33000');
    expect(point?.city).toBeUndefined();
  });

  it('prefers `city` when the API provides it', async () => {
    mockFetchOnce({
      geometry: { coordinates: [-0.57, 44.84] },
      properties: {
        label: 'Bordeaux 33000 Bordeaux',
        city: 'Bordeaux',
        municipality: 'Something Else',
        postcode: '33000',
        citycode: '33063',
        score: 0.95,
      },
    });

    const point = await geocodeLocation('Bordeaux 33000');
    expect(point?.city).toBe('Bordeaux');
  });
});
