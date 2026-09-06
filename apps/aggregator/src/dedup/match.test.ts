import { describe, expect, it } from 'vitest';
import { blockingKey, type CandidateJob } from './match.js';

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
