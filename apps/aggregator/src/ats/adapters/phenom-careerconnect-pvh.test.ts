import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));
import { fetchJson } from '../../lib/http.js';
import { careerConnectOptions, careerConnectRequest, enrichFromJobPosting, fetchPhenomJobs, parseCareerConnectJob, type CareerConnectJob } from './phenom.js';
import { recoverRetainedPublication } from '../../publication/recovery.js';
import pvh from './fixtures/phenom-careerconnect-pvh-20260930.json' with { type: 'json' };

/**
 * PVH (D-481 §4, 30/09/2026) : careers.pvh.com est un portail Phenom CareerConnect.
 *
 * Deux index répondent au même `POST /widgets`. L'index `en` / `global`, celui que le lecteur demandait par défaut, est
 * FIGÉ : 1 644 offres créées entre 2018 et 2024, aucune ne porte de marque. Le site `/us/en` interroge `en_us` / `us`
 * (valeurs de sa propre page de recherche) : 1 574 offres courantes, chacune avec sa marque publiée (`brand`, le filtre
 * « Company » du site) — Tommy Hilfiger 866, Calvin Klein 579, PVH 129. Les entrées de la fixture sont servies telles
 * quelles par ces deux index le 30/09.
 */
const origin = 'https://careers.pvh.com';
const config = { origin, dialect: 'CAREER_CONNECT_WIDGETS', localePath: 'us/en', widgetsLang: 'en_us', widgetsCountry: 'us', brandField: 'brand' };
const siteJobs = pvh.site.jobs as unknown as (CareerConnectJob & { brand: string; jobId: string })[];
const read = (entry: CareerConnectJob, options = careerConnectOptions(config)) => parseCareerConnectJob(entry, origin, options)!;
const recover = (raw: unknown, url: string, externalId: string) =>
  recoverRetainedPublication('phenom', raw, { externalId, url, observedAt: new Date('2026-09-30T05:00:00Z'), config });

describe('PVH : la marque publiée sur l\'offre est l\'employeur', () => {
  it('prémisse : les entrées ne nomment aucun employeur hors de leur champ de marque', () => {
    expect(siteJobs.map((job) => job.brand)).toEqual(['Calvin Klein', 'Tommy Hilfiger', 'PVH']);
    for (const entry of siteJobs) {
      expect((entry as { companyName?: unknown }).companyName).toBeUndefined();
      // Sans le champ de marque déclaré, l'offre n'a pas d'employeur : elle retomberait sur le libellé du registre.
      expect(parseCareerConnectJob(entry, origin, { localePath: 'us/en' })!.company).toBeUndefined();
    }
  });

  it('chaque offre publie sous sa marque, avec sa preuve, à l\'adresse publique du site', () => {
    for (const entry of siteJobs) {
      const job = read(entry);
      expect(job.company).toBe(entry.brand);
      expect(job.employerEvidence).toEqual({ rawName: entry.brand, path: 'listing.brand', rule: 'CONFIGURED_BRAND_PROPERTY' });
      expect(job.url).toMatch(new RegExp(`^https://careers\\.pvh\\.com/us/en/job/${entry.jobId}/[a-z0-9-]+$`));
      expect(job.raw).toEqual(entry);
    }
    // La marque passe avant l'entité juridique quand l'offre porte les deux ; une valeur vide ne remplace rien.
    expect(read({ ...siteJobs[0], companyName: 'PVH France SAS' })).toMatchObject({ company: 'Calvin Klein', employerEvidence: { path: 'listing.brand' } });
    expect(read({ ...siteJobs[0], brand: '  ', companyName: 'PVH France SAS' } as CareerConnectJob)).toMatchObject({ company: 'PVH France SAS', employerEvidence: { path: 'companyName' } });
  });

  it('la fiche publique complète la description sans remplacer la marque par l\'entité juridique', () => {
    const detail = JSON.parse(pvh.detailJobPosting) as { identifier: { value: string }; hiringOrganization: { name: string } };
    // Prémisse : le JSON-LD de la fiche nomme l'entité juridique, pas la marque.
    expect(detail.hiringOrganization.name).toBe('PVH France SAS');
    expect(detail.identifier.value).toBe(siteJobs[0].jobId);
    const listed = read(siteJobs[0]);
    const enriched = enrichFromJobPosting(listed, `<script type="application/ld+json">${pvh.detailJobPosting}</script>`, siteJobs[0].jobId);
    expect(enriched.description!.length).toBeGreaterThan(listed.description!.length);
    expect(enriched.company).toBe('Calvin Klein');
    expect(enriched.employerEvidence).toEqual(listed.employerEvidence);
    expect((enriched.raw as { postingEvidence?: unknown }).postingEvidence).toBeDefined();
    // La relecture hors réseau de ce RAW retenu rend la même offre, fiche comprise.
    expect(recover(enriched.raw, enriched.url, enriched.externalId)).toMatchObject({ status: 'RECOVERABLE',
      job: { company: 'Calvin Klein', employerEvidence: listed.employerEvidence, description: enriched.description } });
  });

  it('la relecture hors réseau du RAW retenu rend la même marque que la collecte', () => {
    for (const entry of siteJobs) {
      const job = read(entry);
      expect(recover(entry, job.url, job.externalId)).toMatchObject({ status: 'RECOVERABLE', job: { company: entry.brand, employerEvidence: job.employerEvidence } });
    }
    // Des réglages illisibles ne se relisent pas au hasard.
    expect(recoverRetainedPublication('phenom', siteJobs[0], { externalId: siteJobs[0].jobSeqNo!, url: read(siteJobs[0]).url, observedAt: new Date(),
      config: { ...config, widgetsCountry: 'united states' } })).toMatchObject({ reason: 'READER_UNQUALIFIED' });
  });
});

