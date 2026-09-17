import { describe, expect, it, vi, beforeEach } from 'vitest';

// The adapter fetches over HTTP; mock the layer and drive one campaign with the
// exact numeric shapes TalentView returned live (currency 1, remote 1).
vi.mock('../../lib/http.js', () => ({
  fetchJson: vi.fn(),
  fetchText: vi.fn(),
}));

import { fetchJson } from '../../lib/http.js';
import { fetchTalentViewJobs } from './talentview.js';
import { readSourceFacts } from '../../facts/index.js';
import { normalizeAdapterResult } from '../index.js';

const mockJson = vi.mocked(fetchJson);

beforeEach(() => mockJson.mockReset());

/**
 * Regression for the live "Argument `salaryCurrency`/`remote`: Expected String,
 * provided Int" that failed every TalentView write (Jules, Promod, Baccarat).
 * TalentView sends numeric IDs where the columns are strings.
 */
describe('TalentView native evidence reaches the qualified readers', () => {
  it('preserves currency 1 and remote 1, which the publisher defines as EUR and occasional remote', async () => {
    // The adapter calls fetchJson three times: websites, campaigns, then detail.
    mockJson
      .mockResolvedValueOnce([{ id: 3038 }] as never) // websites
      .mockResolvedValueOnce([{ id: 42, name: 'Vendeur', slug: 'vendeur', address: { city: 'Paris' } }] as never) // campaigns
      .mockResolvedValueOnce({ id: 42, slug: 'vendeur', is_draft: false, is_online: true, salary_min: 26500, salary_max: 28000, salary_currency: 1, remote_level: 1 } as never); // detail

    const { jobs } = await fetchTalentViewJobs({ slug: 'baccarat' });

    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    const facts = readSourceFacts('talentview', job.raw);
    expect(facts.salary.value?.bands[0]).toMatchObject({ min: '26500', max: '28000', currency: 'EUR', period: null });
    expect(facts.workplace.value?.modes).toEqual(['OCCASIONAL_REMOTE']);

  });

  it('drops an unknown numeric currency id rather than storing a bare number', async () => {
    mockJson
      .mockResolvedValueOnce([{ id: 1 }] as never)
      .mockResolvedValueOnce([{ id: 7, name: 'Stage', slug: 'stage' }] as never)
      .mockResolvedValueOnce({ id: 7, slug: 'stage', is_draft: false, is_online: true, salary_min: 100, salary_currency: 999, remote_level: 999 } as never);

    const { jobs: [job] } = await fetchTalentViewJobs({ slug: 'x' });
    const facts = readSourceFacts('talentview', job.raw);
    expect(facts.salary.value?.bands[0].currency).toBeNull();
    expect(facts.salary.issues).toContain('UNINTERPRETED_CURRENCY');
    expect(facts.workplace.status).toBe('UNINTERPRETED');
  });
});

import { readFileSync } from 'node:fs';
const pages = JSON.parse(readFileSync(new URL('./__fixtures__/talentview-sud-express-pages.json', import.meta.url), 'utf8'));

