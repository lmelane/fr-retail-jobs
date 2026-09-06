import { describe, expect, it } from 'vitest';
import { parseJibePage } from './jibe.js';

/** Une entrée telle que careers.ulta.com/api/jobs la rend (capturée le 2026-09-06, description abrégée). */
const PAGE = {
  totalCount: 9959,
  jobs: [
    {
      data: {
        slug: '515485',
        language: 'en-us',
        client_code: 'ulta',
        req_id: '515485',
        title: 'Specialty Beauty Advisor - Lancome',
        description:
          '<br><br><strong>OVERVIEW</strong><br><br><p style="margin: 0px;"><span>Experience a place of energy, passion, and excitement.</span></p>',
        location_name: 'Lakewood, Colorado',
        city: 'Lakewood',
        state: 'Colorado',
        country: 'United States',
        country_code: 'US',
        postal_code: '80226',
        latitude: 39.7047,
        longitude: '-105.0814',
        department: 'Retail',
        hiring_organization: 'Ulta Beauty',
        posted_date: '2026-09-05T23:46:00+0000',
        posting_expiry_date: '2026-12-05T23:46:00+0000',
        apply_url: 'https://fdcnmcareers-ulta.icims.com/jobs/515485/login',
        full_location: 'Lakewood, Colorado, US',
        meta_data: { canonical_url: 'https://careers.ulta.com/careers/jobs/515485?lang=en-us' },
      },
    },
  ],
};

describe('parseJibePage', () => {
  it('lit identifiant, titre, lieu structuré, dates et description sans balises', () => {
    const [job] = parseJibePage(PAGE, 'https://careers.ulta.com');
    expect(job.externalId).toBe('515485');
    expect(job.title).toBe('Specialty Beauty Advisor - Lancome');
    expect(job.location).toBe('Lakewood, Colorado, US');
    expect(job.city).toBe('Lakewood');
    expect(job.region).toBe('Colorado');
    expect(job.country).toBe('US');
    expect(job.latitude).toBeCloseTo(39.7047);
    expect(job.longitude).toBeCloseTo(-105.0814);
    expect(job.postedAt?.toISOString()).toBe('2026-09-05T23:46:00.000Z');
    expect(job.validThrough?.toISOString()).toBe('2026-12-05T23:46:00.000Z');
    expect(job.description).toContain('Experience a place of energy');
    expect(job.description).not.toContain('<');
    expect(job.company).toBe('Ulta Beauty');
  });

  it("pointe sur la page publique de l'offre, jamais sur la page de connexion iCIMS", () => {
    const [job] = parseJibePage(PAGE, 'https://careers.ulta.com');
    expect(job.url).toBe('https://careers.ulta.com/careers/jobs/515485?lang=en-us');
    expect(job.url).not.toContain('/login');
  });

  it("construit l'URL depuis le slug quand le portail ne donne pas de canonique", () => {
    const page = { jobs: [{ data: { ...PAGE.jobs[0].data, meta_data: undefined } }] };
    const [job] = parseJibePage(page, 'https://careers.ulta.com');
    expect(job.url).toBe('https://careers.ulta.com/careers/jobs/515485?lang=en-us');
  });

  it('ignore une entrée sans identifiant ni titre plutôt que de produire une ligne vide', () => {
    expect(parseJibePage({ jobs: [{ data: { title: 'Sans id' } }, { data: { req_id: '1' } }, {}] }, 'https://x')).toHaveLength(0);
  });

  it('rend une liste vide pour une page vide (la réponse sans cookie de session)', () => {
    expect(parseJibePage({ jobs: [], totalCount: 0 }, 'https://x')).toHaveLength(0);
  });
});