describe('PVH : la requête est celle du site, et le décompte par marque prouve l\'attribution', () => {
  beforeEach(() => vi.resetAllMocks());
  const response = (jobs: unknown[], totalHits: number, brandFacet?: Record<string, number>) => ({ refineSearch: { totalHits, data: { jobs,
    aggregations: [{ field: 'country', value: { France: totalHits } }, ...(brandFacet ? [{ field: 'brand', value: brandFacet }] : [])] } } });
  const listingOnly = { ...config, localePath: undefined };
  const bodyOf = (call: number) => JSON.parse(String((vi.mocked(fetchJson).mock.calls[call]![1] as { body: string }).body));

  it('interroge l\'index du site (en_us, us) et demande la facette de marque ; sans réglage, la requête historique ne change pas', () => {
    expect(careerConnectRequest(origin, { from: 0, size: 500 }).body).toMatchObject({ lang: 'en', country: 'global', all_fields: ['category', 'country', 'state', 'city'] });
    expect(careerConnectRequest(origin, { from: 0, size: 500 }, careerConnectOptions(config)).body)
      .toMatchObject({ lang: 'en_us', country: 'us', all_fields: ['category', 'country', 'state', 'city', 'brand'] });
    expect(careerConnectOptions({ origin })).toEqual({ localePath: undefined, lang: 'en', country: 'global' });
    for (const bad of [{ widgetsLang: 'en-US; drop' }, { widgetsCountry: 'united states' }, { brandField: 'brand.name' }])
      expect(() => careerConnectOptions({ ...config, ...bad })).toThrow(/CareerConnect/);
  });

  it('chaque marque lue compte exactement ce que l\'éditeur annonce : le parcours est prouvé', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(response(siteJobs, 3, { 'Tommy Hilfiger': 1, 'Calvin Klein': 1, PVH: 1 }));
    const r = await fetchPhenomJobs(listingOnly);
    expect(bodyOf(0)).toMatchObject({ lang: 'en_us', country: 'us', all_fields: expect.arrayContaining(['brand']) });
    expect(r.jobs.map((job) => job.company)).toEqual(['Calvin Klein', 'Tommy Hilfiger', 'PVH']);
    expect(r.complete).toBe(true);
    expect(r.enumeration?.issues).toEqual([]);
    expect(r.enumeration?.scopes).toEqual(expect.arrayContaining([
      { scope: 'brand=Calvin Klein', declaredTotal: 1, uniqueIds: 1, pages: 1, complete: true },
      { scope: 'brand=PVH', declaredTotal: 1, uniqueIds: 1, pages: 1, complete: true }]));
  });

  it('une marque dont le décompte diffère de l\'annonce refuse la preuve, et l\'écart est nommé', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(response(siteJobs, 3, { 'Tommy Hilfiger': 1, 'Calvin Klein': 2 }));
    const r = await fetchPhenomJobs(listingOnly);
    // Prémisse : le total annoncé est atteint, seule l'attribution diffère.
    expect(r.jobs).toHaveLength(3); expect(r.enumeration?.termination).toBe('ANNOUNCED_TOTAL_REACHED');
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toEqual(expect.arrayContaining(['BRAND_FACET_COUNT_MISMATCH', 'ENUMERATION_NOT_PROVEN']));
    expect(r.enumeration?.scopes).toContainEqual({ scope: 'brand=Calvin Klein', declaredTotal: 2, uniqueIds: 1, pages: 1, complete: false });
  });

  it('l\'index figé (en, global) ne porte aucune marque : rien n\'est attribué, rien n\'est prouvé', async () => {
    const stale = pvh.globalIndex.jobs as unknown as CareerConnectJob[];
    expect((stale[0] as { brand?: unknown }).brand).toBeUndefined();
    expect(stale[0].dateCreated).toMatch(/^2023-/);
    vi.mocked(fetchJson).mockResolvedValueOnce(response(stale, 1, { 'Tommy Hilfiger': 1 }));
    const r = await fetchPhenomJobs(listingOnly);
    expect(r.jobs[0].company).toBeUndefined();
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toContain('BRAND_FACET_COUNT_MISMATCH');
    expect(r.enumeration?.scopes).toContainEqual({ scope: 'brand:absent', declaredTotal: 0, uniqueIds: 1, pages: 1, complete: false });
  });

  it('une réponse sans la facette de marque ne peut rien prouver de l\'attribution', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(response(siteJobs, 3));
    const r = await fetchPhenomJobs(listingOnly);
    expect(r.jobs.map((job) => job.company)).toEqual(['Calvin Klein', 'Tommy Hilfiger', 'PVH']);
    expect(r.complete).toBe(false);
    expect(r.enumeration?.issues).toContain('BRAND_FACET_ABSENT');
  });

  it('sans champ de marque déclaré (Hugo Boss, Skechers), ni facette ni preuve d\'attribution ne sont demandées', async () => {
    vi.mocked(fetchJson).mockResolvedValueOnce(response(siteJobs, 3));
    const r = await fetchPhenomJobs({ origin, dialect: 'CAREER_CONNECT_WIDGETS' });
    expect(bodyOf(0)).toMatchObject({ lang: 'en', country: 'global', all_fields: ['category', 'country', 'state', 'city'] });
    expect(r.complete).toBe(true);
    expect(r.enumeration?.scopes).toHaveLength(1);
    expect(r.jobs.every((job) => job.company === undefined)).toBe(true);
  });
});
