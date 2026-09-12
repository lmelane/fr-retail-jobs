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

import { brandFromWorkdayDetail, brandFromLogoAlt } from './workday.js';

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

/**
 * Non-regression for the UNIQLO HK/Macau defect (2026-09-10): a detail WITHOUT an employer used to be dropped
 * whole, so the posting also lost the date, country, location and description the SAME document carried.
 * Two postings of uniqlo-hkm-headquarters kept `jobPostingInfo.startDate` in their archived raw while postedAt,
 * countryCode, city and description were all null. Identity and facts are distinct concerns: the hold stays
 * (nothing is published without a proven employer), the descriptive fields are applied.
 */
it('applies the detail facts even when the employer is absent, and keeps the hold', async () => {
  mockJson.mockResolvedValueOnce({
    jobPostingInfo: {
      jobDescription: '<p>Part-Time Clerk duties</p>',
      startDate: '2026-07-29',
      endDate: '2026-10-29',
      country: { descriptor: 'Hong Kong' },
      location: 'Hong Kong-Tsim Sha Tsui-UQHK',
      timeType: 'Part time',
    },
  } as never);
  const [job] = await attachWorkdayDescriptions(
    [{ externalId: 'R00000004162321', title: 'Part-Time Clerk', url: 'https://uniqlo.example/job/x', raw: { externalPath: '/job/x', postedOn: 'Posted 30+ Days Ago' } }],
    'https://uniqlo.example/wday/cxs/uniqlo/jobs',
  );
  // The identity guard is untouched: no employer claimed, posting still held.
  expect(job.publicationHold).toBe('WORKDAY_EMPLOYER_ABSENT_IN_DETAIL');
  expect(job.company).toBeUndefined();
  // …but the facts of the very same document are no longer thrown away.
  expect(job.postedAt?.toISOString().slice(0, 10)).toBe('2026-07-29');
  expect(job.validThrough?.toISOString().slice(0, 10)).toBe('2026-10-29');
  expect(job.country).toBe('Hong Kong');
  expect(job.location).toBe('Hong Kong-Tsim Sha Tsui-UQHK');
  expect(job.workingTime).toBe('Part time');
  expect(job.description).toMatch(/Part-Time Clerk duties/);
});

