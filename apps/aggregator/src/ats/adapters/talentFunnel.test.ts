import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), DEFAULT_DETAIL_CONCURRENCY: 4 }));

import { fetchJson } from '../../lib/http.js';
import { fetchTalentFunnelJobs, parseTalentFunnelVacancy } from './talentFunnel.js';

const mockJson = vi.mocked(fetchJson);
beforeEach(() => mockJson.mockReset());

const ORIGIN = 'https://jobs.drmartens.com';
const TENANT = 'a3e88308-2615-4415-bb56-cc5267bc1ced';

/** Une vacancy de POST /js/search/vacancy (capturée le 2026-09-06) — description vide, comme 142/143. */
const LISTED = {
  id: '2EL4m1Deh2APHPe8Tv2t3p',
  jobTitle: 'Store Manager - Aventura',
  company: { id: '3tigx5YRDZJJU3dvD6b0DO', identifier: 'dr.-martens-us', name: 'Dr. Martens US' },
  vacancyId: '2EL4m1Deh2APHPe8Tv2t3p',
  tenant: TENANT,
  category: 'Retail',
  location: {
    city: 'Aventura',
    country: 'US',
    geoLocation: { type: 'Point', coordinates: [[-80.14308, 25.957748]] as Array<[number, number]> },
    formattedAddress: '19501 Biscayne Boulevard, Aventura, Miami-Dade, 33180-2314, US',
  },
  hoursType: 'FULL_TIME',
  remuneration: { currency: 'GBP', description: 'Dependent on experience', interval: 'YEARLY', ranges: [{ type: 'FIXED', value: 0 }], type: 'FIXED' },
  applicationUrl: 'https://forms.talent-funnel.com/form?id=1defa401-709e-464e-9818-106e6c0fff89',
  validFrom: '2026-09-04',
  validTo: '9999-12-31',
};

/** GET /js/vacancy/{id} : le texte complet vit dans positionProfile. */
const DETAIL = {
  validFrom: '2026-09-04',
  positionProfile: {
    title: 'Part Time Sales Associate - North Star',
    description:
      '<p>Dr. Martens is more than a brand - it&#39;s a global icon with over 60 years of attitude, heritage, and cultural impact. We&#39;re a thriving, values-driven business powered by diverse thinkers, bold doers, and people who bring their whole selves to work.</p><p><strong>WHERE YOU CONTRIBUTE</strong></p><p>You understand that as a Retail Sales Associate you are the face of our brand.</p>',
    seniority: 'MID',
    contractType: 'DIRECT_HIRE',
    hoursType: 'PART_TIME',
    remoteWorking: false,
    language: 'en-GB',
    location: { city: 'San Antonio', postCode: '78216', country: 'US', geoLocation: { type: 'Point', coordinates: [[-98.47547, 29.58144]] as Array<[number, number]> } },
    remuneration: { description: 'Competitive', interval: 'HOURLY', ranges: [{ type: 'FIXED', value: 15.5 }], type: 'FIXED' },
  },
};

describe('parseTalentFunnelVacancy', () => {
  it('lit identifiant, titre, lieu, coordonnées (GeoJSON : longitude d’abord) et URL publique', () => {
    const job = parseTalentFunnelVacancy(LISTED, ORIGIN)!;
    expect(job.externalId).toBe('2EL4m1Deh2APHPe8Tv2t3p');
    expect(job.title).toBe('Store Manager - Aventura');
    expect(job.city).toBe('Aventura');
    expect(job.country).toBe('US');
    expect(job.location).toBe('Aventura, US');
    expect(job.longitude).toBeCloseTo(-80.143, 2);
    expect(job.latitude).toBeCloseTo(25.958, 2);
    expect(job.url).toBe('https://jobs.drmartens.com/job/2EL4m1Deh2APHPe8Tv2t3p');
    expect(job.postedAt?.toISOString()).toBe('2026-09-04T00:00:00.000Z');
  });

  it('ignore validTo 9999-12-31 et un salaire à 0 — rien n’est inventé', () => {
    const job = parseTalentFunnelVacancy(LISTED, ORIGIN)!;
    expect(job.validThrough).toBeUndefined();
    expect(job.salaryMin).toBeUndefined();
    expect(job.description).toBeUndefined();
  });

  it('ne propage pas l’entité régionale (« Dr. Martens US ») comme employeur', () => {
    expect(parseTalentFunnelVacancy(LISTED, ORIGIN)!.company).toBeUndefined();
  });

  it('prend la description, le contrat et le salaire horaire dans le détail', () => {
    const job = parseTalentFunnelVacancy(LISTED, ORIGIN, DETAIL)!;
    expect(job.description).toContain("it's a global icon");
    expect(job.description).toContain('WHERE YOU CONTRIBUTE');
    expect(job.description).not.toContain('<p>');
    expect(job.contract).toBe('DIRECT_HIRE');
    expect(job.workingTime).toBe('PART_TIME');
    expect(job.language).toBe('en');
    expect(job.postalCode).toBe('78216');
    expect(job.salaryMin).toBe(15.5);
    expect(job.salaryPeriod).toBe('HOUR');
    expect(job.salaryCurrency).toBeUndefined();
  });
});

describe('fetchTalentFunnelJobs', () => {
  it('envoie l’en-tête tenant sur la recherche ET le détail — sans lui, 403', async () => {
    mockJson
      .mockResolvedValueOnce({ results: [LISTED], totalResults: 1, start: 0, limit: 500 } as never)
      .mockResolvedValueOnce(DETAIL as never);

    const { jobs, declaredTotal, truncated } = await fetchTalentFunnelJobs({ origin: ORIGIN, tenant: TENANT });

    expect(jobs).toHaveLength(1);
    expect(declaredTotal).toBe(1);
    expect(truncated).toBe(false);
    expect(mockJson.mock.calls[0][0]).toBe('https://ats-api.talent-funnel.com/js/search/vacancy');
    expect((mockJson.mock.calls[0][1]?.headers as Record<string, string>).tenant).toBe(TENANT);
    expect(mockJson.mock.calls[1][0]).toBe('https://ats-api.talent-funnel.com/js/vacancy/2EL4m1Deh2APHPe8Tv2t3p');
    expect((mockJson.mock.calls[1][1]?.headers as Record<string, string>).tenant).toBe(TENANT);
    expect(jobs[0].description).toContain('global icon');
  });

  it('garde l’offre quand son détail est injoignable', async () => {
    mockJson
      .mockResolvedValueOnce({ results: [LISTED], totalResults: 1 } as never)
      .mockRejectedValueOnce(new Error('HTTP 500'));
    const { jobs } = await fetchTalentFunnelJobs({ origin: ORIGIN, tenant: TENANT });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].description).toBeUndefined();
  });

  it('refuse de tourner sans tenant', async () => {
    await expect(fetchTalentFunnelJobs({ origin: ORIGIN })).rejects.toThrow(/tenant/);
  });
});
