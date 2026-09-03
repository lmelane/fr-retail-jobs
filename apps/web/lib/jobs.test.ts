import { describe, it, expect } from 'vitest';
import { whereClause, validSector } from './jobs';

/**
 * whereClause builds the Prisma filter. These tests pin down the bug where
 * Maison, Secteur and Groupe each wrote a separate `company` key and silently
 * overwrote one another — combining filters must keep ALL of them.
 */

describe('whereClause — combined company filters do not collide', () => {
  it('keeps maison, sector and group together in one company filter', () => {
    const where = whereClause({ maison: 'Christian Dior Couture', sector: 'LUXURY', group: 'LVMH' });
    // A single company object carrying all three constraints.
    expect(where.company).toEqual({
      name: 'Christian Dior Couture',
      sector: 'LUXURY',
      parentGroup: 'LVMH',
    });
  });

  it('keeps maison and sector together', () => {
    const where = whereClause({ maison: 'Guerlain', sector: 'BEAUTY' });
    expect(where.company).toEqual({ name: 'Guerlain', sector: 'BEAUTY' });
  });

  it('omits company entirely when no company filter is set', () => {
    const where = whereClause({ city: 'Paris' });
    expect(where.company).toBeUndefined();
    // Case-insensitive equality (D20): rows store "PARIS", "Paris", "paris"
    // depending on the source; a filter click must reach all spellings.
    expect(where.city).toEqual({ equals: 'Paris', mode: 'insensitive' });
  });

  it('drops an invalid sector instead of passing it to the enum', () => {
    const where = whereClause({ sector: 'NOT_A_SECTOR' });
    // Invalid sector -> no company filter, no crash.
    expect(where.company).toBeUndefined();
  });

  it('applies isActive always, but not isFrance by default (D10: every country)', () => {
    const where = whereClause({});
    expect(where.isActive).toBe(true);
    // No forced isFrance — the board shows every country now.
    expect((where as { isFrance?: boolean }).isFrance).toBeUndefined();
  });

  it('country=FR narrows to France via the reliable flag', () => {
    const where = whereClause({ country: 'FR' });
    expect((where as { isFrance?: boolean }).isFrance).toBe(true);
  });

  it('a non-FR country matches its raw spellings case-insensitively', () => {
    const where = whereClause({ country: 'IT' });
    const or = (where as { OR?: { country?: { equals?: string } }[] }).OR;
    expect(Array.isArray(or)).toBe(true);
    expect(or!.some((c) => c.country?.equals?.toLowerCase() === 'italie')).toBe(true);
  });

  it('search terms go under AND, not company (so q + maison coexist)', () => {
    const where = whereClause({ q: 'vendeur', maison: 'Sézane' });
    expect(where.company).toEqual({ name: 'Sézane' });
    expect(Array.isArray((where as { AND?: unknown[] }).AND)).toBe(true);
  });
});

describe('validSector', () => {
  it('accepts real sectors', () => {
    expect(validSector('LUXURY')).toBe('LUXURY');
    expect(validSector('FASHION')).toBe('FASHION');
  });
  it('rejects unknown values', () => {
    expect(validSector('DROP TABLE')).toBeUndefined();
    expect(validSector('luxury')).toBeUndefined(); // case-sensitive enum
    expect(validSector(undefined)).toBeUndefined();
  });
});
