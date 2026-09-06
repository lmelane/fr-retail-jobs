import { describe, it, expect } from 'vitest';
import { jobPostingSchema, schemaEmploymentTypes } from './job-posting-schema';
import type { JobRow } from './jobs';

/**
 * S-02a/S-02b intérim — the JSON-LD contract, pinned:
 * datePosted falls back to firstSeenAt, validThrough gets a horizon,
 * employmentType speaks schema.org, and addressCountry is NEVER a hard-coded
 * FR — it is the canonical code of what the source said, or absent.
 */

const base: JobRow = {
  id: 'ck123', title: 'Vendeur', company: 'Cartier', companyDomain: 'cartier.com', group: 'Richemont',
  city: 'PARIS', location: 'Paris, France', contract: 'CDI', sector: 'LUXURY',
  url: 'https://x/1', postedAt: null, latitude: null, longitude: null,
  sourceCount: 1, sources: ['cartier'], description: 'desc', applyUrl: 'https://x/1',
  postalCode: null, department: null, workingTime: null, remote: null,
  experienceYears: null, educationLevel: null, salaryMin: null, salaryMax: null,
  salaryCurrency: null, salaryPeriod: null, validThrough: null,
  country: 'France', language: 'fr', firstSeenAt: new Date('2026-09-01T00:00:00Z'),
};

describe('jobPostingSchema', () => {
  const now = new Date('2026-09-06T12:00:00Z');

  it('falls back to firstSeenAt for datePosted, and validThrough is the next-pass horizon', () => {
    const schema = jobPostingSchema(base, now);
    expect(schema.datePosted).toBe('2026-09-01T00:00:00.000Z');
    // Horizon : aujourd'hui + 30 j, jamais dans le passé (audit A4 : 21 157 offres inéligibles).
    expect(schema.validThrough).toBe('2026-10-06T12:00:00.000Z');
  });

  it("une validité de source déjà passée est repoussée à l'horizon tant que l'offre est listée", () => {
    const schema = jobPostingSchema({ ...base, validThrough: new Date('2026-08-01T00:00:00Z') }, now);
    expect(schema.validThrough).toBe('2026-10-06T12:00:00.000Z');
  });

  it('prefers the source datePosted and a still-future validThrough', () => {
    const schema = jobPostingSchema({
      ...base,
      postedAt: new Date('2026-09-02T00:00:00Z'),
      validThrough: new Date('2026-09-20T00:00:00Z'),
    }, now);
    expect(schema.datePosted).toBe('2026-09-02T00:00:00.000Z');
    expect(schema.validThrough).toBe('2026-09-20T00:00:00.000Z');
  });

  it('maps addressCountry from the source value, never a default', () => {
    const fr = jobPostingSchema(base) as { jobLocation: { address: Record<string, unknown> } };
    expect(fr.jobLocation.address.addressCountry).toBe('FR');

    const it_ = jobPostingSchema({ ...base, country: 'Italia' }) as typeof fr;
    expect(it_.jobLocation.address.addressCountry).toBe('IT');

    // Unknown country: the field is OMITTED — a Milan offer must never say FR.
    const unknown = jobPostingSchema({ ...base, country: null }) as typeof fr;
    expect('addressCountry' in unknown.jobLocation.address).toBe(false);
  });

  it('declares the aggregator honestly: identifier + directApply false', () => {
    const schema = jobPostingSchema(base);
    expect(schema.directApply).toBe(false);
    expect(schema.identifier).toEqual({ '@type': 'PropertyValue', name: 'Cartier', value: 'ck123' });
    expect(schema.inLanguage).toBe('fr');
  });
});

describe('schemaEmploymentTypes', () => {
  it('speaks schema.org, not French HR', () => {
    expect(schemaEmploymentTypes('CDI', null)).toEqual(['FULL_TIME']);
    expect(schemaEmploymentTypes('CDD', null)).toEqual(['TEMPORARY']);
    expect(schemaEmploymentTypes('STAGE', null)).toEqual(['INTERN']);
    expect(schemaEmploymentTypes('FREELANCE', null)).toEqual(['CONTRACTOR']);
  });
  it('part-time replaces the CDI full-time assumption', () => {
    expect(schemaEmploymentTypes('CDI', 'TEMPS_PARTIEL')).toEqual(['PART_TIME']);
  });
  it('unknown contract yields nothing rather than a guess', () => {
    expect(schemaEmploymentTypes(null, null)).toEqual([]);
  });
});
