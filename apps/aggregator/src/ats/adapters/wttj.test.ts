import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));

import { fetchJson } from '../../lib/http.js';
import { descriptionFromApi, fetchWttjJobs } from './wttj.js';

const mockJson = vi.mocked(fetchJson);
beforeEach(() => mockJson.mockReset());

/**
 * Capturé le 2026-09-06 sur Diptyque (26 offres) : un hit Algolia tel que
 * l'index le rend aujourd'hui — sans `description`, `profile` à null, un
 * `summary` de ~500 caractères — et la réponse de l'API publique pour la
 * même offre, avec le texte complet en HTML.
 */
const FIXTURE = JSON.parse(readFileSync(new URL('./__fixtures__/g6-wttj-diptyque.json', import.meta.url), 'utf8'));

describe('fetchWttjJobs — la description vient de l’API, plus de l’index', () => {
  it('complète chaque hit avec le texte de l’API, en texte structuré', async () => {
    mockJson.mockResolvedValueOnce(FIXTURE.algoliaResponse).mockResolvedValueOnce(FIXTURE.apiResponse);

    const { jobs, declaredTotal } = await fetchWttjJobs({ slug: 'diptyque-paris' });

    expect(declaredTotal).toBe(26);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].description!.length).toBeGreaterThan(1500);
    expect(jobs[0].description).toContain('\n');
    expect(jobs[0].description).toContain('Au sein du département Architecture');
    expect(mockJson.mock.calls[1][0]).toBe(
      `https://api.welcometothejungle.com/api/v1/organizations/diptyque-paris/jobs/${FIXTURE.algoliaResponse.hits[0].slug}`,
    );
  });

  it('garde le résumé du hit quand l’API est injoignable, sans perdre l’offre', async () => {
    mockJson.mockResolvedValueOnce(FIXTURE.algoliaResponse).mockRejectedValueOnce(new Error('HTTP 503'));

    const { jobs } = await fetchWttjJobs({ slug: 'diptyque-paris' });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].description).toBe(FIXTURE.algoliaResponse.hits[0].summary);
  });

  it('ne consulte pas l’API quand on ne veut pas les descriptions', async () => {
    mockJson.mockResolvedValueOnce(FIXTURE.algoliaResponse);

    await fetchWttjJobs({ slug: 'diptyque-paris', withDescriptions: false });

    expect(mockJson).toHaveBeenCalledTimes(1);
  });
});

describe('descriptionFromApi', () => {
  it('enchaîne description, profil et processus, chacun converti en texte', () => {
    const text = descriptionFromApi({
      description: '<p>Vos missions</p><ul><li>Vendre</li></ul>',
      profile: '<p>Votre profil</p>',
      recruitment_process: null,
    });
    expect(text).toBe('Vos missions\n• Vendre\n\nVotre profil');
  });

  it('rend undefined quand l’API ne porte aucun texte', () => {
    expect(descriptionFromApi({ description: null, profile: null })).toBeUndefined();
    expect(descriptionFromApi(undefined)).toBeUndefined();
  });
});
