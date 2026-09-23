import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchText: vi.fn() }));

import { fetchJson } from '../../lib/http.js';
import { descriptionFromApi, fetchWttjJobs } from './wttj.js';
import { normalizeAdapterResult } from '../index.js';

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

/**
 * LE NIVEAU D'ÉTUDES — 272 offres WTTJ le déclaraient, aucune ne l'écrivait
 * (`educationLevel` valait 0/87 580 en base le 2026-09-15).
 *
 * Le hit de référence (Diptyque, 2026-09-06) ne porte PAS `education_level` :
 * le fournir explicitement, et l'affirmer, est ce qui rend ces témoins capables
 * d'échouer.
 */
describe('fetchWttjJobs — niveau d’études déclaré', () => {
  it('conserve le libellé natif français, préfixé de son référentiel', async () => {
    const base = FIXTURE.algoliaResponse;
    const hits = base.hits.map((h: Record<string, unknown>) => ({ ...h, education_level: 'bac_5' }));
    // PRÉMISSE : le champ source est bien présent sur le hit exercé.
    expect(hits[0].education_level).toBe('bac_5');
    mockJson
      .mockResolvedValueOnce({ ...base, hits })
      .mockResolvedValueOnce(FIXTURE.apiResponse);
    const { jobs } = await fetchWttjJobs({ slug: 'diptyque-paris' });
    // `bac_5` reste `bac_5` : il n'est PAS traduit en « Master's Degree », qui
    // serait une équivalence inter-pays que personne n'a validée.
    expect(jobs[0].educationLevel).toBe('WTTJ:bac_5');
  });

  it('n’invente aucun niveau quand la source se tait', async () => {
    mockJson
      .mockResolvedValueOnce(FIXTURE.algoliaResponse)
      .mockResolvedValueOnce(FIXTURE.apiResponse);
    const { jobs } = await fetchWttjJobs({ slug: 'diptyque-paris' });
    expect(jobs[0].educationLevel).toBeUndefined();
  });
});

/**
 * LE CONTRAT DES IDENTIFIANTS CANONIQUES.
 *
 * `reference`, sinon `slug` : deux champs NATIFS de l'index Algolia, et le chemin exact de `externalId`.
 * `name` est le TITRE — l'ancien dernier repli de `externalId` — et le contrat interdit d'en faire un
 * identifiant. Le témoin passe au rouge si `canonicalIds` est retiré de la preuve.
 */
describe('WTTJ — contrat des identifiants canoniques', () => {
  it('déclare canonicalIds, exactement les reference observées', async () => {
    mockJson.mockResolvedValueOnce(FIXTURE.algoliaResponse).mockResolvedValueOnce(FIXTURE.apiResponse);
    const r = await fetchWttjJobs({ slug: 'diptyque-paris' });

    const pages = r.enumeration!.pageEvidence!;
    expect(pages).toHaveLength(1);
    expect(Object.hasOwn(pages[0], 'canonicalIds')).toBe(true);
    expect(pages[0].canonicalIds).toEqual([FIXTURE.algoliaResponse.hits[0].reference]);
    expect(pages[0].canonicalIds).toEqual(r.jobs.map(j => j.externalId));
    expect(r.enumeration!.canonicalAbsenceProofUsable).toBe(true);

    const n = normalizeAdapterResult(r);
    expect(n.enumeration?.canonicalIdViolations).toBeUndefined();
    expect(n.enumeration?.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
  });

  it('se rabat sur le slug natif quand la reference manque, jamais sur le titre', async () => {
    const hit = { ...FIXTURE.algoliaResponse.hits[0], reference: undefined };
    mockJson.mockResolvedValueOnce({ ...FIXTURE.algoliaResponse, hits: [hit] });
    const r = await fetchWttjJobs({ slug: 'diptyque-paris', withDescriptions: false });
    expect(r.jobs[0].externalId).toBe(hit.slug);
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual([hit.slug]);
    expect(normalizeAdapterResult(r).enumeration?.canonicalIdViolations).toBeUndefined();
  });

  it("un hit sans reference NI slug n'est jamais publié sous son titre", async () => {
    const anonyme = { ...FIXTURE.algoliaResponse.hits[0], reference: undefined, slug: undefined };
    // PRÉMISSE : le hit porte bien un nom, donc l'ancien repli aurait produit une offre titrée.
    expect(anonyme.name).toBeTruthy();
    mockJson.mockResolvedValueOnce({ ...FIXTURE.algoliaResponse, hits: [anonyme] });
    const r = await fetchWttjJobs({ slug: 'diptyque-paris', withDescriptions: false });

    expect(r.jobs).toHaveLength(0);
    expect(r.rejectedRows?.map(row => row.reason)).toEqual(['HIT_WITHOUT_NATIVE_ID']);
    expect(r.enumeration!.canonicalAbsenceProofUsable).toBe(false);
    expect(r.enumeration!.pageEvidence![0].canonicalIds).toEqual([]);
    expect(normalizeAdapterResult(r).enumeration?.canonicalIdViolations).toBeUndefined();
  });
});

it.each(['wttj', 'wttj-sector'])('reconstructs the full production-format API description for %s', async kind => {
  const { recoverRetainedPublication } = await import('../../publication/recovery.js');
  mockJson.mockResolvedValueOnce(FIXTURE.algoliaResponse).mockResolvedValueOnce(FIXTURE.apiResponse);
  const config = { slug: 'diptyque-paris' };
  const {jobs} = await fetchWttjJobs(config); const job = jobs[0];
  const context = {externalId: job.externalId, url: job.url, observedAt: new Date('2026-09-23T10:00:00Z'), config};
  const restored = recoverRetainedPublication(kind, JSON.parse(JSON.stringify(job.raw)), context);
  expect(restored.status).toBe('RECOVERABLE');
  if(restored.status === 'RECOVERABLE') expect(restored.job.description).toBe(job.description);
  expect(recoverRetainedPublication(kind, {...job.raw as object, detailUrl: 'https://wrong.example/job'}, context))
    .toMatchObject({status: 'RECOLLECT_OR_REVIEW', reason: 'DETAIL_IDENTITY_MISMATCH'});
});