it('does not invent a date when the employer-less detail has none', async () => {
  mockJson.mockResolvedValueOnce({ jobPostingInfo: { jobDescription: 'No dates here' } } as never);
  const [job] = await attachWorkdayDescriptions(
    [{ externalId: 'y', title: 'Clerk', url: 'https://example.com/job/y', raw: { externalPath: '/job/y', postedOn: 'Posted 30+ Days Ago' } }],
    'https://example.com/wday/cxs/group/jobs',
  );
  expect(job.publicationHold).toBe('WORKDAY_EMPLOYER_ABSENT_IN_DETAIL');
  expect(job.postedAt).toBeUndefined();
  expect(job.validThrough).toBeUndefined();
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

describe('brandFromLogoAlt — the word "logo" belongs to the image, not the employer', () => {
  it('strips a leading or trailing "logo" whatever its case, keeps the brand otherwise intact', () => {
    expect(brandFromLogoAlt('Cartier Logo')).toBe('Cartier'); expect(brandFromLogoAlt('Richemont Logo')).toBe('Richemont');
    // KnitWell (2026-09-10): a file-name-like alt with underscores and image dimensions — the brand is Off The Rax, never the token.
    expect(brandFromLogoAlt('Off_The_Rax_LOGO300x300')).toBe('Off The Rax'); expect(brandFromLogoAlt('LOGO300x300')).toBeUndefined(); expect(brandFromLogoAlt('Dr. Jart+ Logo')).toBe('Dr. Jart+');
    expect(brandFromLogoAlt('Logo Pierre Fabre')).toBe('Pierre Fabre'); expect(brandFromLogoAlt('Jaeger LeCoultre logo')).toBe('Jaeger LeCoultre'); expect(brandFromLogoAlt('HOKA Logo')).toBe('HOKA');
    expect(brandFromLogoAlt('Van Cleef & Arpels')).toBe('Van Cleef & Arpels');
  });
  it('never returns an empty brand', () => { expect(brandFromLogoAlt('Logo')).toBeUndefined(); expect(brandFromLogoAlt('  ')).toBeUndefined(); expect(brandFromLogoAlt(undefined)).toBeUndefined(); });
  it('gives the identity gate the same cleaned brand as the company (lot L3 refused "HOKA Logo" while company read "HOKA")', async () => {
    mockJson.mockResolvedValueOnce({ jobPostingInfo: { jobDescription: 'Role', logoImage: { alt: 'HOKA Logo' } }, hiringOrganization: { name: 'Deckers Outdoor Corporation' } } as never);
    const [job] = await attachWorkdayDescriptions([{ externalId: 'x', title: 'Sales Associate', url: 'https://example.com/job/x', raw: { externalPath: '/job/x' } }], 'https://example.com/wday/cxs/deckers/jobs');
    expect(job.company).toBe('HOKA');
    expect(job.employerEvidence).toEqual({ rawName: 'HOKA', path: 'detail.jobPostingInfo.logoImage.alt', rule: 'LOGO_ALT_WORD_REMOVED' });
  });
  it('keeps LOGO_ALT verbatim when the alt is the brand alone, and falls back to the legal entity when the alt is only "Logo"', async () => {
    mockJson.mockResolvedValueOnce({ jobPostingInfo: { jobDescription: 'Role', logoImage: { alt: 'Panerai' } }, hiringOrganization: { name: 'C170 Officine Panerai' } } as never);
    const [brand] = await attachWorkdayDescriptions([{ externalId: 'a', title: 'T', url: 'https://example.com/job/a', raw: { externalPath: '/job/a' } }], 'https://example.com/wday/cxs/r/jobs');
    expect(brand.employerEvidence).toEqual({ rawName: 'Panerai', path: 'detail.jobPostingInfo.logoImage.alt', rule: 'LOGO_ALT' });
    mockJson.mockResolvedValueOnce({ jobPostingInfo: { jobDescription: 'Role', logoImage: { alt: 'Logo' } }, hiringOrganization: { name: 'C170 Officine Panerai' } } as never);
    const [legal] = await attachWorkdayDescriptions([{ externalId: 'b', title: 'T', url: 'https://example.com/job/b', raw: { externalPath: '/job/b' } }], 'https://example.com/wday/cxs/r/jobs');
    expect(legal.company).toBe('Officine Panerai');
    expect(legal.employerEvidence).toEqual({ rawName: 'C170 Officine Panerai', path: 'detail.hiringOrganization.name', rule: 'LEADING_ENTITY_CODE_REMOVED' });
  });
});

/**
 * LE CONTRAT CANONIQUE — MECCA et les autres tenants Workday.
 *
 * `ids` EST déjà l'identifiant canonique : `externalPath.split('/').pop()` alimente à la fois `take()`, donc
 * `NormalizedJob.externalId`, et la preuve de page. La correction consiste à le DÉCLARER, jamais à le
 * recalculer par un autre chemin — deux expressions finiraient par diverger.
 */
describe('fetchWorkdayJobs — identifiants canoniques dans la preuve', () => {
  it('déclare canonicalIds, exactement les externalId écrits', async () => {
    mockJson.mockResolvedValueOnce({
      total: 2,
      jobPostings: [
        { title: 'Zone Manager', externalPath: '/job/Ponsonby/Zone-Manager_R015582' },
        { title: 'Host', externalPath: '/job/Queenstown/Host_R014994' },
      ],
    } as never);

    const r = await fetchWorkdayJobs({
      tenant: 'mecca', site: 'careers', origin: 'https://mecca.wd3.myworkdayjobs.com', withDescriptions: false,
    });

    const canonical = r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []);
    expect(canonical).toEqual(['Zone-Manager_R015582', 'Host_R014994']);
    expect(r.jobs.map((j) => j.externalId).sort()).toEqual([...canonical].sort());
    expect(r.enumeration?.canonicalIdViolations).toBeUndefined();
  });

  /**
   * A. Une ligne SANS `externalPath` n'a aucun identifiant : elle ne peut pas figurer dans la preuve canonique,
   * et il est INTERDIT d'en fabriquer un depuis le titre ou un hachage. Conséquence : le parcours peut être
   * complet alors que l'attestation d'absence est refusée — un identifiant historique disparu pourrait être
   * précisément cette ligne anonyme.
   */
  it('A. une ligne sans externalPath : offre identifiable produite, mais absence NON attestable', async () => {
    mockJson.mockResolvedValueOnce({
      total: 2,
      jobPostings: [
        { title: 'Vendeur', externalPath: '/job/Paris/Vendeur_R-123' },
        { title: 'Ghost row', locationsText: 'Nowhere' },
      ],
    } as never);

    const r = await fetchWorkdayJobs({
      tenant: 'richemont', site: 'richemont', origin: 'https://richemont.wd3.myworkdayjobs.com',
      withDescriptions: false,
    });

    const canonical = r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []);
    expect(canonical).toEqual(['Vendeur_R-123']);
    expect(r.jobs.map((j) => j.externalId)).toEqual(['Vendeur_R-123']);   // l'offre identifiable est produite
    expect(r.rejectedRows?.some((x) => x.reason === 'ROW_WITHOUT_EXTERNAL_PATH')).toBe(true);
    expect(r.enumeration?.canonicalIdViolations).toBeUndefined();
    // LE VERDICT QUI MANQUAIT : le parcours ne suffit pas, l'absence n'est pas démontrable.
    expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(false);
  });

  /** B. Toutes les lignes identifiables : la preuve d'absence est exploitable. */
  it('B. toutes les lignes ont un externalPath : preuve canonique exploitable', async () => {
    mockJson.mockResolvedValueOnce({
      total: 1, jobPostings: [{ title: 'Vendeur', externalPath: '/job/Paris/Vendeur_R-123' }],
    } as never);
    const r = await fetchWorkdayJobs({
      tenant: 'mecca', site: 'careers', origin: 'https://mecca.wd3.myworkdayjobs.com', withDescriptions: false,
    });
    expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(true);
  });

  /** C. Board réellement vide, terminaison prouvée : preuve vide mais EXPLOITABLE. */
  it('C. board vide et terminaison prouvée : preuve canonique vide mais exploitable', async () => {
    mockJson.mockResolvedValueOnce({ total: 0, jobPostings: [] } as never);
    const r = await fetchWorkdayJobs({
      tenant: 'mecca', site: 'careers', origin: 'https://mecca.wd3.myworkdayjobs.com', withDescriptions: false,
    });
    expect(r.jobs).toEqual([]);
    expect(r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? [])).toEqual([]);
    expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(true);
  });
});
