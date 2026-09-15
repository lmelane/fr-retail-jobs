import { describe, expect, it } from 'vitest';
import { readSalary } from './salary.js';

describe('salary facts from qualified native paths', () => {
  it('keeps a decimal tuple and its exact paths without requiring a currency', () => {
    const reading = readSalary('teamtailor', { _jobposting: { baseSalary: { currency: null, value: { minValue: '12.31', maxValue: '20.80', unitText: 'HOUR' } } } });
    expect(reading).toMatchObject({ status: 'DECLARED', value: { bands: [{ min: '12.31', max: '20.8', currency: null, period: 'HOUR' }] } });
    expect(reading.evidence).toContainEqual({ path: '/_jobposting/baseSalary/value/maxValue', value: '20.80' });
  });
  it('does not invent an iCIMS interval or confuse a missing interval with a missing salary', () => {
    const reading = readSalary('ICIMS', { postingEvidence: { jobPosting: { baseSalary: { minValue: 22.95, maxValue: 42.63, currency: 'USD' } } } });
    expect(reading).toMatchObject({ status: 'DECLARED', value: { bands: [{ min: '22.95', period: null, nativePeriod: null }] } });
  });
  it('preserves an unqualified Lever interval without guessing the annual amount', () => {
    const reading = readSalary('LEVER', { salaryRange: { min: 1300, max: 1700, currency: 'USD', interval: 'bi-week-salary' } });
    expect(reading.value?.bands[0]).toMatchObject({ min: '1300', max: '1700', period: null, nativePeriod: 'bi-week-salary' });
    expect(reading.issues).toContain('UNINTERPRETED_PERIOD');
  });
  it('uses the Magnet original amount and its original period, not the converted annual amount', () => {
    const reading = readSalary('MAGNET', { salary: { min: 28800, max: 29400, min_src: 2400, max_src: 2450, currency: 'EUR', definition: 'GROSS', periodicity: 'MONTH' } });
    expect(reading.value?.bands[0]).toMatchObject({ min: '2400', max: '2450', period: 'MONTH', basis: 'GROSS' });
  });
  it('respects Flatchr visibility and keeps the publisher interval code alongside its meaning', () => {
    const vacancy = { salary: 18.5, salary_max: 20.8, currency: 'EUR', mensuality: 'h', show_salary: false };
    expect(readSalary('FLATCHR', { vacancy })).toMatchObject({ status: 'WITHHELD_BY_SOURCE', value: null });
    expect(readSalary('FLATCHR', { vacancy: { ...vacancy, show_salary: true } }).value?.bands[0]).toMatchObject({ min: '18.5', nativePeriod: 'h', period: 'HOUR' });
  });
  it('distinguishes placeholders, textual conditions, invalid ranges and missing inputs', () => {
    expect(readSalary('JIBE', { salary_value: 0 })).toMatchObject({ status: 'NOT_OBSERVED', value: null, issues: ['ZERO_PLACEHOLDER'] });
    expect(readSalary('LVMH_ALGOLIA', { salary: { min: 'To be negotiated' } }).value).toEqual({ bands: [], terms: ['To be negotiated'] });
    expect(readSalary('RECRUITEE', { salary: { min: 30, max: 20 } }).status).toBe('CONFLICT');
    expect(readSalary('RECRUITEE', { salary: { min: 0.1234567 } }).status).toBe('INVALID');
    expect(readSalary('RECRUITEE', null).status).toBe('INPUT_MISSING');
    expect(readSalary('RECRUITEE', {}).status).toBe('NOT_OBSERVED');
  });
  it('keeps Ashby salary tiers separately and never reads equity or bonus values as salary', () => {
    const raw = { compensation: { compensationTiers: [
      { title: 'Zone A', components: [{ compensationType: 'EquityPercentage', minValue: 0.5, maxValue: 1.75 }, { compensationType: 'Salary', minValue: 81000, maxValue: 87000, currencyCode: 'USD', interval: '1 YEAR' }] },
      { title: 'Zone B', components: [{ compensationType: 'Bonus', minValue: 10000 }, { compensationType: 'Salary', minValue: 71000, maxValue: 77000, currencyCode: 'USD', interval: '1 YEAR' }] },
    ] } };
    const reading = readSalary('ASHBY', raw);
    expect(reading.value?.bands).toHaveLength(2);
    expect(reading.value?.bands.map(band => [band.label, band.min])).toEqual([['Zone A', '81000'], ['Zone B', '71000']]);
    expect(reading.evidence).toContainEqual({ path: '/compensation/compensationTiers/1/components/1/minValue', value: 71000 });
    expect(readSalary('ASHBY', { ...raw, shouldDisplayCompensationOnJobPostings: false }).status).toBe('WITHHELD_BY_SOURCE');
  });
  it('does not borrow amounts from related postings or supply a reader for an unknown source shape', () => {
    expect(readSalary('GENERIC_JSONLD', { similarJobs: [{ baseSalary: { value: { minValue: 80000 } } }] }).value).toBeNull();
    expect(readSalary('FUTURE_ATS', { salary: { min: 80000 } }).status).toBe('UNINTERPRETED');
  });
});
