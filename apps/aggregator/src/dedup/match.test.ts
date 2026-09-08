import { describe, expect, it } from 'vitest';
import { blockingKey, clusterJobs, isProbableDuplicate, type CandidateJob } from './match.js';

const base = { sourceKey: 'x', sourceTier: 'EMPLOYER_DIRECT', externalId: '1', title: 'Vendeur', url: 'https://x/1', raw: {} } as CandidateJob;

describe('blockingKey — la ville structurée compte', () => {
  it('un candidat avec city et sans location se range avec sa ville', () => {
    expect(blockingKey({ ...base, company: "L'Oréal", city: 'Paris' })).toBe(blockingKey({ ...base, company: "L'Oréal", location: 'Paris, France' }));
    expect(blockingKey({ ...base, company: "L'Oréal", city: 'Paris' })).not.toBe(blockingKey({ ...base, company: "L'Oréal" }));
  });

  it('city prime sur un location illisible', () => {
    expect(blockingKey({ ...base, company: 'Dior', city: 'Lyon', location: '-' })).toBe(blockingKey({ ...base, company: 'Dior', location: 'Lyon' }));
  });
});

describe('cross-source identity safeguards', () => {
  const employer: CandidateJob = { ...base, company: 'Dior', city: 'Paris', country: 'FR', sourceKey: 'employer' };
  const board: CandidateJob = { ...employer, sourceKey: 'board', externalId: 'copy-1' };

  it('keeps homonymous cities in different declared countries separate', () => {
    expect(isProbableDuplicate(employer, { ...board, country: 'US' })).toBe(false);
  });

  it('accepts equivalent country spellings and does not invent a missing country', () => {
    expect(isProbableDuplicate(employer, { ...board, country: 'France' })).toBe(true);
    expect(isProbableDuplicate(employer, { ...board, country: undefined })).toBe(true);
  });

  it.each([
    ['Store Manager', 'Assistant Store Manager'],
    ['Store Manager', 'Deputy Store Manager'],
    ['Directeur de boutique', 'Directeur adjoint de boutique'],
    ['Responsable de magasin', 'Responsable de magasin adjoint'],
  ])('does not merge different management levels: %s / %s', (title, deputyTitle) => {
    expect(isProbableDuplicate({ ...employer, title }, { ...board, title: deputyTitle })).toBe(false);
  });

  it('preserves legitimate translations of sales roles and assistant management roles', () => {
    expect(isProbableDuplicate({ ...employer, title: 'Sales Assistant' }, { ...board, title: 'Conseiller de vente' })).toBe(true);
    expect(isProbableDuplicate({ ...employer, title: 'Assistant Store Manager' }, { ...board, title: 'Deputy Store Manager' })).toBe(true);
  });

  it('applies the date boundary even when titles are identical', () => {
    const dated = { ...employer, postedAt: new Date('2026-01-01T00:00:00Z') };
    expect(isProbableDuplicate(dated, { ...board, postedAt: new Date('2026-06-30T00:00:00Z') })).toBe(false);
    expect(isProbableDuplicate(dated, { ...board, postedAt: new Date('2026-01-10T00:00:00Z') })).toBe(true);
  });

  it('does not allow an unknown country to bridge contradictory postings in a cluster', () => {
    const unknown = { ...board, country: undefined };
    const us = { ...board, sourceKey: 'us', country: 'US' };
    for (const input of [[employer, unknown, us], [unknown, us, employer], [us, employer, unknown]]) {
      const groups = clusterJobs(input);
      expect(groups).toHaveLength(2);
      for (const group of groups) {
        const known = new Set(group.sources.map(s => s.country).filter(Boolean));
        expect(known.size).toBeLessThanOrEqual(1);
      }
    }
  });
});
