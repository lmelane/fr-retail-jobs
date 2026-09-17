import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn() }));

import { fetchJson } from '../../lib/http.js';
import { fetchMagnetJobs } from './magnet.js';

const mockJson = vi.mocked(fetchJson);
beforeEach(() => mockJson.mockReset());

/** Login returns a token, then one page of offers, then an empty page to stop. */
function mockLoginThenOffers(offers: unknown[]) {
  mockJson
    .mockResolvedValueOnce({ data: { token: 'tok' } } as never) // login
    .mockResolvedValueOnce({ data: { list: offers } } as never) // page 0
    .mockResolvedValueOnce({ data: { list: [] } } as never); // page 1 (stop)
}

/**
 * Regression for the live 404 on every Magnet apply link (Groupe Eram, ETAM,
 * Beaumanoir): the URL was built as `${origin}/offre/${id}`, but the id is
 * `10955-<base64>`, not a URL path — so every link 404'd. The API ships a real,
 * verified-200 `apply_link`; the adapter must use it and NEVER construct one.
 */
describe('fetchMagnetJobs apply URL', () => {
  const config = {
    siteKey: '61ffe84ad14ba0fdbb448d2d388ac4e3',
    origin: 'https://recrutement.groupe-eram.com',
  };

  it('uses the API apply_link, not a constructed /offre/{id}', async () => {
    mockLoginThenOffers([
      {
        id: '10955-OTkwNzAtaFo3MnBr',
        reference: '99070-hZ72pk',
        title: 'Conseiller de vente F/H',
        apply_link: 'https://api.magnet.work/v2/redirect/job-offer/eram/99070-hZ72pk',
      },
    ]);

    const { jobs } = await fetchMagnetJobs(config);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].url).toBe('https://api.magnet.work/v2/redirect/job-offer/eram/99070-hZ72pk');
    expect(jobs[0].url).not.toContain('/offre/');
  });

  it('falls back to link when apply_link is absent', async () => {
    mockLoginThenOffers([
      { id: 'x', title: 'Vendeur', link: 'https://api.magnet.work/v2/redirect/job-offer/eram/abc' },
    ]);

    const { jobs } = await fetchMagnetJobs(config);
    expect(jobs[0].url).toBe('https://api.magnet.work/v2/redirect/job-offer/eram/abc');
  });

  it('skips an offer with no usable link rather than storing a dead /offre/{id}', async () => {
    mockLoginThenOffers([{ id: '10955-deadbeef', title: 'Ghost, no link' }]);

    const { jobs } = await fetchMagnetJobs(config);
    expect(jobs).toHaveLength(0);
  });
});

/**
 * LE CONTRAT CANONIQUE — `id` (à défaut `reference`) EST l'`externalId` écrit.
 *
 * Retirer `canonicalIds` de la preuve fait tomber ces témoins : sans la propriété,
 * `normalizeAdapterResult` classe la source « contrat non implémenté » et aucune absence n'y est
 * démontrable (`UNVERIFIABLE` à la prévisualisation).
 */
import { magnetCanonicalId } from './magnet.js';

describe('fetchMagnetJobs — identifiants canoniques', () => {
  const config = { siteKey: '61ffe84ad14ba0fdbb448d2d388ac4e3', origin: 'https://recrutement.groupe-eram.com' };
  const offer = (over: Record<string, unknown>) => ({
    id: 'x', title: 'Conseiller de vente F/H',
    apply_link: 'https://api.magnet.work/v2/redirect/job-offer/eram/x', ...over,
  });

  it('déclare canonicalIds sur la page de preuve, identiques aux externalId produits', async () => {
    const offers = [offer({ id: 'MG-1' }), offer({ id: 'MG-2' })];
    // PRÉMISSE : les deux offres portent bien un id natif distinct.
    expect(offers.map(magnetCanonicalId)).toEqual(['MG-1', 'MG-2']);
    mockLoginThenOffers(offers);
    const r = await fetchMagnetJobs(config);
    expect(r.enumeration!.pageEvidence!.every((pe) => Object.hasOwn(pe, 'canonicalIds'))).toBe(true);
    const canonical = r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []);
    expect([...canonical].sort()).toEqual(r.jobs.map((j) => j.externalId).sort());
    expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(true);
  });

  it('une offre VUE mais sans lien garde son identifiant : disposition, pas trou', async () => {
    mockLoginThenOffers([offer({ id: 'MG-1' }), { id: 'MG-ORPHELINE', title: 'Ghost, no link' }]);
    const r = await fetchMagnetJobs(config);
    const canonical = r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []);
    expect(canonical).toContain('MG-ORPHELINE');                          // observée
    expect(r.jobs.map((j) => j.externalId)).not.toContain('MG-ORPHELINE'); // non produite
    expect(r.rejectedRows?.find((x) => (x as { canonicalId?: string }).canonicalId === 'MG-ORPHELINE')?.reason)
      .toBe('MISSING_TITLE_APPLY_LINK_OR_REPEATED_ID');
  });

  /** Un titre n'est pas une identité : l'offre est publiée, mais aucune absence n'est attestable. */
  it("une offre identifiée par son SEUL titre interdit toute preuve d'absence", async () => {
    const anonymous = offer({ id: undefined, reference: undefined });
    // PRÉMISSE : cette offre n'a AUCUN identifiant natif — seul son titre la nomme.
    expect(magnetCanonicalId(anonymous)).toBeNull();
    mockLoginThenOffers([offer({ id: 'MG-1' }), anonymous]);
    const r = await fetchMagnetJobs(config);
    expect(r.enumeration?.canonicalAbsenceProofUsable).toBe(false);
    const canonical = r.enumeration!.pageEvidence!.flatMap((pe) => pe.canonicalIds ?? []);
    expect(r.jobs.map((j) => j.externalId)).toContain('Conseiller de vente F/H');
    expect(canonical).toContain('Conseiller de vente F/H');
  });
});
