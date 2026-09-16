import { describe, expect, it } from 'vitest';
import { dayBounds, formatDay, parseDay } from './snapshot.js';

/** Les clés composées et les bornes de jour : le découpage que le web relira pour la carte. */
describe('snapshot days', () => {
  it('parse un jour ISO en minuit UTC', () => {
    expect(parseDay('2026-09-06').toISOString()).toBe('2026-09-06T00:00:00.000Z');
  });

  it('refuse un format ambigu ou une date qui n’existe pas', () => {
    expect(() => parseDay('06/09/2026')).toThrow(/YYYY-MM-DD/);
    expect(() => parseDay('2026-02-30')).toThrow(/calendar/);
    expect(() => parseDay('2026-9-6')).toThrow();
  });

  it('borne le jour UTC d’un instant quelconque : minuit inclus, minuit suivant exclu', () => {
    const { day, start, end } = dayBounds(new Date('2026-09-06T23:59:59.999Z'));
    expect(day.toISOString()).toBe('2026-09-06T00:00:00.000Z');
    expect(start).toEqual(day);
    expect(end.toISOString()).toBe('2026-09-07T00:00:00.000Z');
    expect(formatDay(day)).toBe('2026-09-06');
  });
});
