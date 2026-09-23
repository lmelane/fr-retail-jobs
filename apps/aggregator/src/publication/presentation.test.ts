import { describe, expect, it } from 'vitest';
import { publicationContentOf } from '@catwalks/db/publication-presentation';
import { BOOTSTRAP_TAXONOMY } from '../normalize/taxonomy.js';
import { readSourceFacts, projectSourceFacts } from '../facts/index.js';
import { publicationJobContent } from './content.js';
import { publicationPresentation } from './presentation.js';

function fixture() {
  const raw = { title: 'Sales Advisor', description: 'Publication text',
    baseSalary: { currency: 'EUR', value: { minValue: 12.31, unitText: 'HOUR' } } };
  const facts = readSourceFacts('GENERIC_JSONLD', raw);
  const candidate = { sourceKey: 'presentation-fixture', externalId: '1', sourceTier: 'EMPLOYER_DIRECT' as const,
    company: 'Fixture', title: raw.title, description: raw.description, url: 'https://example.com/job/1',
    postedAt: new Date('2026-09-01'), raw, sourceFacts: facts, ...projectSourceFacts(facts) };
  const presentation = publicationPresentation(candidate, publicationJobContent(candidate, BOOTSTRAP_TAXONOMY));
  return { ...candidate, presentation };
}

describe('one publication presentation', () => {
  it('preserves native fractional experience without rounding it to a year', () => {
    const candidate = { ...fixture(), experienceYears: 0.5 };
    const presentation = publicationPresentation(candidate, publicationJobContent(candidate, BOOTSTRAP_TAXONOMY));
    expect(publicationContentOf({ ...candidate, presentation })?.experienceYears).toBe(0.5);
  });
  it('hydrates dates and exact amounts while retaining absent optional fields', () => {
    const content = publicationContentOf(fixture());
    expect(content).toMatchObject({ title: 'Sales Advisor', description: 'Publication text', countryCode: null,
      postedAt: new Date('2026-09-01'), salaryCurrency: 'EUR', salaryPeriod: 'HOUR' });
    expect(content?.salaryMin?.toString()).toBe('12.31');
  });
  it.each(['sourceKey', 'externalId', 'url', 'captureBatchId', 'captureOutputId'])('rejects a different %s', key => {
    const source = fixture();
    expect(publicationContentOf({ ...source, [key]: 'different' })).toBeNull();
  });
  it.each([
    ['title', null], ['title', ''], ['source', 'INVENTED'], ['postedAt', '2026-02-31'],
    ['salaryMin', '12.1234567'], ['salaryMin', 12.31], ['experienceYears', 1e15],
    ['experienceYears', Infinity], ['experienceYears', NaN], ['latitude', 'north'],
  ])('rejects malformed %s content', (key, value) => {
    const source = fixture(), cache = JSON.parse(JSON.stringify(source.presentation));
    cache.values[key] = value;
    expect(publicationContentOf({ ...source, presentation: cache })).toBeNull();
  });
  it('rejects mismatched RAW facts and an unknown projection version', () => {
    const source = fixture();
    expect(publicationContentOf({ ...source, sourceFacts: { ...source.sourceFacts, inputHash: '0'.repeat(64) } })).toBeNull();
    expect(publicationContentOf({ ...source, presentation: { ...source.presentation as object, version: 'future' } })).toBeNull();
  });
  it.each(['javascript:alert(1)', 'https://user:secret@example.com/job/1', '/job/1'])('rejects an unsafe application URL: %s', url => {
    const source = fixture(), cache = JSON.parse(JSON.stringify(source.presentation));
    cache.url = url; cache.values.url = url;
    expect(publicationContentOf({ ...source, url, presentation: cache })).toBeNull();
  });
  it('never spreads private or mutation fields from a cache into the projection', () => {
    const source = fixture(), cache = JSON.parse(JSON.stringify(source.presentation));
    cache.values.company = { delete: true }; cache.values.isActive = true; cache.values.privateSecret = 'private';
    const result = publicationContentOf({ ...source, presentation: cache });
    expect(result).not.toHaveProperty('company'); expect(result).not.toHaveProperty('isActive'); expect(result).not.toHaveProperty('privateSecret');
  });
});
