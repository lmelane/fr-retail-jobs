import { describe, expect, it } from 'vitest';
import { projeterFiche, projeterListe } from '../projection';
import type { JobRow, JobsResult } from '../jobs';

const ligne = (surcharges: Partial<JobRow>): JobRow => ({
  id: 'j1', origine: 'AGREGEE', candidature: { type: 'EXTERNE', url: 'https://m/1' },
  title: 'Vendeuse', company: 'Maison', companyDomain: null, group: null, city: 'Paris',
  location: 'Paris, France', employmentTerm: 'PERMANENT', programType: null, engagementType: null,
  isSeasonal: null, sector: null, postedAt: null, latitude: null, longitude: null,
  sourceCount: 1, sources: ['x'], description: 'd'.repeat(5_000), applyUrl: 'https://m/1',
  postalCode: null, department: null, jobFunction: null, seniority: null, workTime: 'FULL_TIME',
  workplaceType: 'REMOTE', experienceYears: null, educationLevel: null, salaryMin: null, salaryMax: null,
  salaryCurrency: null, salaryPeriod: null, validThrough: null, countryCode: 'FR', countryIntegrity: null,
  language: 'fr', firstSeenAt: new Date('2026-09-01'), ...surcharges,
});

const resultat = (jobs: JobRow[]): JobsResult => ({
  jobs, total: jobs.length, totalConfirmes: jobs.length, totalPerimetre: 10, suivant: null,
  perimetre: { code: 'FR', nom: 'France', pays: ['FR'], mesure: true, locales: ['fr-FR'], localeParDefaut: 'fr-FR', langueDesLibelles: 'fr' },
  facettes: [{ cle: 'contrat', type: 'FACETTE' as const, libelle: 'Type de contrat', options: [{ value: 'PERMANENT', label: 'CDI', count: 3 }] }],
  filtresRefuses: [],
  lieu: null,
});

/**
 * F1 phase 1, lot 6 — la projection liste : sans description, avec des
 * libellés d'affichage issus du vocabulaire unique ; l'enveloppe (périmètre,
 * facettes déjà libellées, refus, lieu) traverse intacte.
 */
describe('projeterListe', () => {
  it('retire la description (prémisse : elle est présente et lourde)', () => {
    const r = resultat([ligne({})]);
    expect(r.jobs[0].description?.length).toBe(5_000);
    const p = projeterListe(r);
    expect('description' in p.jobs[0]).toBe(false);
    expect(JSON.stringify(p).length).toBeLessThan(JSON.stringify(r).length / 2);
  });

  it('lot 8 — les libellés suivent la langue des libellés du périmètre : anglais sur un marché anglophone, pays compris', () => {
    const r = resultat([ligne({ countryCode: 'US' })]);
    // Prémisse : le même périmètre en français rend « CDI » et « États-Unis ».
    expect(projeterListe(r).jobs[0].employmentTermLabel).toBe('CDI');
    expect(projeterListe(r).jobs[0].countryLabel).toBe('États-Unis');
    const en = projeterListe({ ...r, perimetre: { code: 'US', nom: 'United States', pays: ['US'], mesure: true, locales: ['en-US'], localeParDefaut: 'en-US', langueDesLibelles: 'en' } });
    expect(en.jobs[0].employmentTermLabel).toBe('Permanent');
    expect(en.jobs[0].workTimeLabel).toBe('Full-time');
    expect(en.jobs[0].workplaceTypeLabel).toBe('Remote');
    expect(en.jobs[0].countryLabel).toBe('United States');
    // Une fiche lue seule reçoit sa langue explicitement.
    expect(projeterFiche(ligne({ programType: 'INTERNSHIP' }), 'en').programTypeLabel).toBe('Internship');
    expect(projeterFiche(ligne({ programType: 'INTERNSHIP' })).programTypeLabel).toBe('Stage');
  });

  it('ajoute les libellés français depuis le vocabulaire partagé, null quand la source ne dit rien', () => {
    const p = projeterListe(resultat([ligne({}), ligne({ id: 'j2', employmentTerm: null, workTime: null, workplaceType: null })]));
    expect(p.jobs[0].employmentTermLabel).toBe('CDI');
    expect(p.jobs[0].workplaceTypeLabel).toBeTruthy();
    expect(p.jobs[0].workTimeLabel).toBeTruthy();
    expect(p.jobs[0].countryLabel).toBe('France');
    expect(p.jobs[1].employmentTermLabel).toBeNull();
    expect(p.jobs[1].workplaceTypeLabel).toBeNull();
  });

  it('conserve l’enveloppe du contrat : totaux, périmètre, facettes libellées, refus, lieu et action de candidature', () => {
    const r = resultat([ligne({ correspondance: { statut: 'NON_CONFIRMEE', dimensions: ['contrat'] } })]);
    r.filtresRefuses = [{ cle: 'contrat', valeurs: ['PERMANENT'], motif: 'FACETTE_NON_SERVIE' }];
    r.lieu = { type: 'pays', libelle: 'France' };
    const { jobs, ...enveloppe } = projeterListe(r);
    const { jobs: _k, ...attendue } = r;
    expect(enveloppe).toEqual(attendue);
    expect(jobs[0].candidature).toEqual({ type: 'EXTERNE', url: 'https://m/1' });
    expect(jobs[0].origine).toBe('AGREGEE');
    expect(jobs[0].correspondance).toEqual({ statut: 'NON_CONFIRMEE', dimensions: ['contrat'] });
  });
});
