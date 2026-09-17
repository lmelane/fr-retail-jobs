import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../../lib/http.js', () => ({fetchJson:vi.fn(),fetchText:vi.fn()}));
import {fetchJson,fetchText} from '../../lib/http.js';
beforeEach(() => vi.resetAllMocks());
import { parseVolcanicPage, fetchVolcanicJobs } from './volcanic.js';
import { normalizeAdapterResult } from '../index.js';

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

/**
 * LE CONTRAT DES IDENTIFIANTS CANONIQUES.
 *
 * `job.id` est le chemin d'identité de `externalId` : la preuve d'énumération le déclare pour que la source
 * puisse un jour prouver une absence. Sans la propriété `canonicalIds`, aucune absence n'y est démontrable
 * (`UNVERIFIABLE` à la prévisualisation) — et le témoin qui suit passe au rouge si elle est retirée.
 */
describe('Volcanic — contrat des identifiants canoniques', () => {
  it('déclare canonicalIds sur CHAQUE page, exactement les job.id observés', async () => {
    const second = {...PAGE, current_page:2, jobs:[{...PAGE.jobs[0], id:6017992, cached_slug:'autre-6017992'}]};
    vi.mocked(fetchJson).mockResolvedValueOnce(PAGE).mockResolvedValueOnce(second);
    vi.mocked(fetchText).mockResolvedValue('<html></html>');
    const r = await fetchVolcanicJobs({origin:'https://www.careers.fenwick.co.uk'});

    const pages = r.enumeration!.pageEvidence!;
    expect(pages).toHaveLength(2);
    // Un contrat PARTIEL n'est pas un contrat : chaque page doit porter la propriété.
    for (const pe of pages) expect(Object.hasOwn(pe, 'canonicalIds')).toBe(true);
    expect(pages.map(pe => pe.canonicalIds)).toEqual([['6017991'], ['6017992']]);
    expect(r.enumeration!.canonicalAbsenceProofUsable).toBe(true);

    // Le contrat vérifié par le normaliseur : toute offre produite figure dans la preuve, et réciproquement.
    const canonical = pages.flatMap(pe => pe.canonicalIds ?? []);
    expect([...canonical].sort()).toEqual(r.jobs.map(j => j.externalId).sort());
    const n = normalizeAdapterResult(r);
    expect(n.enumeration?.canonicalIdViolations).toBeUndefined();
    expect(n.enumeration?.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
  });

  it('une ligne vue puis écartée reste une DISPOSITION nommée, pas un trou dans la preuve', async () => {
    const withBadRow = {...PAGE, page_count:1, total_count:2,
      jobs:[PAGE.jobs[0], {id:6017993, job_title:'Sans slug'}]};
    vi.mocked(fetchJson).mockResolvedValue(withBadRow);
    vi.mocked(fetchText).mockResolvedValue('<html></html>');
    const r = await fetchVolcanicJobs({origin:'https://www.careers.fenwick.co.uk'});

    expect(r.jobs).toHaveLength(1);
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(['6017991', '6017993']);
    expect(r.rejectedRows?.map(row => row.canonicalId)).toEqual(['6017993']);
    // Observée + disposée = contrat intact malgré la ligne écartée.
    expect(normalizeAdapterResult(r).enumeration?.canonicalIdViolations).toBeUndefined();
  });

  it("une ligne SANS id est anonyme : elle interdit toute attestation d'absence", async () => {
    vi.mocked(fetchJson).mockResolvedValue({...PAGE, page_count:1, jobs:[PAGE.jobs[0], {job_title:'Sans id', cached_slug:'x'}]});
    vi.mocked(fetchText).mockResolvedValue('<html></html>');
    const r = await fetchVolcanicJobs({origin:'https://www.careers.fenwick.co.uk'});
    expect(r.enumeration!.canonicalAbsenceProofUsable).toBe(false);
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(['6017991']);
  });
});
