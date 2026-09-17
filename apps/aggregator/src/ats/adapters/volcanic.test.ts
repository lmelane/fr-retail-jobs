import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../../lib/http.js', () => ({fetchJson:vi.fn(),fetchText:vi.fn()}));
import {fetchJson,fetchText} from '../../lib/http.js';
beforeEach(() => vi.resetAllMocks());
import { parseVolcanicPage, fetchVolcanicJobs } from './volcanic.js';

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

  it("laisse les dates inconnues quand la liste ne les déclare pas", () => {
    const [job] = parseVolcanicPage(PAGE, 'https://x');
    expect(job.postedAt).toBeUndefined();
  });

  it('ignore une entrée sans slug, sans id ou sans titre', () => {
    const page = { jobs: [{ id: 1, job_title: 'Sans slug' }, { cached_slug: 'a', job_title: 'Sans id' }, { id: 2, cached_slug: 'b' }] };
    expect(parseVolcanicPage(page, 'https://x')).toHaveLength(0);
  });
});

it('reads the real detail JobPosting with an unquoted type and keeps its dates in RAW', async () => {
  const url='https://www.careers.fenwick.co.uk/job/team-leader-womenswear-6017991';
  vi.mocked(fetchJson).mockResolvedValue({...PAGE,page_count:1,total_count:1});
  const posting={'@type':'JobPosting',title:'Team Leader - Womenswear',description:'Complete source description',url,datePosted:'2026-09-04T14:07:48.268Z',validThrough:'2026-10-31T22:59:00.000Z'};
  vi.mocked(fetchText).mockResolvedValue(`<script type=application/ld+json>${JSON.stringify(posting)}</script>`);
  const r=await fetchVolcanicJobs({origin:'https://www.careers.fenwick.co.uk'});
  expect(r.jobs[0]).toMatchObject({postedAt:new Date(posting.datePosted),validThrough:new Date(posting.validThrough),raw:{postingEvidence:{jobPostingCount:1,jobPosting:posting}}});
});
it('does not interpret unqualified list start/end dates as publication dates', () => {
  const [job]=parseVolcanicPage({jobs:[{...PAGE.jobs[0],start_date:'2024-01-01',end_date:'2024-02-01'}]},'https://www.careers.fenwick.co.uk');
  expect(job.postedAt).toBeUndefined();expect(job.validThrough).toBeUndefined();
});
