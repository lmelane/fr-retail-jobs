import { describe, expect, it } from 'vitest';
import { readEducation } from './education.js';
import { readWorkplace } from './workplace.js';
import { readLocations } from './locations.js';
import { readSourceFacts, projectSourceFacts } from './index.js';
import { publicSourceFacts } from '@catwalks/db/source-facts';

describe('source-specific facts', () => {
  it('distinguishes missing education, no diploma and application-form requirements', () => {
    expect(readEducation('wttj', {}).status).toBe('NOT_OBSERVED');
    expect(readEducation('wttj', { education_level: 'no_diploma' }).value).toEqual({ referential: 'WTTJ', requirements: ['no_diploma'], noDiplomaRequired: true });
    expect(readEducation('recruitee', { education_code: 'vocational' }).value?.requirements).toEqual(['vocational']);
    expect(readEducation('greenhouse', { education: 'education_required' }).value).toBeNull();
  });
  it('keeps all Recruitee choices and never interprets false remote as on-site', () => {
    expect(readWorkplace('recruitee', { remote: false, hybrid: true, on_site: false }).value?.modes).toEqual(['HYBRID']);
    expect(readWorkplace('recruitee', { remote: true, hybrid: true, on_site: true }).value?.modes).toEqual(['ONSITE','HYBRID','REMOTE']);
    expect(readWorkplace('workable', { telecommuting: false }).value).toBeNull();
    expect(readWorkplace('wttj', { remote: 'no', has_remote: true }).value?.modes).toEqual(['ONSITE']);
  });
  it('handles explicit negative labels, conflicting flags and unknown proprietary codes', () => {
    expect(readWorkplace('lever', { workplaceType: 'No remote' }).value?.modes).toEqual(['ONSITE']);
    expect(readWorkplace('ashby', { workplaceType: 'OnSite', isRemote: true }).status).toBe('CONFLICT');
    expect(readWorkplace('talentview', { detail: { remote_level: 999 } }).status).toBe('UNINTERPRETED');
    expect(readWorkplace('talentview', { detail: { remote_level: 1 } }).value?.modes).toEqual(['OCCASIONAL_REMOTE']);
    expect(readWorkplace('talentview', { detail: { remote_level: 0 } }).value?.modes).toEqual(['ONSITE']);
    expect(readWorkplace('wttj', { remote: 'punctual' }).value?.modes).toEqual(['OCCASIONAL_REMOTE']);
  });
  it('never derives workplace from incidental text or related postings', () => {
    for (const text of ['This role is not a remote position', 'hybrid cloud engineering', 'manage remote teams']) {
      expect(readWorkplace('recruitee', { description: text, similarJobs: [{ remote: true }] }).value).toBeNull();
    }
  });
  it('retains every native location, including repeated city names in different countries', () => {
    const raw = { locations: [{ city: 'Paris', country_code: 'FR', postal_code: '75008' }, { city: 'Paris', country_code: 'US', postal_code: '75460' }] };
    const facts = readSourceFacts('recruitee', raw);
    expect(facts.locations.value?.map(location => [location.city, location.country, location.postalCode])).toEqual([['Paris','FR','75008'],['Paris','US','75460']]);
    expect(projectSourceFacts(facts).postalCode).toBeUndefined();
    expect(facts.locations.evidence).toContainEqual({ path: '/locations/1/country_code', value: 'US' });
  });
  it('validates coordinate pairs without losing a valid zero latitude', () => {
    expect(readLocations('jibe', { latitude: '0', longitude: '23.5' }).value?.[0]).toMatchObject({ latitude: 0, longitude: 23.5, coordinateStatus: 'DECLARED' });
    for (const [latitude, longitude] of [['', 20], [null, 20], [91, 30], [48, 181], [48, undefined]]) {
      expect(readLocations('jibe', { latitude, longitude }).value?.[0]).toMatchObject({ latitude: null, longitude: null, coordinateStatus: 'INVALID' });
    }
    expect(readLocations('jibe', { latitude: 0, longitude: 0 }).value?.[0].coordinateStatus).toBe('UNINTERPRETED');
  });
  it('qualifies coordinate order per source and does not blend different locations', () => {
    expect(readLocations('magnet', { localities: [{ coordinates: '48.8,2.3' }, { coordinates: '45,4' }] }).value?.map(location => [location.latitude, location.longitude])).toEqual([[48.8,2.3],[45,4]]);
    expect(readLocations('talentfunnel', { vacancy: { location: { geoLocation: { coordinates: [[2.3,48.8]] } } } }).value?.[0]).toMatchObject({ latitude: 48.8, longitude: 2.3 });
    expect(readLocations('generic-listing', { jobLocation: [{ name: 'A', geo: { latitude: 48 } }, { name: 'B', geo: { longitude: 2 } }] }).value?.every(location => location.latitude === null && location.longitude === null)).toBe(true);
    expect(readLocations('generic-listing', { jobLocation: { latitude: 48, longitude: 2, address: { addressCountry: { name: 'France' } } } }).value?.[0]).toMatchObject({ latitude: 48, longitude: 2, country: 'France' });
  });
  it('honours location visibility and reads only this posting', () => {
    expect(readLocations('flatchr', { vacancy: { show_address: false, address: { location_lat: 48, location_lng: 2 } } }).status).toBe('WITHHELD_BY_SOURCE');
    expect(readLocations('generic-listing', { similarJobs: [{ jobLocation: { geo: { latitude: 48, longitude: 2 } } }] }).value).toBeNull();
    expect(readLocations('workable', { locations: [{ hidden: true, city: 'Paris', countryCode: 'FR' }] }).status).toBe('WITHHELD_BY_SOURCE');
    expect(readLocations('phenom', { multi_location_array: [{ location: 'Paris', latlong: { lat: 48.8, lon: 2.3 } }] }).value?.[0]).toMatchObject({ latitude: 48.8, longitude: 2.3 });
  });
  it('exposes exact salary strings and status without RAW evidence', () => {
    const facts = readSourceFacts('lever', { salaryRange: { min: 12.31, max: 20.8, currency: 'EUR', interval: 'per-hour-wage' } });
    const output = publicSourceFacts(facts);
    expect(output?.salary.value?.bands[0].min).toBe('12.31');
    expect(output?.salary).not.toHaveProperty('evidence'); expect(output).not.toHaveProperty('inputHash');
    expect(publicSourceFacts({ ...facts, version: 'old' })).toBeNull();
    const invalidAmount = structuredClone(facts); invalidAmount.salary.value!.bands[0].min = 'NaN';
    expect(publicSourceFacts(invalidAmount)).toBeNull();
    expect(publicSourceFacts({ ...facts, locations: { status: 'DECLARED', value: {}, issues: [] } })).toBeNull();
    expect(publicSourceFacts({ ...facts, salary: { status: 'UNKNOWN', value: null, issues: [] } })).toBeNull();
    for (const value of [false, 0, '', [], undefined]) {
      expect(publicSourceFacts({ ...facts, salary: { status: 'DECLARED', value, issues: [] } })).toBeNull();
    }
    const withExtras = structuredClone(facts);
    Object.assign(withExtras.salary.value!, { raw: 'private payload' });
    Object.assign(withExtras.salary.value!.bands[0], { evidence: 'private payload' });
    expect(JSON.stringify(publicSourceFacts(withExtras))).not.toContain('private payload');
  });
});
