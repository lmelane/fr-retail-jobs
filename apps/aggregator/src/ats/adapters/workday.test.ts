import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn() }));

import { fetchJson } from '../../lib/http.js';
import { fetchWorkdayJobs, locationFromBullets } from './workday.js';

const mockJson = vi.mocked(fetchJson);
beforeEach(() => mockJson.mockReset());

/**
 * Regression for the live "cartier-3 failed: Cannot read properties of
 * undefined (reading 'split')": Richemont's Workday tenant returned a posting
 * with no externalPath, and `job.externalPath.split('/')` threw, losing all
 * ~1300 of its offers. A path-less row must be skipped, not crash the source.
 */
describe('fetchWorkdayJobs with a posting missing externalPath', () => {
  it('skips the path-less posting and keeps the valid ones, no throw', async () => {
    mockJson.mockResolvedValueOnce({
      total: 2,
      jobPostings: [
        { title: 'Vendeur', externalPath: '/job/Paris/Vendeur_R-123' },
        { title: 'Ghost row', /* no externalPath */ locationsText: 'Nowhere' },
      ],
    } as never);

    const { jobs } = await fetchWorkdayJobs({
      tenant: 'richemont',
      site: 'richemont',
      origin: 'https://richemont.wd3.myworkdayjobs.com',
      withDescriptions: false,
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Vendeur');
    // externalId is the last path segment.
    expect(jobs[0].externalId).toBe('Vendeur_R-123');
  });
});

/**
 * Regression for the live 404 on every Richemont/Cartier apply link: the URL was
 * built with `new URL(externalPath, `${origin}/${site}/`)`, which DROPS the
 * `/{site}/` segment because externalPath is an absolute path ("/job/…") that
 * overrides the base path — producing `${origin}/job/…` (404) instead of
 * `${origin}/${site}/job/…` (200, verified live).
 */
describe('fetchWorkdayJobs apply URL', () => {
  it('keeps the /{site}/ path segment (absolute externalPath must not drop it)', async () => {
    mockJson.mockResolvedValueOnce({
      total: 1,
      jobPostings: [{ title: 'Vendeur', externalPath: '/job/Paris/Vendeur_R-123' }],
    } as never);

    const { jobs } = await fetchWorkdayJobs({
      tenant: 'richemont',
      site: 'broadbean_external',
      origin: 'https://richemont.wd3.myworkdayjobs.com',
      withDescriptions: false,
    });

    expect(jobs[0].url).toBe(
      'https://richemont.wd3.myworkdayjobs.com/broadbean_external/job/Paris/Vendeur_R-123',
    );
  });
});

import { brandFromWorkdayDetail } from './workday.js';

/**
 * Audit A-01 — on a group tenant, the offer belongs to its Maison. The detail
 * payload names it twice; shapes verified live on richemont/broadbean_external.
 */
describe('brandFromWorkdayDetail', () => {
  it('prefers the logo alt text — it is the clean brand name', () => {
    expect(
      brandFromWorkdayDetail({
        jobPostingInfo: { logoImage: { alt: 'Panerai' } },
        hiringOrganization: { name: 'C170 Officine Panerai' },
      }),
    ).toBe('Panerai');
  });

  it('falls back to the legal entity, stripped of its code prefix', () => {
    expect(brandFromWorkdayDetail({ hiringOrganization: { name: 'C170 Officine Panerai' } })).toBe(
      'Officine Panerai',
    );
  });

  it('returns undefined on a single-brand tenant without those fields', () => {
    expect(brandFromWorkdayDetail({ jobPostingInfo: { jobDescription: 'x' } })).toBeUndefined();
  });
});

// ——— F-05 : la date relative du listing devient un postedAt honnête ———
import { postedAtFromWorkday } from './workday.js';

describe('postedAtFromWorkday', () => {
  it('parses today / yesterday / N days ago', () => {
    const now = Date.now();
    expect(postedAtFromWorkday('Posted Today')!.getTime()).toBeGreaterThan(now - 5_000);
    expect(Math.round((now - postedAtFromWorkday('Posted Yesterday')!.getTime()) / 86_400_000)).toBe(1);
    expect(Math.round((now - postedAtFromWorkday('Posted 12 Days Ago')!.getTime()) / 86_400_000)).toBe(12);
  });
  it('refuses to invent a date for "30+ Days Ago" or garbage', () => {
    expect(postedAtFromWorkday('Posted 30+ Days Ago')).toBeUndefined();
    expect(postedAtFromWorkday('whenever')).toBeUndefined();
    expect(postedAtFromWorkday(undefined)).toBeUndefined();
  });
});

describe('locationFromBullets — tenants qui laissent locationsText vide', () => {
  /**
   * Mesuré 2026-09-04 sur Capri (Versace, Michael Kors, Jimmy Choo) : 621
   * offres, toutes avec un lieu affiché sur la page, toutes SANS lieu une fois
   * parsées — le tenant remplit `bulletFields`, pas `locationsText`. Une offre
   * sans lieu est inutilisable pour un candidat.
   */
  it('prend le premier bullet qui est un lieu', () => {
    expect(locationFromBullets(['GV-OUTLET Vancouver', 'GV-OUTLET Vancouver', 'R_778886'])).toBe(
      'GV-OUTLET Vancouver',
    );
  });

  it('ignore un identifiant de réquisition, quelle que soit sa forme', () => {
    expect(locationFromBullets(['R_778886', 'Milano'])).toBe('Milano');
    expect(locationFromBullets(['JR12345', 'Paris'])).toBe('Paris');
    expect(locationFromBullets(['REQ-90210', 'London'])).toBe('London');
  });

  it('préfère ne rien rendre plutôt qu’afficher un identifiant comme ville', () => {
    expect(locationFromBullets(['R_778886'])).toBeUndefined();
    expect(locationFromBullets([])).toBeUndefined();
    expect(locationFromBullets(undefined)).toBeUndefined();
  });
});

// ——— l2 (2026-09-06) : le détail est lu en en-US, et il porte timeType / endDate ———
import { readFileSync } from 'node:fs';

/** Détail cxs Tapestry (Sales Associate, Taïwan) capturé en en-US le 2026-09-06, description tronquée. */
const TAPESTRY_DETAIL_EN = JSON.parse(
  readFileSync(new URL('./__fixtures__/l2-workday-tapestry-detail-en-US.json', import.meta.url), 'utf8'),
);

describe('attachWorkdayDescriptions — l2 : détail demandé en en-US, temps de travail et fin de publication lus', () => {
  it('envoie accept-language en-US sur le détail (le transport commun force fr-FR) et lit timeType, endDate, country', async () => {
    mockJson
      .mockResolvedValueOnce({
        total: 1,
        jobPostings: [{ title: 'Sales Associate', externalPath: '/job/Taipei/Sales-Associate_JR14730', postedOn: 'Posted 30+ Days Ago' }],
      } as never)
      .mockResolvedValueOnce(TAPESTRY_DETAIL_EN as never);

    const { jobs } = await fetchWorkdayJobs({
      tenant: 'tapestry',
      site: 'Tapestry_Careers',
      origin: 'https://tapestry.wd108.myworkdayjobs.com',
    });

    const detailCall = mockJson.mock.calls[1];
    const headers = (detailCall?.[1] as { headers?: Record<string, string> } | undefined)?.headers ?? {};
    expect(headers['accept-language']).toMatch(/^en-US/);

    expect(jobs[0].workingTime).toBe('Full time');
    expect(jobs[0].country).toBe('Taiwan Region');
    expect(jobs[0].company).toBe('Coach Netherlands B.V. - Taiwan Branch');
    expect(jobs[0].description).toMatch(/^Coach is a global fashion house/);
    expect(jobs[0].postedAt?.toISOString().slice(0, 10)).toBe('2026-09-04');
    expect(jobs[0].validThrough?.toISOString().slice(0, 10)).toBe('2026-09-12');
  });
});

import { attachWorkdayDescriptions } from './workday.js';
it('keeps the real Workday legal-entity field and its numeric code as replay evidence', async () => {
  const detail = {
    jobPostingInfo: { jobDescription: 'Role description', startDate: '2026-09-01' },
    hiringOrganization: { name: '30360 CONDE NAST (INDIA) PVT LTD - 30360' },
  };
  mockJson.mockResolvedValueOnce(detail as never);
  const [job] = await attachWorkdayDescriptions([{ externalId: 'R-24144', title: 'Senior Manager', url: 'https://condenast.wd115.myworkdayjobs.com/CondeCareers/job/example', raw: { externalPath: '/job/example' } }], 'https://condenast.wd115.myworkdayjobs.com/wday/cxs/condenast/CondeCareers');
  expect(job.raw).toEqual({ externalPath: '/job/example', detail });
  expect(job.employerEvidence).toEqual({ rawName: detail.hiringOrganization.name, path: 'detail.hiringOrganization.name', rule: 'LEADING_ENTITY_CODE_REMOVED' });
  expect(job.company).toBe('CONDE NAST (INDIA) PVT LTD - 30360');
});

it('preserves a failed detail as a hold instead of substituting the group employer', async () => {
  mockJson.mockRejectedValueOnce(new Error('HTTP 403 from Workday detail'));
  const [job] = await attachWorkdayDescriptions([{ externalId: 'JR12800', title: 'Sales Associate', url: 'https://tapestry.wd108.myworkdayjobs.com/Tapestry_Careers/job/example', raw: { externalPath: '/job/example' } }], 'https://tapestry.wd108.myworkdayjobs.com/wday/cxs/tapestry/Tapestry_Careers');
  expect(job.company).toBeUndefined();
  expect(job.publicationHold).toBe('WORKDAY_DETAIL_FETCH_FAILED');
  expect(job.raw).toMatchObject({ externalPath: '/job/example', detailFailure: { message: 'HTTP 403 from Workday detail' } });
});
it('distinguishes a successful detail without any employer field from a fetch failure', async () => {
  mockJson.mockResolvedValueOnce({ jobPostingInfo: { jobDescription: 'A posting without an employer claim' } } as never);
  const [job] = await attachWorkdayDescriptions([{ externalId: 'x', title: 'Sales Associate', url: 'https://example.com/job/x', raw: { externalPath: '/job/x' } }], 'https://example.com/wday/cxs/group/jobs');
  expect(job.publicationHold).toBe('WORKDAY_EMPLOYER_ABSENT_IN_DETAIL');
});

it('holds a replay without a detail path and clears only Workday holds after a successful retry', async () => {
  const base = { externalId: 'x', title: 'Sales Associate', url: 'https://example.com/job/x' };
  const [missing] = await attachWorkdayDescriptions([base], 'https://example.com/wday/cxs/group/jobs');
  expect(missing.publicationHold).toBe('WORKDAY_DETAIL_PATH_MISSING');
  expect(mockJson).not.toHaveBeenCalled();
  mockJson.mockResolvedValue({ jobPostingInfo: {}, hiringOrganization: { name: 'Coach Shanghai Limited 2' } } as never);
  const [retried, unrelated] = await attachWorkdayDescriptions([
    { ...base, raw: { externalPath: '/job/x' }, publicationHold: 'WORKDAY_DETAIL_FETCH_FAILED' },
    { ...base, raw: { externalPath: '/job/x' }, publicationHold: 'OTHER_IDENTITY_HOLD' },
  ], 'https://example.com/wday/cxs/group/jobs');
  expect(retried.publicationHold).toBeUndefined();
  expect(retried.company).toBe('Coach Shanghai Limited 2');
  expect(unrelated.publicationHold).toBe('OTHER_IDENTITY_HOLD');
});
