import { afterEach, describe, expect, it, vi } from 'vitest';
import { withCaptureContext } from '../capture/context.js';

/*
 * LE NAVIGATEUR D'AMORÇAGE OBSERVÉ (D-483) : `allow` décide AVANT l'envoi, chaque requête partie est inscrite (réponse,
 * échec, ou fermeture sans réponse), une requête refusée n'est jamais inscrite, et tout est inscrit avant la fermeture.
 * Playwright est simulé au niveau de ses points d'entrée réels (`context.route`, événements `response` /
 * `requestfailed`, `context.cookies`) ; le code sous test est `primeWafToken` de production.
 */
type Planned = { url: string; method?: string; type?: string; outcome: 'response' | 'failed' | 'hang'; status?: number };
const fixture = vi.hoisted(() => ({
  plan: [] as Planned[], route: undefined as undefined | ((route: unknown) => unknown),
  listeners: new Map<string, Set<(value: unknown) => void>>(), aborted: [] as string[], continued: [] as string[],
  closed: 0, closedAfter: [] as number[], recorded: 0, token: 'aws-waf-token=final',
}));
vi.mock('playwright', () => ({ chromium: { launch: async () => ({ close: async () => {}, newContext: async () => ({
  route: async (_pattern: string, handler: (route: unknown) => unknown) => { fixture.route = handler; },
  routeWebSocket: async () => {},
  on: (event: string, fn: (value: unknown) => void) => { if (!fixture.listeners.has(event)) fixture.listeners.set(event, new Set()); fixture.listeners.get(event)!.add(fn); },
  off: (event: string, fn: (value: unknown) => void) => { fixture.listeners.get(event)?.delete(fn); },
  cookies: async () => [{ name: 'aws-waf-token', value: 'final' }],
  close: async () => { fixture.closed++; fixture.closedAfter.push(fixture.recorded); },
  newPage: async () => ({
    url: () => 'https://careers.ralphlauren.com/en_US/CareersCorporate/SearchJobsCorporate/?jobOffset=0&listFilterMode=1',
    waitForTimeout: async () => { await new Promise(resolve => setTimeout(resolve, 5)); },
    waitForLoadState: async () => {},
    goto: async () => {
      for (const planned of fixture.plan) {
        const request = { url: () => planned.url, method: () => planned.method ?? 'GET', resourceType: () => planned.type ?? 'script',
          postDataBuffer: () => null, redirectedFrom: () => null, allHeaders: async () => ({ 'user-agent': 'Browser fixture', cookie: 'secret' }) };
        let sent = false;
        await fixture.route!({ request: () => request, abort: async () => { fixture.aborted.push(planned.url); },
          continue: async () => { sent = true; fixture.continued.push(planned.url); } });
        const emit = (event: string, value: unknown) => { for (const fn of fixture.listeners.get(event) ?? []) fn(value); };
        if (!sent) { emit('requestfailed', request); continue; }
        if (planned.outcome === 'response') emit('response', { request: () => request, status: () => planned.status ?? 200,
          headers: () => ({ 'content-type': 'text/plain' }), body: async () => Buffer.from(`corps ${planned.url}`) });
        if (planned.outcome === 'failed') emit('requestfailed', request);
      }
      return { status: () => 202, url: () => 'https://careers.ralphlauren.com/' };
    },
  }),
}) }) } }));
vi.mock('./browserProxy.js', () => ({ createPublicBrowserProxy: async () => ({ url: 'http://127.0.0.1:1', close: async () => {} }) }));
vi.mock('./hostGate.js', () => ({ withHostGate: async (_url: string, work: () => Promise<unknown>) => work(), reportThrottle: () => {}, reportSuccess: () => {} }));
import { closeBrowser, primeWafToken, type BootstrapObservation } from './browser.js';

const LISTING = 'https://careers.ralphlauren.com/en_US/CareersCorporate/SearchJobsCorporate/?jobOffset=0&listFilterMode=1';
const AWS = 'https://7d6e0277a337.42c8209d.us-east-1.token.awswaf.com';
const allowed = (url: string) => url === LISTING || url.startsWith(`${AWS}/`);

