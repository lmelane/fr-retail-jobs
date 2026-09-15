import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../lib/http.js', () => ({ fetchJson: vi.fn(), fetchWithRetry: vi.fn() }));
vi.mock('../../lib/browser.js', () => ({ fetchRenderedHtml: vi.fn() }));

import { fetchJson, fetchWithRetry } from '../../lib/http.js';
import { fetchEightfoldJobs } from './eightfold.js';

const mockJson = vi.mocked(fetchJson);
const mockRetry = vi.mocked(fetchWithRetry);
beforeEach(() => {
  mockJson.mockReset();
  mockRetry.mockReset();
});

/**
 * Regression for the live ERR on every Eightfold apply link (Estée Lauder,
 * Dr. Jart+, Frédéric Malle…): positionUrl is a RELATIVE path
 * ("/careers/job/123"), stored as-is it is not fetchable. It must be resolved
 * against the origin — verified `${origin}/careers/job/123` → 200.
 */
describe('fetchEightfoldJobs apply URL', () => {
  it('resolves the relative positionUrl against the origin', async () => {
    // openSession reads Set-Cookie off the careers page response.
    mockRetry.mockResolvedValueOnce({ headers: { getSetCookie: () => ['sid=abc; Path=/'] } } as never);
    mockJson
      .mockResolvedValueOnce({
        data: {
          positions: [{ id: 1168274680915, name: 'Vendeur', positionUrl: '/careers/job/1168274680915' }],
        },
      } as never)
      .mockResolvedValueOnce({ data: { positions: [] } } as never);

    const { jobs } = await fetchEightfoldJobs({
      origin: 'https://careers.elcompanies.com',
      domain: 'elcompanies.com',
      withDescriptions: false,
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].url).toBe('https://careers.elcompanies.com/careers/job/1168274680915');
  });
});

/**
 * D-435 — LA LANGUE DEMANDÉE AU PORTAIL N'EST PLUS LE FRANÇAIS POUR TOUS.
 *
 * L'appel de détail forçait la locale française. Les deux sources servies par
 * cet adaptateur — `careers.elcompanies.com` (Estée Lauder, 1 386 offres) et
 * `careers.kering.com` (toutes les Maisons Kering) — publient dans le monde
 * entier : on réclamait la version française de descriptions américaines,
 * japonaises ou allemandes.
 *
 * Ces témoins observent l'URL RÉELLEMENT construite par le vrai point
 * d'entrée `fetchEightfoldJobs`, via le mock de `fetchJson` — pas une copie de
 * la logique de construction.
 */
describe('fetchEightfoldJobs locale du détail', () => {
  /** Prépare une session + une page de listing + une page vide de fin. */
  function amorcer() {
    mockRetry.mockResolvedValueOnce({ headers: { getSetCookie: () => ['sid=abc; Path=/'] } } as never);
    mockJson
      .mockResolvedValueOnce({ data: { positions: [{ id: 42, name: 'Vendeur', positionUrl: '/careers/job/42' }] } } as never)
      .mockResolvedValueOnce({ data: { positions: [] } } as never)
      .mockResolvedValueOnce({ data: { jobDescription: 'texte' } } as never);
  }

  /** L'URL de détail réellement demandée, lue dans les appels du mock. */
  function urlDeDetail(): string {
    const appel = mockJson.mock.calls.map((c) => String(c[0])).find((u) => u.includes('position_details'));
    return appel ?? '';
  }

  it('PRÉMISSE : un appel de détail est bien émis, sinon ce témoin ne teste rien', async () => {
    amorcer();
    await fetchEightfoldJobs({
      origin: 'https://careers.elcompanies.com',
      domain: 'elcompanies.com',
      withDescriptions: true,
    });
    expect(urlDeDetail(), 'le détail doit être demandé').toContain('position_details');
  });

  it('ne force plus le français : le défaut est l’anglais', async () => {
    amorcer();
    await fetchEightfoldJobs({
      origin: 'https://careers.elcompanies.com',
      domain: 'elcompanies.com',
      withDescriptions: true,
    });
    expect(urlDeDetail()).toContain('hl=en');
    expect(urlDeDetail(), 'plus aucune locale française imposée').not.toContain('hl=fr');
  });

  it('la locale reste configurable par source', async () => {
    // Une Maison qui publie en français le déclare — elle ne le subit pas.
    amorcer();
    await fetchEightfoldJobs({
      origin: 'https://careers.kering.com',
      domain: 'kering.com',
      withDescriptions: true,
      locale: 'fr',
    });
    expect(urlDeDetail()).toContain('hl=fr');
  });
});

