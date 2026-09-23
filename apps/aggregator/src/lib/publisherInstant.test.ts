import { describe, it, expect } from 'vitest';
import { publisherInstant } from './publisherInstant.js';

describe('explicit publisher instants', () => {
  it.each([
    ['2024-02-29T23:30:01+02:00', '2024-02-29T21:30:01.000Z'],
    ['2024-02-29T23:30:01.123-0230', '2024-03-01T02:00:01.123Z'],
  ])('preserves the actual timezone: %s', (input, expected) => {
    expect(publisherInstant(input)?.toISOString()).toBe(expected);
  });
  it.each([null, 0, '', '2026-02-29T12:00:00Z', '2026-04-31T12:00:00Z',
    '2026-09-15T24:00:00Z', '2026-09-15T12:60:00Z', '2026-09-15T12:00:00',
    '2026-09-15', 'yesterday', '2026-09-15T12:00:00+24:00', '0000-01-01T00:00:00Z'])
    ('withholds invalid or unzoned timestamps: %s', input => {
      expect(publisherInstant(input)).toBeUndefined();
    });
});

import { publisherDate } from './publisherInstant.js';
it('reads a publisher calendar date identically across machine timezones', () => {
  const before = process.env.TZ;
  try {
    for (const tz of ['UTC', 'Europe/Paris', 'America/New_York']) {
      process.env.TZ = tz;
      expect(publisherDate('2026-09-15T00:00:00')?.toISOString()).toBe('2026-09-15T00:00:00.000Z');
      expect(publisherDate('2026-09-15')?.toISOString()).toBe('2026-09-15T00:00:00.000Z');
      expect(publisherDate('2026-09-15T00:00:00-04:00')?.toISOString()).toBe('2026-09-15T04:00:00.000Z');
      expect(publisherDate('2026-02-31')).toBeUndefined();
    }
  } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});
