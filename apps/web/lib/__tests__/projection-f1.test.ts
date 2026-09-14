import { describe, expect, it } from 'vitest';
import { projeterListe } from '../projection';
import type { JobRow, JobsResult } from '../jobs';

const ligne = (surcharges: Partial<JobRow>): JobRow => ({
  id: 'j1', title: 'Vendeuse', company: 'Maison', companyDomain: null, group: null, city: 'Paris',
  location: 'Paris, France', employmentTerm: 'PERMANENT', programType: null, engagementType: null,
  isSeasonal: null, sector: null, url: 'https://m/1', postedAt: null, latitude: null, longitude: null,
  sourceCount: 1, sources: ['x'], description: 'd'.repeat(5_000), applyUrl: 'https://m/1',
  postalCode: null, department: null, jobFunction: null, seniority: null, workTime: 'FULL_TIME',
  workplaceType: 'REMOTE', experienceYears: null, educationLevel: null, salaryMin: null, salaryMax: null,
  salaryCurrency: null, salaryPeriod: null, validThrough: null, countryCode: 'FR', countryIntegrity: null,
  language: 'fr', firstSeenAt: new Date('2026-09-01'), ...surcharges,
});

const resultat = (jobs: JobRow[]): JobsResult => ({
  jobs, total: jobs.length, totalInDatabase: 10, page: 1, pageCount: 1,
  facets: { sectors: [], contracts: [], cities: [], groups: [], maisons: [], sources: [], countries: [] },
});

/**
 * F1 phase 1 — la projection liste : sans description, avec des libellés
 * d'affichage issus du vocabulaire unique. Prémisse vérifiée : la ligne
 * d'entrée PORTE une description longue, sinon le témoin ne prouve rien.
 */
describe('projeterListe', () => {
  it('retire la description (prémisse : elle est présente et lourde)', () => {
    const r = resultat([ligne({})]);
    expect(r.jobs[0].description?.length).toBe(5_000);
    const p = projeterListe(r);
    expect('description' in p.jobs[0]).toBe(false);
    expect(JSON.stringify(p).length).toBeLessThan(JSON.stringify(r).length / 2);
  });

  it('ajoute les libellés français depuis le vocabulaire partagé, null quand la source ne dit rien', () => {
    const p = projeterListe(resultat([ligne({}), ligne({ id: 'j2', employmentTerm: null, workTime: null, workplaceType: null })]));
    expect(p.jobs[0].employmentTermLabel).toBe('CDI');
    expect(p.jobs[0].workplaceTypeLabel).toBeTruthy();
    expect(p.jobs[0].workTimeLabel).toBeTruthy();
    expect(p.jobs[1].employmentTermLabel).toBeNull();
    expect(p.jobs[1].workplaceTypeLabel).toBeNull();
  });

  it('conserve total et pagination, et libelle les facettes à dimensions et pays', () => {
    const r = resultat([ligne({})]);
    r.facets.contracts = [{ value: 'PERMANENT', count: 3 }];
    r.facets.countries = [{ value: 'FR', count: 3 }, { value: 'XQ', count: 1 }];
    const { jobs: _j, facets, ...enveloppe } = projeterListe(r);
    const { jobs: _k, facets: _f, ...attendue } = r;
    expect(enveloppe).toEqual(attendue);
    expect(facets.contracts).toEqual([{ value: 'PERMANENT', count: 3, label: 'CDI' }]);
    expect(facets.countries[0]).toEqual({ value: 'FR', count: 3, label: 'France' });
    // Un code hors table garde son code en libellé : jamais un texte inventé.
    expect(facets.countries[1].label).toBe('XQ');
    expect(facets.cities).toEqual(r.facets.cities);
  });
});
