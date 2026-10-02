import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/http.js', async importOriginal => ({ ...await importOriginal<typeof import('../lib/http.js')>(),
  fetchJson: vi.fn(), fetchText: vi.fn() }));

import { fetchJson } from '../lib/http.js';
import { fetchAtsJobs } from './index.js';
import { finishIncrementalReading, INCREMENTAL_READING_POLICY, isKnownPosting, withIncrementalReading, withoutIncrementalReading } from '../lib/incrementalReading.js';

/**
 * D-517 — LA LECTURE INCRÉMENTALE, adaptateur par adaptateur. Chaque témoin pose d'abord sa prémisse : sans lecture
 * incrémentale, l'adaptateur lit le détail de CHAQUE publication de la liste (le coût que la passe ne peut pas payer
 * toutes les 6 heures) ; puis, dans une lecture incrémentale, il ne lit que le détail des publications inconnues, ne
 * rend qu'elles, et scelle les connues dans `knownSkipped`. Avant ce lot, aucun adaptateur ne savait le faire.
 */
const api = vi.mocked(fetchJson);
beforeEach(() => api.mockReset());
const urls = () => api.mock.calls.map(([url]) => String(url));

describe('D-517 — SmartRecruiters (H&M, Primark, Sandro…) : la liste, puis l’annonce des seules publications inconnues', () => {
  const config = { company: 'HMGroup' };
  beforeEach(() => api.mockImplementation(async (url: string) => String(url).includes('/postings?')
    ? { totalFound: 5, content: ['p0', 'p1', 'p2', 'p3', 'p4'].map(id => ({ id, name: `Sales Advisor ${id}`, releasedDate: '2026-10-02T08:00:00Z', location: { city: 'Paris', country: 'fr' } })) }
    : { jobAd: { sections: { jobDescription: { text: `<p>${'Description '.repeat(30)}</p>` } } } }));

  it('prémisse : sans lecture incrémentale, une annonce lue par publication', async () => {
    const result = await fetchAtsJobs('SMARTRECRUITERS', config);
    expect(result.jobs.map(job => job.externalId)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    expect(urls().filter(url => /postings\/p\d$/.test(url))).toHaveLength(5);
    expect(result.incremental).toBeUndefined();
  });

  it('lecture incrémentale : 2 annonces lues sur 5, 2 publications rendues, 3 connues scellées, jamais complète', async () => {
    const result = await withIncrementalReading(['p0', 'p1', 'p2'], () => fetchAtsJobs('SMARTRECRUITERS', config));
    expect(urls().filter(url => /postings\/p\d$/.test(url)).sort()).toEqual([
      'https://api.smartrecruiters.com/v1/companies/HMGroup/postings/p3', 'https://api.smartrecruiters.com/v1/companies/HMGroup/postings/p4']);
    expect(result.jobs.map(job => job.externalId)).toEqual(['p3', 'p4']);
    expect(result).toMatchObject({ complete: false, truncated: true, enumerationVerdict: 'REFUTED',
      incremental: { policy: INCREMENTAL_READING_POLICY, knownSkipped: ['p0', 'p1', 'p2'] } });
  });
});

describe('D-517 — Workday (Knitwell, Nordstrom, Tapestry, Swarovski…) : la liste, puis la fiche des seules publications inconnues', () => {
  const config = { tenant: 't', site: 's', origin: 'https://t.wd3.myworkdayjobs.com' };
  const posting = (id: number) => ({ title: `Sales ${id}`, externalPath: `/job/Paris/Sales_${id}`, locationsText: 'Paris', postedOn: 'Posted Today', bulletFields: [`R-${id}`] });
  beforeEach(() => api.mockImplementation(async (url: string) => String(url).endsWith('/jobs')
    ? { total: 4, jobPostings: [0, 1, 2, 3].map(posting) }
    : { jobPostingInfo: { jobDescription: `<p>${'Description '.repeat(30)}</p>`, startDate: '2026-10-02' }, hiringOrganization: { name: 'Knitwell' } }));
  const details = () => urls().filter(url => url.includes('/job/Paris/'));

  it('prémisse : sans lecture incrémentale, une fiche par publication', async () => {
    await fetchAtsJobs('WORKDAY', config);
    expect(details()).toHaveLength(4);
  });

  it('lecture incrémentale : une fiche lue (Sales_3), une publication rendue, la liste lue en entier', async () => {
    const result = await withIncrementalReading(['Sales_0', 'Sales_1', 'Sales_2'], () => fetchAtsJobs('WORKDAY', config));
    expect(details()).toEqual(['https://t.wd3.myworkdayjobs.com/wday/cxs/t/s/job/Paris/Sales_3']);
    expect(urls().filter(url => url.endsWith('/jobs')).length).toBeGreaterThan(0);
    expect(result.jobs.map(job => job.externalId)).toEqual(['Sales_3']);
    expect(result.incremental?.knownSkipped).toEqual(['Sales_0', 'Sales_1', 'Sales_2']);
    // Les connues laissées de côté sont une disposition nommée : le contrat des identifiants canoniques tient.
    expect(result.enumeration?.pageEvidence?.flatMap(page => page.canonicalIds ?? [])).toContain('Sales_0');
    expect(result.enumeration?.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
  });
});

describe('D-517 — Oracle HCM (Bloomingdale’s, Tiffany) : la réquisition des seules publications inconnues', () => {
  const ORIGIN = 'https://x.fa.oraclecloud.com';
  const row = (Id: string) => ({ Id, Title: `Sales ${Id}`, PostedDate: '2026-10-02', PrimaryLocation: 'Paris, France', PrimaryLocationCountry: 'FR' });
  beforeEach(() => api.mockImplementation(async (url: string) => String(url).includes('recruitingCEJobRequisitions?')
    ? { items: [{ TotalJobsCount: 3, requisitionList: ['R1', 'R2', 'R3'].map(row) }] }
    : { items: [{ ExternalDescriptionStr: `<p>${'Description '.repeat(30)}</p>` }] }));
  const details = () => urls().filter(url => url.includes('recruitingCEJobRequisitionDetails'));

  it('prémisse : une réquisition lue par publication ; en lecture incrémentale, seule l’inconnue', async () => {
    await fetchAtsJobs('ORACLE_HCM', { origin: ORIGIN, siteNumber: 'CX_1' });
    expect(details()).toHaveLength(3);
    api.mockClear();
    const result = await withIncrementalReading(['R1', 'R2'], () => fetchAtsJobs('ORACLE_HCM', { origin: ORIGIN, siteNumber: 'CX_1' }));
    expect(details()).toHaveLength(1);
    expect(details()[0]).toContain('R3');
    expect(result.jobs.map(job => job.externalId)).toEqual(['R3']);
  });
});

describe('D-517 — le filtre commun : une liste qui porte tout (Teamtailor, Jibe, LVMH) ne rend que le neuf', () => {
  const result = { jobs: ['a', 'b', 'c'].map(externalId => ({ externalId, title: 'Sales', url: `https://x/${externalId}` })), complete: true, truncated: false, declaredTotal: 3 };

  it('hors lecture incrémentale : rien ne change', async () => {
    expect(finishIncrementalReading(result)).toBe(result);
    expect(isKnownPosting('a')).toBe(false);
  });

  it('dans une lecture incrémentale : le neuf seul, jamais complet ni attestant, les connues triées et scellées', async () => {
    const out = await withIncrementalReading(['c', 'a', 'zz'], async () => finishIncrementalReading(result));
    expect(out.jobs.map(job => job.externalId)).toEqual(['b']);
    expect(out).toMatchObject({ complete: false, truncated: true, declaredTotal: 3, incremental: { knownSkipped: ['a', 'c'] } });
  });

  it('une lecture sans contexte, même appelée depuis une lecture en cours, lit tout (le rejeu d’une autre capture)', async () => {
    const out = await withIncrementalReading(['a'], () => withoutIncrementalReading(async () => finishIncrementalReading(result)));
    expect(out).toBe(result);
  });
});
