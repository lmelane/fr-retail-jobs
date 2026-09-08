import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, fetchText, WafChallengeError } from './http.js';
import { clearWafTokens, setWafPrimer } from './wafToken.js';

/**
 * L'amorçage WAF vu depuis fetchWithRetry, réseau mocké : le navigateur n'est
 * jamais lancé — l'amorceur est remplacé par une fonction de test.
 */

const ORIGIN = 'https://careers.example-waf.com';

function challenge(): Response {
  return new Response('', { status: 202, headers: { 'x-amzn-waf-action': 'challenge' } });
}

function page(body = '<html>offre</html>'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
}

/** Les en-têtes de la n-ième requête mockée, en minuscules. */
function sentHeaders(mock: ReturnType<typeof vi.fn>, call: number): Record<string, string> {
  const init = mock.mock.calls[call]?.[1] as RequestInit | undefined;
  return Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
}

let fetchMock: ReturnType<typeof vi.fn>;
let primer: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearWafTokens();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  primer = vi.fn(async () => 'aws-waf-token=jeton-test');
  setWafPrimer(primer);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setWafPrimer(undefined);
  clearWafTokens();
});

describe('fetchWithRetry face à un challenge WAF', () => {
  it('amorce le jeton, rejoue UNE fois avec le cookie et rend la vraie page', async () => {
    fetchMock.mockResolvedValueOnce(challenge()).mockResolvedValueOnce(page());

    const body = await fetchText(`${ORIGIN}/jobs/une-offre`);

    expect(body).toBe('<html>offre</html>');
    expect(primer).toHaveBeenCalledTimes(1);
    // L'amorçage navigue sur l'URL challengée, pas sur la racine : Ralph
    // Lauren ne pose le challenge que sous /en_US/CareersCorporate/…
    expect(primer).toHaveBeenCalledWith(`${ORIGIN}/jobs/une-offre`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentHeaders(fetchMock, 0).cookie).toBeUndefined();
    expect(sentHeaders(fetchMock, 1).cookie).toBe('aws-waf-token=jeton-test');
  });

  it('échoue franchement (WafChallengeError) si le challenge persiste après amorçage — jamais un corps vide', async () => {
    fetchMock.mockImplementation(async () => challenge());

    await expect(fetchWithRetry(`${ORIGIN}/jobs/x`)).rejects.toBeInstanceOf(WafChallengeError);
    // Le message NOMME le fournisseur : « CHALLENGED par aws » est un
    // diagnostic exploitable, « 0 offre » envoyait chercher un bug d'adaptateur.
    await expect(fetchWithRetry(`${ORIGIN}/jobs/x`)).rejects.toThrow('Challenge aws non levé pour');
    // Deux appels : 1 challenge + 1 re-tentative, pas de troisième essai.
    expect(fetchMock).toHaveBeenCalledTimes(2 + 1);
    expect(primer).toHaveBeenCalledTimes(1);
  });

  it('échoue franchement sans re-tentative quand aucun jeton n’apparaît', async () => {
    primer.mockResolvedValue(undefined);
    fetchMock.mockImplementation(async () => challenge());

    await expect(fetchWithRetry(`${ORIGIN}/jobs/x`)).rejects.toBeInstanceOf(WafChallengeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(primer).toHaveBeenCalledTimes(1);
  });

  it('mémorise le jeton par origine : les requêtes suivantes le portent sans nouvel amorçage', async () => {
    fetchMock.mockResolvedValueOnce(challenge()).mockImplementation(async () => page());

    await fetchText(`${ORIGIN}/jobs/a`);
    await fetchText(`${ORIGIN}/jobs/b`);
    await fetchText(`${ORIGIN}/sitemap.xml`);

    expect(primer).toHaveBeenCalledTimes(1);
    expect(sentHeaders(fetchMock, 2).cookie).toBe('aws-waf-token=jeton-test');
    expect(sentHeaders(fetchMock, 3).cookie).toBe('aws-waf-token=jeton-test');
  });

  it('n’amorce qu’une fois quand plusieurs requêtes parallèles reçoivent le challenge', async () => {
    let resolvePrimer!: (cookie: string) => void;
    primer.mockImplementation(() => new Promise<string>((resolve) => { resolvePrimer = resolve; }));
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers as Record<string, string>) ?? {};
      return headers.cookie ? page() : challenge();
    });

    const all = Promise.all([fetchText(`${ORIGIN}/jobs/1`), fetchText(`${ORIGIN}/jobs/2`), fetchText(`${ORIGIN}/jobs/3`)]);
    await vi.waitFor(() => expect(primer).toHaveBeenCalledTimes(1));
    resolvePrimer('aws-waf-token=partagé');

    expect(await all).toEqual(['<html>offre</html>', '<html>offre</html>', '<html>offre</html>']);
    expect(primer).toHaveBeenCalledTimes(1);
  });

  it('ne touche pas à une autre origine ni à un cookie fourni par l’appelant', async () => {
    fetchMock.mockResolvedValueOnce(challenge()).mockImplementation(async () => page());
    await fetchText(`${ORIGIN}/jobs/a`);

    await fetchText('https://autre-site.example.com/jobs', { headers: { cookie: 'session=abc' } });
    expect(sentHeaders(fetchMock, 2).cookie).toBe('session=abc');

    await fetchText(`${ORIGIN}/api/jobs`, { headers: { cookie: 'session=abc' } });
    expect(sentHeaders(fetchMock, 3).cookie).toBe('session=abc; aws-waf-token=jeton-test');
  });

  it('laisse passer un 202 ordinaire (sans en-tête WAF) comme avant', async () => {
    fetchMock.mockResolvedValueOnce(new Response('accepted', { status: 202 }));

    expect(await fetchText(`${ORIGIN}/api/async`)).toBe('accepted');
    expect(primer).not.toHaveBeenCalled();
  });
});
