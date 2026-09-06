import { describe, expect, it } from 'vitest';
import { parseVolcanicPage } from './volcanic.js';

/** Une entrée telle que careers.fenwick.co.uk/api/v1/jobs.json la rend (capturée le 2026-09-06, description abrégée). */
const PAGE = {
  total_count: 31,
  page_count: 2,
  current_page: 1,
  jobs: [
    {
      id: 6017991,
      job_reference: '014586',
      job_title: 'Team Leader - Womenswear',
      title: 'Team Leader - Womenswear',
      job_type: 'Full Time',
      disciplines: [{ id: 44986, name: 'Retail', cached_slug: 'retail' }],
      description:
        '<p>We are excited to announce we have an opportunity to join our Manager Academy 2026 as a <strong>Womenswear Team Leader</strong> in our <strong>Tunbridge Wells store</strong>.</p> <p>&nbsp;</p>',
      clean_description: 'We are excited to announce we have an opportunity…',
      job_location: 'Royal Tunbridge Wells',
      salary_low: '14.0',
      salary_high: null,
      cached_slug: 'team-leader-womenswear-6017991',
      start_date: null,
      end_date: null,
    },
  ],
};

describe('parseVolcanicPage', () => {
  it('lit identifiant, titre, lieu, contrat, discipline et description sans balises', () => {
    const [job] = parseVolcanicPage(PAGE, 'https://www.careers.fenwick.co.uk');
    expect(job.externalId).toBe('6017991');
    expect(job.title).toBe('Team Leader - Womenswear');
    expect(job.location).toBe('Royal Tunbridge Wells');
    expect(job.contract).toBe('Full Time');
    expect(job.department).toBe('Retail');
    expect(job.salaryMin).toBe(14);
    expect(job.salaryMax).toBeUndefined();
    expect(job.description).toContain('Womenswear Team Leader');
    expect(job.description).not.toContain('<');
  });

  it("construit l'URL publique depuis le slug", () => {
    const [job] = parseVolcanicPage(PAGE, 'https://www.careers.fenwick.co.uk');
    expect(job.url).toBe('https://www.careers.fenwick.co.uk/job/team-leader-womenswear-6017991');
  });

  it("laisse la date vide quand la plateforme ne la publie pas (Fenwick : start_date null sur 31/31)", () => {
    const [job] = parseVolcanicPage(PAGE, 'https://x');
    expect(job.postedAt).toBeUndefined();
  });

  it('ignore une entrée sans slug, sans id ou sans titre', () => {
    const page = { jobs: [{ id: 1, job_title: 'Sans slug' }, { cached_slug: 'a', job_title: 'Sans id' }, { id: 2, cached_slug: 'b' }] };
    expect(parseVolcanicPage(page, 'https://x')).toHaveLength(0);
  });
});
