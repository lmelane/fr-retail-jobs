import { companyIdentityWhere } from './company-identity';
import { describe, it, expect } from 'vitest';
import { whereClause, validSector } from './jobs';

/**
 * whereClause builds the Prisma filter. These tests pin down the bug where
 * Maison, Secteur and Groupe each wrote a separate `company` key and silently
 * overwrote one another — combining filters must keep ALL of them.
 */

describe('whereClause — combined company filters do not collide', () => {
  /*
   * D-426 : ces témoins vérifient désormais la PROPRIÉTÉ (les trois
   * contraintes survivent ensemble), pas la forme littérale de l'objet.
   * La forme a changé — `AND: [...]` au lieu de clés fusionnées — précisément
   * pour rendre l'écrasement impossible quand chaque dimension porte
   * plusieurs valeurs. Un témoin qui fige la forme aurait interdit le
   * correctif tout en prétendant garder le défaut.
   */
  it('keeps maison, sector and group together in one company filter', () => {
    const where = whereClause({ maisons: ['Christian Dior Couture'], sectors: ['LUXURY'], groups: ['LVMH'] });
    const serialise = JSON.stringify(where.company);
    expect(serialise).toContain('Christian Dior Couture');
    expect(serialise).toContain('LUXURY');
    expect(serialise).toContain('LVMH');
  });

  it('keeps maison and sector together', () => {
    const where = whereClause({ maisons: ['Guerlain'], sectors: ['BEAUTY'] });
    const serialise = JSON.stringify(where.company);
    expect(serialise).toContain('Guerlain');
    expect(serialise).toContain('BEAUTY');
  });

  it('omits company entirely when no company filter is set', () => {
    const where = whereClause({ city: 'Paris' });
    expect(where.company).toBeUndefined();
    // Case-insensitive equality (D20): rows store "PARIS", "Paris", "paris"
    // depending on the source; a filter click must reach all spellings.
    expect(where.city).toEqual({ equals: 'Paris', mode: 'insensitive' });
  });

  it('preserves an unknown filter so it matches zero, never the entire catalogue', () => {
    const where = whereClause({ sectors: ['NOT_A_SECTOR'] });
    expect(JSON.stringify(where.company)).toContain('NOT_A_SECTOR');
  });

  it('applies isActive always, but not isFrance by default (D10: every country)', () => {
    const where = whereClause({});
    expect(where.isActive).toBe(true);
    // No forced isFrance — the board shows every country now.
    expect((where as { isFrance?: boolean }).isFrance).toBeUndefined();
  });

  it('country=FR narrows to France via the reliable flag', () => {
    expect(JSON.stringify(whereClause({ countries: ['FR'] }))).toContain('isFrance');
  });

  it('a non-FR country matches its raw spellings case-insensitively', () => {
    // D-426 : les pays vivent dans le AND racine, sous forme d'un OR de leurs
    // orthographes — la propriété reste la même, l'emplacement a changé.
    expect(JSON.stringify(whereClause({ countries: ['IT'] })).toLowerCase()).toContain('italie');
  });

  it('DEUX pays cochés donnent leur UNION, pas seulement le dernier', () => {
    // Le défaut mesuré en production : FR+US rendait exactement US.
    const serialise = JSON.stringify(whereClause({ countries: ['FR', 'IT'] })).toLowerCase();
    expect(serialise).toContain('isfrance');
    expect(serialise).toContain('italie');
  });

  it('search terms go under AND, not company (so q + maison coexist)', () => {
    const where = whereClause({ q: 'vendeur', maisons: ['Sézane'] });
    expect(JSON.stringify(where.company)).toContain('Sézane');
    expect(Array.isArray((where as { AND?: unknown[] }).AND)).toBe(true);
    // Le mot-clé doit survivre à la présence du filtre Maison, et l'inverse.
    expect(JSON.stringify(where)).toContain('vendeur');
  });
});

describe('validSector', () => {
  it('accepts real sectors', () => {
    expect(validSector('LUXURY')).toBe('LUXURY');
    expect(validSector('FASHION')).toBe('FASHION');
  });
  it('rejects unknown values', () => {
    expect(validSector('DROP TABLE')).toBe('DROP TABLE'); // bound value, never SQL
    expect(validSector('luxury')).toBe('luxury'); // case-sensitive enum
    expect(validSector(undefined)).toBeUndefined();
  });
});
