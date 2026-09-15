import { describe, expect, it } from 'vitest';
import { briefError, cleanTitle, cleanPlace, plausiblePostedAt } from './normalize.js';

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

});
