import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn() }));

import { fetchJson } from '../../lib/http.js';
import { fetchRitualsJobs, parseRitualsHit, slugify } from './rituals.js';

const mockJson = vi.mocked(fetchJson);
beforeEach(() => mockJson.mockReset());

/** Un `_source` tel que careers.rituals.com/api/v1/jobs/ le rend (capturé le 2026-09-06). */
const SOURCE = {
  title: 'Responsable Adjoint(e) -  CDI 35h - Euralille',
  jobId: '95acdf2c-af24-4682-b99c-c5b1aff840d9',
  jobAdId: 'e7ecf015-19bd-4842-a8cb-acb9052bbb43',
  refNumber: 'REF33464H',
  language: 'fr-FR',
  createdDate: 1788533112837,
  releasedDate: 1788533113973,
  city: 'Lille',
  postalCode: '59777',
  country: 'FR',
  lonLat: { lat: 50.6369787, lon: 3.0745045 },
  contractType: { id: 'permanent', label: 'Full-time' },
  locationName: 'Lille Euralille',
  function: 'sales',
  jobDescriptionPlain:
    'En tant que Responsable Adjoint(e), votre objectif est d’accompagner, motiver et fédérer votre équipe au quotidien, tout en assurant la meilleure expérience à nos clients en boutique.\n\nA ce titre, vos missions consistent à :',
  qualificationsPlain: 'Notre ambition est de devenir la marque iconique de bien-être dans le monde.',
  additionalInformationPlain: '',
  languageData: { code: 'fr', label: 'French', labelNative: 'français' },
};

function hits(sources: Array<typeof SOURCE>, total: number) {
  return { hits: { total: { value: total }, hits: sources.map((s) => ({ _id: s.jobAdId, _source: s })) } };
}

describe('parseRitualsHit', () => {
  it('lit identifiant, titre, lieu, date et description depuis le _source', () => {
    const job = parseRitualsHit(SOURCE)!;
    expect(job.externalId).toBe('e7ecf015-19bd-4842-a8cb-acb9052bbb43');
    expect(job.title).toBe('Responsable Adjoint(e) - CDI 35h - Euralille');
    expect(job.city).toBe('Lille');
    expect(job.country).toBe('FR');
    expect(job.postalCode).toBe('59777');
    expect(job.latitude).toBeCloseTo(50.637, 2);
    expect(job.description).toContain('Responsable Adjoint(e), votre objectif');
    expect(job.description).toContain('marque iconique');
    expect(job.language).toBe('fr');
  });

  it('lit releasedDate en MILLISECONDES — pas en secondes comme LVMH', () => {
    expect(parseRitualsHit(SOURCE)!.postedAt?.toISOString()).toBe('2026-09-04T14:45:13.973Z');
  });

  it('construit l’URL publique /{locale}/jobs/{slug}/{jobAdId}/', () => {
    expect(parseRitualsHit(SOURCE)!.url).toBe(
      'https://careers.rituals.com/fr-FR/jobs/responsable-adjoint-e-cdi-35h-euralille/e7ecf015-19bd-4842-a8cb-acb9052bbb43/',
    );
  });

  it('rejette un hit sans jobAdId plutôt que d’inventer un identifiant', () => {
    expect(parseRitualsHit({ ...SOURCE, jobAdId: undefined })).toBeNull();
  });
});

describe('slugify', () => {
  it('reproduit le slug du sitemap pour un titre accentué', () => {
    expect(slugify('Chef de secteur (H/F) – Île de France')).toBe('chef-de-secteur-h-f-ile-de-france');
  });
});

describe('fetchRitualsJobs — pagination cumulative', () => {
  it('lit la page 1 pour le total puis UNE page dimensionnée ceil(total/20)', async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ ...SOURCE, jobAdId: `id-${i}` }));
    mockJson.mockResolvedValueOnce(hits(many.slice(0, 20), 45) as never).mockResolvedValueOnce(hits(many, 45) as never);

    const { jobs, declaredTotal, truncated } = await fetchRitualsJobs({ language: 'fr-FR' });

    expect(mockJson).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(mockJson.mock.calls[1][1]?.body)).page).toBe(3);
    expect(jobs).toHaveLength(45);
    expect(declaredTotal).toBe(45);
    expect(truncated).toBe(false);
  });

  it('ne fait qu’un appel quand la première page contient déjà tout', async () => {
    mockJson.mockResolvedValueOnce(hits([SOURCE], 1) as never);
    const { jobs } = await fetchRitualsJobs({});
    expect(mockJson).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(1);
  });

  it('additionne les locales et signale une lecture incomplète', async () => {
    mockJson
      .mockResolvedValueOnce(hits([SOURCE], 1) as never)
      .mockResolvedValueOnce(hits([{ ...SOURCE, jobAdId: 'de-1', language: 'de-DE' }], 2) as never)
      .mockResolvedValueOnce(hits([{ ...SOURCE, jobAdId: 'de-1', language: 'de-DE' }], 2) as never);

    const { jobs, declaredTotal, truncated } = await fetchRitualsJobs({ languages: ['fr-FR', 'de-DE'] });

    expect(jobs.map((j) => j.externalId)).toEqual(['e7ecf015-19bd-4842-a8cb-acb9052bbb43', 'de-1']);
    expect(jobs[1].url).toContain('/de-DE/jobs/');
    expect(declaredTotal).toBe(3);
    expect(truncated).toBe(true);
  });
});