/**
 * Audit A1 (2026-09-06) : 125 offres Estée Lauder envoyaient le candidat sur
 * une AUTRE position — `positionUrl` de la liste est l'URL canonique du groupe
 * de positions similaires, pas celle de la position.
 */
describe('fetchEightfoldJobs apply URL — la position, pas son groupe', () => {
  it("construit l'URL depuis l'id de la position même quand positionUrl pointe ailleurs", async () => {
    mockRetry.mockResolvedValueOnce({ headers: { getSetCookie: () => ['sid=abc; Path=/'] } } as never);
    mockJson
      .mockResolvedValueOnce({
        data: { positions: [{ id: 1168273610474, name: 'Beauty Advisor', positionUrl: '/careers/job/1168274067860' }] },
      })
      .mockResolvedValue({ data: { positions: [] } });
    const { jobs } = await fetchEightfoldJobs({ origin: 'https://careers.elcompanies.com', domain: 'elcompanies.com', withDescriptions: false });
    expect(jobs[0]?.url).toBe('https://careers.elcompanies.com/careers/job/1168273610474');
    expect(jobs[0]?.url.endsWith(jobs[0]!.externalId)).toBe(true);
  });
});

// ——— l2 (2026-09-06) : standardizedLocations est une liste de CHAÎNES ; le détail nomme la Maison et l'affectation ———
import { readFileSync } from 'node:fs';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'));

describe('fetchEightfoldJobs — l2 : pays et ville lus depuis « City, Region, CC » (ELC 1 469/1 470 sans pays)', () => {
  it('lit le pays ISO-2 en fin de chaîne et la ville en tête de `locations`', async () => {
    mockRetry.mockResolvedValueOnce({ headers: { getSetCookie: () => [] } } as never);
    mockJson.mockResolvedValueOnce(fixture('l2-eightfold-elc-search.json')).mockResolvedValue({ data: { positions: [] } });

    const { jobs } = await fetchEightfoldJobs({ origin: 'https://careers.elcompanies.com', domain: 'elcompanies.com', withDescriptions: false });

    expect(jobs.map((j) => j.country)).toEqual(['CO', 'US', 'GB']);
    expect(jobs[0].city).toBe('Bogota');
    expect(jobs[0].location).toBe('Bogota, CO-DC, Colombia');
    // « England,GB » n'a que deux tokens : la ville vient de `locations`, pas de la région.
    expect(jobs[2].city).toBe('London');
  });

  it('accepte encore la forme objet { city, country } d’autres tenants', async () => {
    mockRetry.mockResolvedValueOnce({ headers: { getSetCookie: () => [] } } as never);
    mockJson
      .mockResolvedValueOnce({ data: { positions: [{ id: 1, name: 'Vendeur', locations: ['Paris, France'], standardizedLocations: [{ city: 'Paris', country: 'FR' }] }] } })
      .mockResolvedValue({ data: { positions: [] } });
    const { jobs } = await fetchEightfoldJobs({ origin: 'https://x', domain: 'x.com', withDescriptions: false });
    expect(jobs[0].country).toBe('FR');
    expect(jobs[0].city).toBe('Paris');
  });
});

describe('fetchEightfoldJobs — l2 : la Maison (Kering `efcustomTextHouse`) et l’affectation (ELC `efcustomTextAssignmentcat`)', () => {
  it('crédite une offre Kering à sa Maison, avec son sous-type de contrat', async () => {
    mockRetry.mockResolvedValueOnce({ headers: { getSetCookie: () => [] } } as never);
    mockJson.mockResolvedValueOnce(fixture('l2-eightfold-kering-search.json')).mockResolvedValue(fixture('l2-eightfold-kering-detail.json'));

    const { jobs } = await fetchEightfoldJobs({ origin: 'https://careers.kering.com', domain: 'kering.com' });

    expect(jobs[0].company).toBe('Bottega Veneta');
    expect(jobs[0].contract).toBe('Regular');
  });

  it('lit « Fulltime-Regular » comme contrat ET temps de travail chez Estée Lauder', async () => {
    mockRetry.mockResolvedValueOnce({ headers: { getSetCookie: () => [] } } as never);
    mockJson.mockResolvedValueOnce(fixture('l2-eightfold-elc-search.json')).mockResolvedValue(fixture('l2-eightfold-elc-detail.json'));

    const { jobs } = await fetchEightfoldJobs({ origin: 'https://careers.elcompanies.com', domain: 'elcompanies.com' });

    expect(jobs[0].company).toBe('Estée Lauder Companies');
    expect(jobs[0].contract).toBe('Fulltime-Regular');
    expect(jobs[0].workingTime).toBe('Fulltime-Regular');
  });
});