afterEach(async () => { await closeBrowser(); Object.assign(fixture, { plan: [], route: undefined, aborted: [], continued: [], closedAfter: [], recorded: 0 }); fixture.listeners.clear(); });

describe('amorçage observé', () => {
  it('n’envoie que ce que `allow` accepte et inscrit chaque requête partie — réponse, échec ou fermeture sans réponse', async () => {
    fixture.plan = [
      { url: LISTING, type: 'document', outcome: 'response', status: 202 },
      { url: `${AWS}/a/b/c/challenge.js`, outcome: 'response' },
      { url: 'https://maps.googleapis.com/maps/api/js', outcome: 'response' },
      { url: `${AWS}/a/b/c/inputs?client=browser`, type: 'fetch', outcome: 'failed' },
      { url: 'https://careers.ralphlauren.com/portal/47/styles.css', type: 'stylesheet', outcome: 'response' },
      { url: `${AWS}/a/b/c/mp_verify`, method: 'POST', type: 'fetch', outcome: 'hang' },
    ];
    const seen: BootstrapObservation[] = [];
    const token = await primeWafToken(LISTING, { allow: request => allowed(request.url),
      record: async observation => { await new Promise(resolve => setTimeout(resolve, 2)); seen.push(observation); fixture.recorded++; } });
    expect(token).toBe('aws-waf-token=final');
    // Prémisse : deux requêtes hors bornes ont été tentées par la page, et refusées AVANT l'envoi.
    expect(fixture.aborted).toEqual(['https://maps.googleapis.com/maps/api/js', 'https://careers.ralphlauren.com/portal/47/styles.css']);
    expect(seen.map(item => [item.url, item.status, item.failure]).sort()).toEqual([
      [LISTING, 202, null], [`${AWS}/a/b/c/challenge.js`, 200, null],
      [`${AWS}/a/b/c/inputs?client=browser`, null, 'BrowserTransportError'], [`${AWS}/a/b/c/mp_verify`, null, 'ClosedBeforeResponse'],
    ].sort());
    // Tout est inscrit AVANT la fermeture du contexte.
    expect(fixture.closedAfter).toEqual([4]);
  });

  it('une inscription en échec fait échouer l’amorçage, après avoir fermé le contexte', async () => {
    fixture.plan = [{ url: LISTING, type: 'document', outcome: 'response', status: 202 }];
    const before = fixture.closed;
    await expect(primeWafToken(LISTING, { allow: () => true, record: async () => { throw new Error('Archive indisponible'); } })).rejects.toThrow('Archive indisponible');
    expect(fixture.closed).toBe(before + 1);
  });

  it('refuse d’amorcer une adresse que son propre filtre n’autorise pas', async () => {
    await expect(primeWafToken(LISTING, { allow: () => false, record: async () => {} })).rejects.toThrow(/outside its own authorization/);
  });

  it('sous une politique d’accès, un amorçage observé n’est pas un transport « non supporté »', async () => {
    fixture.plan = [{ url: LISTING, type: 'document', outcome: 'response', status: 202 }];
    const context = { sequence: 0, requestAccess: () => undefined } as Parameters<typeof withCaptureContext>[0];
    await withCaptureContext(context, () => primeWafToken(LISTING, { allow: () => true, record: async () => {} }));
    expect(context.unsupportedTransport).toBeUndefined(); expect(context.accessFailure).toBeUndefined();
    // Témoin de la prémisse : sans observateur, le même navigateur reste refusé par cette politique.
    await expect(withCaptureContext({ sequence: 0, requestAccess: () => undefined }, () => primeWafToken(LISTING))).rejects.toMatchObject({ name: 'CaptureUnavailableError' });
  });

  it('ne s’exécute jamais pendant un rejeu hors réseau', async () => {
    await expect(withCaptureContext({ sequence: 0, replay: async () => { throw new Error('unused'); } },
      () => primeWafToken(LISTING, { allow: () => true, record: async () => {} }))).rejects.toThrow(/never runs during offline replay/);
  });
});
