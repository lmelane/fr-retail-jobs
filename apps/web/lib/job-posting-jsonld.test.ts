import { describe, expect, test } from 'vitest';
import { buildJobPostingJsonLd } from './job-posting-jsonld';
import type { JobRow } from './jobs';

/**
 * addressCountry must be the offer's REAL country (ISO 3166-1 alpha-2), never a
 * hardcoded FR: a Milan or London offer declaring "FR" is false structured data
 * (Google penalises wrong data harder than absent data). When nothing reliable
 * is stored, the field — or the whole jobLocation — is OMITTED, never invented.
 */

/** A minimal, valid JobRow the tests specialise per case. */
function job(overrides: Partial<JobRow>): JobRow {
  return {
    id: 'job-1',
    title: 'Sales Advisor',
    company: 'Cartier',
    group: 'Richemont',
    city: null,
    location: null,
    country: null,
    isFrance: false,
    contract: 'CDI',
    sector: 'JEWELRY_WATCHES',
    url: 'https://example.com/job',
    postedAt: new Date('2026-09-01T00:00:00Z'),
    latitude: null,
    longitude: null,
    sourceCount: 1,
    sources: ['richemont'],
    description: 'A role.',
    applyUrl: 'https://example.com/job',
    postalCode: null,
    department: null,
    workingTime: null,
    remote: null,
    experienceYears: null,
    educationLevel: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    validThrough: null,
    ...overrides,
  };
}

describe('buildJobPostingJsonLd — jobLocation / addressCountry', () => {
  test('offre France : addressCountry FR (drapeau isFrance, même sans country brut)', () => {
    const ld = buildJobPostingJsonLd(job({ city: 'Paris', country: null, isFrance: true }));
    expect(ld.jobLocation).toEqual({
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Paris',
        addressCountry: 'FR',
      },
    });
  });

  test('offre Royaume-Uni : le country brut est normalisé en GB (ISO alpha-2)', () => {
    const ld = buildJobPostingJsonLd(job({ city: 'London', country: 'United Kingdom', isFrance: false }));
    expect(ld.jobLocation?.address.addressCountry).toBe('GB');
    expect(ld.jobLocation?.address.addressLocality).toBe('London');
  });

  test("offre sans pays : addressCountry est OMIS (jamais FR par défaut), la ville reste", () => {
    const ld = buildJobPostingJsonLd(job({ city: 'Dubai Mall', country: null, isFrance: false }));
    expect(ld.jobLocation?.address.addressLocality).toBe('Dubai Mall');
    expect(ld.jobLocation?.address).not.toHaveProperty('addressCountry');
  });

  test('ni ville ni pays : jobLocation entier est OMIS (JSON-LD partiel valide)', () => {
    const ld = buildJobPostingJsonLd(job({ city: null, country: null, isFrance: false }));
    expect(ld).not.toHaveProperty('jobLocation');
  });

  test('pays reconnu mais pas de ville : jobLocation avec le pays seul', () => {
    const ld = buildJobPostingJsonLd(job({ city: null, country: 'Italia', isFrance: false }));
    expect(ld.jobLocation?.address.addressCountry).toBe('IT');
    expect(ld.jobLocation?.address).not.toHaveProperty('addressLocality');
  });

  test('country brut non reconnu ("EMEA") : pas de code inventé — addressCountry omis', () => {
    const ld = buildJobPostingJsonLd(job({ city: 'Genève', country: 'EMEA', isFrance: false }));
    expect(ld.jobLocation?.address).not.toHaveProperty('addressCountry');
  });

  test('postalCode uniquement si présent', () => {
    const withCp = buildJobPostingJsonLd(job({ city: 'Paris', isFrance: true, postalCode: '75008' }));
    expect(withCp.jobLocation?.address.postalCode).toBe('75008');
    const noCp = buildJobPostingJsonLd(job({ city: 'Paris', isFrance: true, postalCode: null }));
    expect(noCp.jobLocation?.address).not.toHaveProperty('postalCode');
  });
});

describe('buildJobPostingJsonLd — le reste du JobPosting (inchangé)', () => {
  test('champs de base + salaire présents quand stockés, absents sinon', () => {
    const ld = buildJobPostingJsonLd(
      job({ salaryMin: 35000, salaryMax: 42000, salaryCurrency: 'EUR', salaryPeriod: 'YEAR' }),
    );
    expect(ld['@type']).toBe('JobPosting');
    expect(ld.title).toBe('Sales Advisor');
    expect(ld.hiringOrganization).toEqual({ '@type': 'Organization', name: 'Cartier' });
    expect(ld.baseSalary?.value.minValue).toBe(35000);

    const noSalary = buildJobPostingJsonLd(job({}));
    expect(noSalary).not.toHaveProperty('baseSalary');
  });
});
