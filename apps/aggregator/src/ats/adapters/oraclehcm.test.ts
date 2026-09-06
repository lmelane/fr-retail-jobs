import { describe, expect, it } from 'vitest';
import { jobPageUrl, mergeDetail, normalizeListRequisition, type OracleDetail } from './oraclehcm.js';

/**
 * Fixtures capturées le 2026-09-06 sur les tenants réels, réduites aux champs
 * que l'adaptateur lit : Bloomingdale's (ebwh.fa.us2, CX_1002) pour la liste,
 * Tiffany & Co. (eljs.fa.us2, CX) pour le détail.
 */
const ORIGIN = 'https://ebwh.fa.us2.oraclecloud.com';

const LIST_ROW = {
  Id: 'REQ_802310',
  Title: 'Commission Sales Associate - Young World, Full Time - 59th Street',
  PostedDate: '2026-09-04',
  PostingEndDate: null,
  Language: 'US',
  PrimaryLocationCountry: 'US',
  JobSchedule: null,
  ContractType: null,
  WorkerType: null,
  ShortDescriptionStr: '',
  PrimaryLocation: 'New York, NY, United States',
  secondaryLocations: [],
};

const DETAIL: OracleDetail = {
  Id: '63156',
  Title: 'Manager, Human Resources Business Partner - The Landmark',
  ExternalPostedStartDate: '2026-09-04T18:38:12+00:00',
  PrimaryLocation: 'New York, NY, United States',
  PrimaryLocationCountry: 'US',
  ContractType: null,
  JobSchedule: null,
  WorkerType: null,
  ContentLocale: 'en',
  ExternalDescriptionStr:
    '<p><strong>JOB TITLE:</strong> Human Resources Business Partner Manager – The Landmark<br><strong>REPORTS TO:</strong> Director of HRBP</p><p>The Human Resources Manager at The Landmark is a strategic business partner responsible for driving a high-performance culture.</p>',
  ExternalQualificationsStr: '',
  ExternalResponsibilitiesStr: null,
  workLocation: [
    {
      TownOrCity: null,
      PostalCode: null,
      Country: null,
      Region1: null,
      Longitude: '-73.96669',
      Latitude: '40.75922',
    },
  ],
};

describe('normalizeListRequisition', () => {
  it('lit identifiant, titre, lieu, pays et date depuis une ligne de liste', () => {
    const job = normalizeListRequisition(LIST_ROW, ORIGIN, 'CX_1002');
    expect(job.externalId).toBe('REQ_802310');
    expect(job.title).toBe('Commission Sales Associate - Young World, Full Time - 59th Street');
    expect(job.location).toBe('New York, NY, United States');
    expect(job.country).toBe('US');
    expect(job.postedAt?.toISOString().slice(0, 10)).toBe('2026-09-04');
    expect(job.description).toBeUndefined();
  });

  it("pointe l'URL publique vers l'hôte Oracle, pas vers la vitrine de marque", () => {
    expect(jobPageUrl(ORIGIN, 'CX_1002', 'REQ_802310')).toBe(
      'https://ebwh.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1002/job/REQ_802310',
    );
  });
});

describe('mergeDetail', () => {
  const base = normalizeListRequisition({ ...LIST_ROW, Id: '63156', Title: 'liste' }, ORIGIN, 'CX');

  it('prend la description complète du détail, en texte brut', () => {
    const job = mergeDetail(base, DETAIL);
    expect(job.description).toContain('Human Resources Business Partner Manager');
    expect(job.description).toContain('high-performance culture');
    expect(job.description).not.toContain('<p>');
  });

  it('préfère la date à l’heure du détail à la date au jour de la liste', () => {
    const job = mergeDetail(base, DETAIL);
    expect(job.postedAt?.toISOString()).toBe('2026-09-04T18:38:12.000Z');
  });

  it('remonte les coordonnées du lieu de travail quand le tenant les fournit', () => {
    const job = mergeDetail(base, DETAIL);
    expect(job.latitude).toBeCloseTo(40.75922);
    expect(job.longitude).toBeCloseTo(-73.96669);
    expect(job.city).toBeUndefined();
    expect(job.language).toBe('en');
  });

  it('garde les champs de liste quand le détail est vide', () => {
    const job = mergeDetail(base, { Id: '63156' });
    expect(job.title).toBe('liste');
    expect(job.location).toBe('New York, NY, United States');
    expect(job.postedAt?.toISOString().slice(0, 10)).toBe('2026-09-04');
  });
});
