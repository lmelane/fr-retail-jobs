import { describe, expect, it } from 'vitest';
import { coerceAmount, coerceCoordinate, coerceText, briefError, cleanTitle, cleanPlace, plausiblePostedAt, canonicalPeriod, boundedSalary } from './normalize.js';

/**
 * A salary column is Int?, but a schema.org feed (Teamtailor, medik8) hands the
 * amount over as a STRING ("75000"). Written through unchanged, it crashed the
 * whole job.create — the offer was lost. coerceAmount turns any incoming shape
 * into a positive number or undefined, at the boundary, for every source.
 */
describe('coerceAmount', () => {
  it('parses a numeric string to a number', () => {
    expect(coerceAmount('75000')).toBe(75000);
    expect(coerceAmount('85000.5')).toBe(85000.5);
  });

  it('passes a real number through', () => {
    expect(coerceAmount(75000)).toBe(75000);
  });

  it('returns undefined for anything not a positive amount', () => {
    expect(coerceAmount(undefined)).toBeUndefined();
    expect(coerceAmount(null)).toBeUndefined();
    expect(coerceAmount('')).toBeUndefined();
    expect(coerceAmount('not a number')).toBeUndefined();
    expect(coerceAmount(0)).toBeUndefined();
    expect(coerceAmount(-100)).toBeUndefined();
    expect(coerceAmount(NaN)).toBeUndefined();
    expect(coerceAmount({})).toBeUndefined();
  });

  it('strips grouping and currency noise a feed may include', () => {
    expect(coerceAmount('75 000')).toBe(75000);
    expect(coerceAmount('€75,000')).toBe(75000);
  });
});

describe('coerceText', () => {
  it('keeps a non-empty string', () => {
    expect(coerceText('EUR')).toBe('EUR');
    expect(coerceText('  GBP ')).toBe('GBP');
  });

  it('turns a number into its text (TalentView currency id)', () => {
    expect(coerceText(1)).toBe('1');
  });

  it('drops empty, null and non-scalar values', () => {
    expect(coerceText('')).toBeUndefined();
    expect(coerceText('   ')).toBeUndefined();
    expect(coerceText(undefined)).toBeUndefined();
    expect(coerceText(null)).toBeUndefined();
    expect(coerceText({})).toBeUndefined();
    expect(coerceText(NaN)).toBeUndefined();
  });
});

describe('briefError', () => {
  it('keeps a short message as-is', () => {
    expect(briefError(new Error('Teamtailor origin missing'))).toBe('Teamtailor origin missing');
  });

  it('collapses a multi-line Prisma dump to the first line plus the reason', () => {
    const prismaError = new Error(
      'Invalid `prisma.job.create()` invocation in\n' +
        '/repo/apps/aggregator/src/dedup/upsert.ts:164:36\n' +
        '            salaryMin: "75000",\n' +
        '            (… 80 more lines of the job payload …)\n' +
        'Unique constraint failed on the fields: (`sourceKey`,`externalId`)',
    );
    const brief = briefError(prismaError);
    expect(brief).toContain('Invalid');
    expect(brief).toContain('Unique constraint failed');
    expect(brief).not.toContain('salaryMin');
    // One line, bounded — never the 80-line dump that flooded the log stream.
    expect(brief.split('\n')).toHaveLength(1);
    expect(brief.length).toBeLessThanOrEqual(200);
  });

  it('bounds an overlong single line', () => {
    const brief = briefError(new Error('x'.repeat(500)));
    expect(brief.length).toBeLessThanOrEqual(200);
  });

  it('handles a non-Error value', () => {
    expect(briefError('plain string failure')).toBe('plain string failure');
  });

  it('picks the real argument error over a payload field named like an error', () => {
    // The live TalentView failure: the dump carried `is_required: true` payload
    // lines that hid the true reason further down.
    const err = new Error(
      'Invalid `prisma.job.create()` invocation in\n' +
        '            is_required: true,\n' +
        '            is_required: true,\n' +
        '            title: "Vendeur",\n' +
        'Argument `salaryCurrency`: Invalid value provided. Expected String or Null, provided Int.',
    );
    const brief = briefError(err);
    expect(brief).toContain('salaryCurrency');
    expect(brief).toContain('Expected String');
    expect(brief).not.toContain('is_required');
  });
});

/**
 * Mesuré en prod le 2026-09-06 : Rituals sert la latitude en chaîne
 * ("52.37") ; écrite telle quelle dans une colonne Float, 577 offres sur
 * 1 088 étaient refusées. La frontière coerce, l'adaptateur ne peut plus fuir.
 */
describe('coerceCoordinate', () => {
  it('accepte un nombre ou une chaîne numérique', () => {
    expect(coerceCoordinate(52.37, 90)).toBe(52.37);
    expect(coerceCoordinate('52.37', 90)).toBe(52.37);
    expect(coerceCoordinate(' -1.5 ', 180)).toBe(-1.5);
  });

  it('refuse le vide, le texte et le hors-plage', () => {
    expect(coerceCoordinate('', 90)).toBeUndefined();
    expect(coerceCoordinate('Paris', 90)).toBeUndefined();
    expect(coerceCoordinate(undefined, 90)).toBeUndefined();
    expect(coerceCoordinate(95, 90)).toBeUndefined();
    expect(coerceCoordinate('200', 180)).toBeUndefined();
  });
});

describe('nettoyeurs de frontière (audit A1, 2026-09-06)', () => {
  it('cleanTitle décode les entités, retire les balises, replie les espaces', () => {
    expect(cleanTitle('  Sales &amp;amp; Marketing   Manager <b>H/F</b> ')).toBe('Sales & Marketing Manager H/F');
    expect(cleanTitle('')).toBeUndefined();
  });

  it('cleanPlace refuse un fragment de balise ou de script', () => {
    expect(cleanPlace('/a>')).toBeUndefined();
    expect(cleanPlace('var socialShareButtons = 1')).toBeUndefined();
    expect(cleanPlace(' Paris ,  France ')).toBe('Paris , France');
  });

  it('plausiblePostedAt refuse le futur et l’invalide', () => {
    const now = new Date('2026-09-06T12:00:00Z');
    expect(plausiblePostedAt(new Date('2028-03-08'), now)).toBeUndefined();
    expect(plausiblePostedAt(new Date('invalid'), now)).toBeUndefined();
    expect(plausiblePostedAt(new Date('2026-09-05'), now)?.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });

  it('canonicalPeriod ne stocke que des valeurs du référentiel', () => {
    expect(canonicalPeriod('yearly')).toBe('YEAR');
    expect(canonicalPeriod('par mois')).toBeUndefined();
    expect(canonicalPeriod('mois')).toBe('MONTH');
  });

  it('boundedSalary écarte 58 M€/an mais garde 1 530 000 COP', () => {
    expect(boundedSalary(58_235_520, 66_554_880, 'EUR')).toEqual({ salaryMin: undefined, salaryMax: undefined });
    expect(boundedSalary(1_530_000, 2_000_000, 'COP')).toEqual({ salaryMin: 1_530_000, salaryMax: 2_000_000 });
    expect(boundedSalary(45_000, 55_000, 'EUR')).toEqual({ salaryMin: 45_000, salaryMax: 55_000 });
  });
});