describe('TalentView public pagination, real Sud Express payloads', () => {
  it('reads 68 jobs across seven pages instead of silently returning the first ten', async () => {
    mockJson.mockResolvedValueOnce([{ id: 11 }]);
    for (const page of pages) mockJson.mockResolvedValueOnce(page.jobs);
    const result = await fetchTalentViewJobs({ slug: 'sud-express', withDescriptions: false });
    expect(result.jobs).toHaveLength(68);
    expect(new Set(result.jobs.map(j => j.externalId)).size).toBe(68);
    expect(result).toMatchObject({ complete: true, truncated: false });
    expect(result.declaredTotal).toBeUndefined();
    expect(mockJson.mock.calls.slice(1).map(c => new URL(c[0]).searchParams.get('offset_start'))).toEqual(['1','2','3','4','5','6','7']);
    for (const [url] of mockJson.mock.calls.slice(1)) expect([...new URL(url).searchParams.keys()]).toEqual(['company_website_id','display_mode','offset_start']);
  });
  it('requires a terminal page and does not attest a page cap or a repeating page', async () => {
    mockJson.mockResolvedValueOnce([{id:11}]).mockResolvedValueOnce(pages[0].jobs);
    expect(await fetchTalentViewJobs({slug:'sud-express',maxPages:1,withDescriptions:false})).toMatchObject({complete:false,truncated:true});
    mockJson.mockReset().mockResolvedValueOnce([{id:11}]).mockResolvedValueOnce(pages[0].jobs).mockResolvedValueOnce(pages[0].jobs);
    const result=await fetchTalentViewJobs({slug:'sud-express',withDescriptions:false});
    expect(result).toMatchObject({complete:false,truncated:true});expect(result.jobs).toHaveLength(10);
  });
  it('reads every public website and merges shared campaign IDs only after each list completes', async () => {
    mockJson.mockResolvedValueOnce([{id:11,locale:'fr'},{id:12,locale:'en'}])
      .mockResolvedValueOnce(pages[6].jobs).mockResolvedValueOnce([pages[6].jobs[0],pages[0].jobs[0]]);
    const result=await fetchTalentViewJobs({slug:'sud-express',withDescriptions:false});
    expect(result.jobs).toHaveLength(9);expect(result.complete).toBe(true);
    expect(mockJson.mock.calls.slice(1).map(c=>new URL(c[0]).searchParams.get('company_website_id'))).toEqual(['11','12']);
  });
  it('does not accept malformed payloads, invalid campaigns or a mid-pagination error as completion', async () => {
    for(const bad of [{error:'unavailable'},[{}]]){
      mockJson.mockReset().mockResolvedValueOnce([{id:11}]).mockResolvedValueOnce(bad);
      await expect(fetchTalentViewJobs({slug:'sud-express',withDescriptions:false})).rejects.toThrow(/malformed|invalid/);
    }
    mockJson.mockReset().mockResolvedValueOnce([{id:11}]).mockResolvedValueOnce(pages[0].jobs).mockRejectedValueOnce(new Error('HTTP 503'));
    await expect(fetchTalentViewJobs({slug:'sud-express',withDescriptions:false})).rejects.toThrow('HTTP 503');
  });
  it('rejects invalid website inventories and configuration', async () => {
    for(const bad of [[],{},[{}],[{id:11},{id:11}]]) {
      mockJson.mockReset().mockResolvedValueOnce(bad);
      await expect(fetchTalentViewJobs({slug:'sud-express',withDescriptions:false})).rejects.toThrow();
    }
    mockJson.mockReset().mockResolvedValueOnce([{id:11}]);
    await expect(fetchTalentViewJobs({slug:'sud-express',maxPages:0})).rejects.toThrow('maxPages');
  });
});

it('preserves an entity label without turning a business unit into a company', async () => {
  mockJson.mockResolvedValueOnce([{ id: 3038 }])
    .mockResolvedValueOnce([{ id: 42, name: 'Vendeur', slug: 'vendeur', entity: { id: 598, name: 'Promod - magasin' } }])
    .mockResolvedValueOnce({ id: 42, slug: 'vendeur', is_draft: false, is_online: true });
  const { jobs: [job] } = await fetchTalentViewJobs({ slug: 'promodjob' });
  expect(job.company).toBeUndefined();
  expect(job.employerEvidence).toEqual({ rawName: 'Promod - magasin', path: 'entity.name', rule: 'ENTITY_LABEL_REQUIRES_IDENTITY_RESOLUTION' });
});

