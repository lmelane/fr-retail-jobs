import { describe, expect, it } from 'vitest';
import { declaredExpiry, parseDeclaredDeadline } from './expiry.js';

describe('declared source expiry', () => {
  it.each([
    ['jibe', { posting_expiry_date: '2026-09-12T17:00:00+0000' }, '2026-09-12T17:00:00.000Z'],
    ['altamira', { postingEvidence: { jobPosting: { validThrough: '2026-09-12T17:00:00Z' } } }, '2026-09-12T17:00:00.000Z'],
    ['harri', { detail: { end_date: 'Sun, 13 Sep 2026 23:59:59 GMT' } }, '2026-09-13T23:59:59.000Z'],
    ['talentrecruiter', { position: { ApplicationDue: '/Date(1790805599000+0200)/' } }, '2026-09-30T21:59:59.000Z'],
  ])('preserves the explicit source instant: %s', (kind, raw, expected) => {
    const fact = declaredExpiry(kind as string, raw)!;
    expect(fact).toBeDefined();
    expect(fact.expiresAt?.toISOString()).toBe(expected);
    expect(fact.evidence).toMatchObject({ precision: 'INSTANT', policy: 'SOURCE_INSTANT' });
    expect(fact.evidence.rawHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('keeps a date-only posting through its entire declared day without inventing a time zone', () => {
    const fact = declaredExpiry('workday', { detail: { jobPostingInfo: { endDate: '2026-09-18' } } })!;
    expect(fact.expiresAt?.toISOString()).toBe('2026-09-19T12:00:00.000Z');
    expect(fact.evidence).toMatchObject({ path: '$.detail.jobPostingInfo.endDate', value: '2026-09-18', precision: 'DATE' });
  });
  it('retains 9999-12-31 with an explicit storage-range status', () => {
    expect(declaredExpiry('talentfunnel', { vacancy: { validTo: '9999-12-31' } })).toMatchObject({
      expiresAt: null, evidence: { value: '9999-12-31', status: 'BEYOND_STORAGE_RANGE', precision: 'DATE' },
    });
  });
  it('does not take a deadline from a related job or a different adapter shape', () => {
    expect(declaredExpiry('workday', { detail: { similarJobs: [{ endDate: '2026-09-01' }] } })).toBeUndefined();
    expect(declaredExpiry('unknown', { end_date: '2026-09-01T12:00:00Z' })).toBeUndefined();
  });
  it.each(['2026-02-30', '2026-02-30T00:00:00Z', '2026-09-18T12:00:00', '18/09/2026', '0', 'not a date'])('does not guess an invalid or unzoned deadline: %s', value => {
    expect(parseDeclaredDeadline(value)).toBeUndefined();
  });
});
