import { describe, expect, it } from 'vitest';
import { compositeKey, dayBounds, formatDay, parseDay, splitCompositeKey, KEY_SEPARATOR } from './snapshot.js';

/** Les clés composées et les bornes de jour : le découpage que le web relira pour la carte. */
describe('snapshot keys', () => {
  it('compose et découpe une clé pays|ville', () => {
    expect(compositeKey('FR', 'Paris')).toBe('FR|Paris');
    expect(splitCompositeKey('FR|Paris')).toEqual(['FR', 'Paris']);
    expect(splitCompositeKey(compositeKey('IT', 'retail-client-advisor'))).toEqual(['IT', 'retail-client-advisor']);
    expect(KEY_SEPARATOR).toBe('|');
  });

  it('une ville qui porte le séparateur reste découpable en tête', () => {
    const [country, ...rest] = splitCompositeKey('FR|Saint|Denis');
    expect(country).toBe('FR');
    expect(rest.join(KEY_SEPARATOR)).toBe('Saint|Denis');
  });
});

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