describe('TalentView detail identity and visibility', () => {
  const list = { id: 42, name: 'Advisor', slug: 'advisor' };
  const detail = { id: 42, slug: 'advisor', is_draft: false, is_online: true, description: '<p>Own duties</p>', profile: '<p>Own requirements</p>' };
  it('reads both native sections through the live collector', async () => {
    mockJson.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([list]).mockResolvedValueOnce(detail);
    const { jobs: [job] } = await fetchTalentViewJobs({ slug: 'brand' });
    expect(job.description).toBe('Own duties\n\nOwn requirements');
    expect(job.raw).toEqual({ ...list, detail });
    expect(job.publicationHold).toBeUndefined();
  });
  it.each([{ ...detail, id: 43 }, { ...detail, slug: 'other' }, { ...detail, id: undefined }])('refuses an unrelated detail instead of accepting it as listing content', async input => {
    mockJson.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([list]).mockResolvedValueOnce(input);
    await expect(fetchTalentViewJobs({ slug: 'brand' })).rejects.toThrow('DETAIL_IDENTITY_MISMATCH');
  });
  it.each([{ ...detail, is_draft: true }, { ...detail, is_online: false }, { ...detail, is_online: undefined }])('holds draft, offline or unknown states', async input => {
    mockJson.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([list]).mockResolvedValueOnce(input);
    const { jobs: [job] } = await fetchTalentViewJobs({ slug: 'brand' });
    expect(job.publicationHold).toBeTruthy();
    expect(job.raw).toEqual({ ...list, detail: input });
  });
});

/**
 * LE CONTRAT DES IDENTIFIANTS CANONIQUES.
 *
 * `campaign.id` est l'identifiant natif de TalentView, et le chemin exact de `externalId`. La preuve le
 * déclare sur CHAQUE page de CHAQUE site public — une seule page muette et le contrat devient PARTIEL, ce que
 * le normaliseur refuse. Le témoin passe au rouge si `canonicalIds` est retiré.
 */
describe('TalentView — contrat des identifiants canoniques', () => {
  it('déclare canonicalIds sur les sept pages, exactement les campaign.id écrits', async () => {
    mockJson.mockResolvedValueOnce([{ id: 11 }]);
    for (const page of pages) mockJson.mockResolvedValueOnce(page.jobs);
    const r = await fetchTalentViewJobs({ slug: 'sud-express', withDescriptions: false });

    const evidence = r.enumeration!.pageEvidence!;
    expect(evidence).toHaveLength(7);
    for (const pe of evidence) expect(Object.hasOwn(pe, 'canonicalIds')).toBe(true);
    expect(r.enumeration!.canonicalAbsenceProofUsable).toBe(true);

    const canonical = new Set(evidence.flatMap(pe => pe.canonicalIds ?? []));
    expect(canonical.size).toBe(68);
    expect([...canonical].sort()).toEqual(r.jobs.map(j => j.externalId).sort());

    const n = normalizeAdapterResult(r);
    expect(n.enumeration?.canonicalIdViolations).toBeUndefined();
    expect(n.enumeration?.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
  });

  it('une campagne servie par DEUX sites locale figure dans la preuve des deux', async () => {
    mockJson.mockResolvedValueOnce([{ id: 11, locale: 'fr' }, { id: 12, locale: 'en' }])
      .mockResolvedValueOnce(pages[6].jobs).mockResolvedValueOnce([pages[6].jobs[0], pages[0].jobs[0]]);
    const r = await fetchTalentViewJobs({ slug: 'sud-express', withDescriptions: false });

    const evidence = r.enumeration!.pageEvidence!;
    expect(evidence).toHaveLength(2);
    const partagee = String(pages[6].jobs[0].id);
    // Vue sur les deux sites : la retirer de la seconde page la rendrait muette sur une offre bien servie.
    expect(evidence[0].canonicalIds).toContain(partagee);
    expect(evidence[1].canonicalIds).toContain(partagee);
    expect(new Set(evidence.flatMap(pe => pe.canonicalIds ?? [])).size).toBe(r.jobs.length);
    expect(normalizeAdapterResult(r).enumeration?.canonicalIdViolations).toBeUndefined();
  });

  it("une offre RETENUE (brouillon) reste une disposition nommée, pas un trou", async () => {
    const list = { id: 42, name: 'Advisor', slug: 'advisor' };
    mockJson.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([list])
      .mockResolvedValueOnce({ id: 42, slug: 'advisor', is_draft: true, is_online: true });
    const r = await fetchTalentViewJobs({ slug: 'brand' });

    expect(r.jobs[0].publicationHold).toBeTruthy();
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual(['42']);
    expect(normalizeAdapterResult(r).enumeration?.canonicalIdViolations).toBeUndefined();
  });
});
