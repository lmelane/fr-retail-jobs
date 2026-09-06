import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));

import { fetchJson } from '../../lib/http.js';
import { DEFAULT_SECTORS, fetchWttjSectorJobs, listOrganizations } from './wttjSector.js';

const mockJson = vi.mocked(fetchJson);
beforeEach(() => mockJson.mockReset());

/**
 * Capturé le 2026-09-06 : la réponse facette de l'index WTTJ pour le filtre
 * sectoriel (2 357 offres, 156 organisations, ramenée à trois pour le test),
 * un hit Hermès tel que l'index le rend, et la même forme pour le Ritz.
 */
const FIXTURE = JSON.parse(readFileSync(new URL('./__fixtures__/w1-wttj-sector.json', import.meta.url), 'utf8'));

const bodyOf = (call: number) => JSON.parse(String(mockJson.mock.calls[call][1]?.body));

describe('fetchWttjSectorJobs — un secteur = ses organisations, lues une à une', () => {
  it('liste les organisations par facette puis lit chacune comme wttj.ts (même externalId, même URL, même company)', async () => {
    mockJson
      .mockResolvedValueOnce(FIXTURE.facetResponse)
      // diptyque-paris, hermes, ritz-paris — dans l'ordre alphabétique
      .mockResolvedValueOnce({ hits: [], nbHits: 0 })
      .mockResolvedValueOnce(FIXTURE.hermesPage)
      .mockResolvedValueOnce(FIXTURE.ritzPage);

    const { jobs, declaredTotal, truncated } = await fetchWttjSectorJobs({ withDescriptions: false });

    // La facette : filtre OR sur les cinq sous-secteurs, valeurs citées, 0 hit demandé.
    const facet = bodyOf(0);
    expect(facet.hitsPerPage).toBe(0);
    expect(facet.facets).toContain('organization.slug');
    for (const sector of DEFAULT_SECTORS) expect(facet.filters).toContain(`sectors.reference:"${sector}"`);

    // Puis une requête par organisation, avec le slug cité — la forme exacte de wttj.ts.
    expect(bodyOf(1).filters).toBe('organization.slug:"diptyque-paris"');
    expect(bodyOf(2).filters).toBe('organization.slug:"hermes"');
    expect(bodyOf(3).filters).toBe('organization.slug:"ritz-paris"');

    expect(jobs).toHaveLength(2);
    const hermes = jobs.find((j) => j.company === 'Hermès')!;
    expect(hermes.externalId).toBe(FIXTURE.hermesPage.hits[0].reference);
    expect(hermes.url).toBe(`https://www.welcometothejungle.com/fr/companies/hermes/jobs/${FIXTURE.hermesPage.hits[0].slug}`);
    expect(hermes.country).toBe('France');
    expect(hermes.city).toBe('Chessy');
    expect(jobs.find((j) => j.company === 'Ritz Paris')).toBeDefined();
    expect(declaredTotal).toBe(2);
    expect(truncated).toBe(false);
  });

  it('écarte les organisations exclues et ajoute celles imposées par la config', async () => {
    mockJson
      .mockResolvedValueOnce(FIXTURE.facetResponse)
      // charlotte-tilbury (ajoutée), diptyque-paris, hermes — ritz-paris exclu
      .mockResolvedValueOnce({ hits: [], nbHits: 0 })
      .mockResolvedValueOnce({ hits: [], nbHits: 0 })
      .mockResolvedValueOnce(FIXTURE.hermesPage);

    const { jobs } = await fetchWttjSectorJobs({
      withDescriptions: false,
      organizations: ['charlotte-tilbury'],
      excludeOrganizations: 'ritz-paris',
    });

    expect(mockJson).toHaveBeenCalledTimes(4);
    expect(bodyOf(1).filters).toBe('organization.slug:"charlotte-tilbury"');
    expect(mockJson.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).filters)).not.toContain(
      'organization.slug:"ritz-paris"',
    );
    expect(jobs.map((j) => j.company)).toEqual(['Hermès']);
  });

  it('signale une lecture partielle : declaredTotal somme les annonces, truncated si une organisation rend moins', async () => {
    mockJson
      .mockResolvedValueOnce(FIXTURE.facetResponse)
      .mockResolvedValueOnce({ hits: [], nbHits: 0 })
      .mockResolvedValueOnce({ ...FIXTURE.hermesPage, nbHits: 609 })
      .mockResolvedValueOnce(FIXTURE.ritzPage);

    const { jobs, declaredTotal, truncated } = await fetchWttjSectorJobs({ withDescriptions: false });

    expect(jobs).toHaveLength(2);
    expect(declaredTotal).toBe(610);
    expect(truncated).toBe(true);
  });

  it('refuse un secteur qui ne rend aucune organisation plutôt que d’enregistrer un secteur vide', async () => {
    mockJson.mockResolvedValueOnce({ hits: [], nbHits: 0, facets: { 'organization.slug': {} } });

    await expect(fetchWttjSectorJobs({ withDescriptions: false })).rejects.toThrow(/no organisation matches/);
  });

  it('propage le refus de la clé (rotation) au lieu de rendre une liste vide', async () => {
    mockJson
      .mockResolvedValueOnce({ message: 'Invalid Application-ID or API key', status: 403 })
      // refreshSearchKey lit la page (fetchText mocké → undefined → échec), puis pas de retry
      .mockResolvedValueOnce({ message: 'Invalid Application-ID or API key', status: 403 });

    await expect(fetchWttjSectorJobs({ withDescriptions: false })).rejects.toThrow(/WTTJ refused the query/);
  });
});

describe('listOrganizations — le plafond de 1 000 valeurs par facette', () => {
  const cap = (n: number, prefix: string) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, 1]));

  it('redécoupe par pays quand la facette est plafonnée, et fait l’union', async () => {
    mockJson
      .mockResolvedValueOnce({
        facets: { 'organization.slug': cap(1000, 'org-'), 'offices.country_code': { FR: 5, IT: 2 } },
      })
      .mockResolvedValueOnce({ facets: { 'organization.slug': { ...cap(900, 'fr-'), shared: 1 } } })
      .mockResolvedValueOnce({ facets: { 'organization.slug': { ...cap(3, 'it-'), shared: 1 } } });

    const slugs = await listOrganizations('sectors.reference:"luxury-1"');

    expect(slugs.size).toBe(904);
    expect(bodyOf(1).filters).toBe('(sectors.reference:"luxury-1") AND offices.country_code:"FR"');
    expect(bodyOf(2).filters).toBe('(sectors.reference:"luxury-1") AND offices.country_code:"IT"');
  });

  it('échoue explicitement si même un pays dépasse le plafond', async () => {
    mockJson
      .mockResolvedValueOnce({ facets: { 'organization.slug': cap(1000, 'org-'), 'offices.country_code': { FR: 5 } } })
      .mockResolvedValueOnce({ facets: { 'organization.slug': cap(1000, 'fr-') } });

    await expect(listOrganizations('sectors.reference:"luxury-1"')).rejects.toThrow(/facet cap is reached/);
  });

  it('une seule requête sous le plafond', async () => {
    mockJson.mockResolvedValueOnce({ facets: { 'organization.slug': { hermes: 609, kiabi: 250 } } });

    const slugs = await listOrganizations('sectors.reference:"luxury-1"');

    expect([...slugs]).toEqual(['hermes', 'kiabi']);
    expect(mockJson).toHaveBeenCalledTimes(1);
  });
});
