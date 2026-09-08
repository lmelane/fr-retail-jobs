import { describe, expect, it } from 'vitest';
import { reattestationFields } from './upsert.js';
import type { CandidateJob } from './match.js';

const base = { sourceKey: 'hermes', sourceTier: 'EMPLOYER_DIRECT', externalId: 'H1', company: 'Hermès', url: 'https://x/1', raw: {} } as CandidateJob;
const existing = { title: 'Apply Now', description: 'court', location: null, city: null, country: 'France', isFrance: false, postedAt: null, validThrough: null, language: null, employmentTerm: null, workTime: null, programType: null, engagementType: null, isSeasonal: null, remote: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null };

/**
 * Mesuré en prod le 2026-09-06 : après le premier run avec les normalisations
 * d'écriture, pays distincts 276 → 282 et « Apply Now » 184 → 184. Les
 * correctifs ne touchaient que la création ; une offre ré-attestée doit
 * porter les valeurs normalisées d'aujourd'hui.
 */
describe('reattestationFields', () => {
  it('ré-écrit le pays en ISO et dérive la ville depuis le lieu, quelle que soit la source', () => {
    const out = reattestationFields({ ...base, title: 'Vendeur', country: 'France', location: 'Paris, 75008' }, existing, false);
    expect(out.country).toBe('FR');
    expect(out.city).toBe('Paris');
    expect(out.location).toBe('Paris, 75008');
    expect(out.title).toBeUndefined();
  });

  it('n’efface jamais un pays ou une ville que le candidat ne porte pas', () => {
    const out = reattestationFields({ ...base, title: 'Vendeur' }, { ...existing, country: 'FR', city: 'Paris' }, false);
    expect(out).toEqual({});
  });

  it('la même source, même id, ré-écrit le titre et une description plus riche', () => {
    const out = reattestationFields(
      { ...base, title: 'Sales Advisor', description: 'une description bien plus longue que le texte existant' },
      existing,
      true,
    );
    expect(out.title).toBe('Sales Advisor');
    expect(out.description).toContain('bien plus longue');
  });

  it('une autre source n’a pas autorité sur le titre ni la description', () => {
    const out = reattestationFields({ ...base, sourceKey: 'fashionjobs', title: 'Sales Advisor', description: 'x'.repeat(500) }, existing, false);
    expect(out.title).toBeUndefined();
    expect(out.description).toBeUndefined();
  });

  it('une description plus courte ne remplace pas la plus riche', () => {
    const out = reattestationFields({ ...base, title: 'Apply Now', description: 'a' }, { ...existing, description: 'texte riche' }, true);
    expect(out.description).toBeUndefined();
  });
});

/** Audit A4 (2026-09-06) : date, langue, contrat… n'étaient écrits qu'à la création. */
describe('reattestationFields — champs simples', () => {
  const posted = new Date('2026-09-01T00:00:00Z');
  it('remplit un champ vide, quelle que soit la source', () => {
    const out = reattestationFields({ ...base, sourceKey: 'fashionjobs', title: 'x', postedAt: posted, language: 'fr', employmentTerm: 'PERMANENT' }, existing, false);
    expect(out.postedAt).toEqual(posted);
    expect(out.language).toBe('fr');
    expect(out.employmentTerm).toBe('PERMANENT');
  });

  it('ne ré-écrit un champ rempli que pour la même entrée', () => {
    const filled = { ...existing, postedAt: posted, language: 'fr', employmentTerm: 'PERMANENT' };
    const other = reattestationFields({ ...base, sourceKey: 'fashionjobs', title: 'x', postedAt: new Date('2026-09-03T00:00:00Z'), language: 'en', employmentTerm: 'FIXED_TERM' }, filled, false);
    expect(other).toEqual({});
    const same = reattestationFields({ ...base, title: 'Apply Now', postedAt: new Date('2026-09-03T00:00:00Z'), language: 'en', employmentTerm: 'FIXED_TERM' }, filled, true);
    expect(same.postedAt).toEqual(new Date('2026-09-03T00:00:00Z'));
    expect(same.language).toBe('en');
    expect(same.employmentTerm).toBe('FIXED_TERM');
  });

  it('une date identique ne produit pas d’écriture', () => {
    const filled = { ...existing, postedAt: posted };
    expect(reattestationFields({ ...base, title: 'Apply Now', postedAt: new Date(posted) }, filled, true)).toEqual({});
  });
});
