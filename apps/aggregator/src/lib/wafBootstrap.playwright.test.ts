import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertCaptureHealthy, withCaptureContext, type CaptureContext, type CaptureRecord } from '../capture/context.js';

/*
 * LE VRAI COMPORTEMENT DE PLAYWRIGHT, REPRODUIT (audit adverse D-483, 30/09/2026). Mesuré le 30/09 avec Chromium
 * 1.62 contre des serveurs locaux (scripts de l'audit : als.mjs, redirect.mjs, ws.mjs) :
 *   1. les gestionnaires `route` et les événements `response` / `requestfailed` s'exécutent dans le contexte
 *      asynchrone du LANCEMENT du navigateur (partagé par tout le process), jamais dans celui de la collecte ;
 *   2. une redirection 3xx est suivie par le navigateur SANS repasser par `route` ; la requête redirigée émet
 *      `request` puis `response`, avec `redirectedFrom()` ;
 *   3. un WebSocket ne passe pas par `route` : la connexion part, sauf si `routeWebSocket` la retient ;
 *   4. une page peut émettre des requêtes jusqu'à la fermeture de son contexte.
 * Le faux Playwright ci-dessous reproduit ces quatre faits ; le code sous test est la production (browser.ts,
 * wafToken.ts, context.ts, la politique de collecte de batch.ts).
 */
type Plan = { url: string; method?: string; type?: string; status: number; redirectTo?: string };
const fx = vi.hoisted(() => ({ launches: 0, snapshot: null as null | ((fn: () => unknown) => unknown), plan: [] as Plan[],
  webSocket: null as null | string, wsLeaked: [] as string[], lateRequest: null as null | string, lateRedirect: null as null | string,
  continued: [] as string[], rawHeaders: [] as Record<string, string>[] }));
vi.mock('playwright', () => ({ chromium: { launch: async () => {
  fx.launches++;
  fx.snapshot = AsyncLocalStorage.snapshot();
  return { close: async () => {}, newContext: async () => {
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    let route: ((value: unknown) => unknown) | undefined; let wsRoute: ((socket: unknown) => unknown) | undefined;
    const emit = (event: string, value: unknown) => fx.snapshot!(() => { for (const fn of listeners.get(event) ?? []) fn(value); });
    // Comme en HTTP/2 (mesuré au banc réel du second tour d'audit) : les en-têtes portent des pseudo-en-têtes.
    const makeRequest = (plan: Plan, from: unknown = null) => ({ url: () => plan.url, method: () => plan.method ?? 'GET',
      resourceType: () => plan.type ?? 'fetch', postDataBuffer: () => null, redirectedFrom: () => from,
      allHeaders: async () => { const headers = { ':authority': new URL(plan.url).host, ':method': plan.method ?? 'GET',
        ':path': new URL(plan.url).pathname, ':scheme': 'https', 'user-agent': 'Browser fixture' }; fx.rawHeaders.push(headers); return headers; } });
    let sentFirst: unknown = null;
    /** Une requête de page : `route` (dans le contexte du lancement), puis, si elle part, sa réponse — et sa redirection. */
    const send = async (plan: Plan) => {
      const request = makeRequest(plan);
      emit('request', request);
      let sent = false;
      await fx.snapshot!(() => route!({ request: () => request, abort: async () => {}, continue: async () => { sent = true; fx.continued.push(plan.url); } }));
      if (sent) sentFirst ??= request;
      if (!sent) { emit('requestfailed', request); return; }
      emit('response', { request: () => request, status: () => plan.status, headers: () => ({ 'content-type': 'text/html' }), body: async () => Buffer.from('corps') });
      if (plan.redirectTo) {
        const next = makeRequest({ url: plan.redirectTo, type: plan.type, status: 200 }, request);
        emit('request', next); fx.continued.push(plan.redirectTo);
        emit('response', { request: () => next, status: () => 200, headers: () => ({ 'content-type': 'text/html' }), body: async () => Buffer.from('ailleurs') });
      }
    };
    return {
      route: async (_pattern: string, handler: (value: unknown) => unknown) => { route = handler; },
      routeWebSocket: async (_pattern: RegExp, handler: (socket: unknown) => unknown) => { wsRoute = handler; },
      on: (event: string, fn: (value: unknown) => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn); },
      off: (event: string, fn: (value: unknown) => void) => { listeners.get(event)?.delete(fn); },
      cookies: async () => [{ name: 'aws-waf-token', value: 'final' }],
      close: async () => {
        if (fx.lateRequest) await send({ url: fx.lateRequest, status: 200 });
        // Une requête déjà partie redirigée pendant la fermeture : le navigateur la suit sans `route`.
        if (fx.lateRedirect) { emit('request', makeRequest({ url: fx.lateRedirect, type: 'document', status: 200 }, sentFirst)); fx.continued.push(fx.lateRedirect); }
      },
      newPage: async () => ({
        url: () => fx.plan[0]?.url ?? 'https://careers.ralphlauren.com/',
        waitForTimeout: async () => { await new Promise(resolve => setTimeout(resolve, 5)); },
        waitForLoadState: async () => {},
        goto: async () => {
          for (const plan of fx.plan) await send(plan);
          if (fx.webSocket) {
            let closed = false;
            if (wsRoute) await fx.snapshot!(() => wsRoute!({ url: () => fx.webSocket, close: () => { closed = true; } }));
            if (!closed) fx.wsLeaked.push(fx.webSocket);
          }
          return { status: () => 202, url: () => fx.plan[0]?.url };
        },
      }),
    };
  } };
} } }));
vi.mock('./browserProxy.js', () => ({ createPublicBrowserProxy: async () => ({ url: 'http://127.0.0.1:1', close: async () => {} }) }));
vi.mock('./hostGate.js', () => ({ withHostGate: async (_url: string, work: () => Promise<unknown>) => work(), reportThrottle: () => {}, reportSuccess: () => {} }));
import { closeBrowser } from './browser.js';
import { clearWafTokens, primeWafCookie, setWafPrimer } from './wafToken.js';
import { wafBootstrapPolicy } from '../capture/batch.js';

const LISTING = 'https://careers.ralphlauren.com/en_US/CareersCorporate/SearchJobsCorporate/?jobOffset=0&listFilterMode=1';
const AWS = 'https://7d6e0277a337.42c8209d.us-east-1.token.awswaf.com';
const BOUNDED: Plan[] = [{ url: LISTING, type: 'document', status: 202 }, { url: `${AWS}/a/b/c/challenge.js`, type: 'script', status: 200 },
  { url: `${AWS}/a/b/c/inputs?client=browser`, status: 200 }, { url: `${AWS}/a/b/c/mp_verify`, method: 'POST', status: 200 }];
const collection = (rows: CaptureRecord[]): CaptureContext => ({ sequence: 0, write: async record => { rows.push(record); },
  wafBootstrap: wafBootstrapPolicy('ralph-lauren-avature', null) });

beforeEach(() => { vi.stubEnv('PIPELINE_PAUSED', '0'); clearWafTokens(); setWafPrimer(undefined); Object.assign(fx, { plan: BOUNDED, webSocket: null, wsLeaked: [], lateRequest: null, lateRedirect: null, continued: [], rawHeaders: [] }); });
afterEach(async () => { vi.unstubAllEnvs(); await closeBrowser(); });

describe('amorçage inscrit sous le vrai comportement de Playwright', () => {
  it('deux collectes successives du même process : chacune inscrit SON amorçage, dans SON journal', async () => {
    const q: CaptureRecord[] = []; const i: CaptureRecord[] = [];
    const Q = collection(q); const I = collection(i);
    expect(await withCaptureContext(Q, () => primeWafCookie(LISTING))).toBe('aws-waf-token=final');
    expect(await withCaptureContext(I, () => primeWafCookie(LISTING))).toBe('aws-waf-token=final');
    // Prémisse : un seul navigateur, lancé dans la première collecte — ses événements arrivent dans le contexte de Q.
    expect(fx.launches).toBe(1);
    expect(q).toHaveLength(4); expect(i).toHaveLength(4);
    expect(Q.wafBootstrapped).toBe(true); expect(I.wafBootstrapped).toBe(true);
    expect(I.wafJournal?.bootstrap).toHaveLength(4); expect(Q.wafJournal?.bootstrap).toHaveLength(4);
    // Prémisse HTTP/2 : les en-têtes observés portaient des pseudo-en-têtes, et l'inscription a gardé l'identité.
    expect(fx.rawHeaders.some(headers => ':authority' in headers)).toBe(true);
    expect(q.every(row => row.requestData.hops[0].request.userAgent === 'Browser fixture')).toBe(true);
  });

  it('une redirection de la page défiée vers une autre origine : inscrite, et l’amorçage échoue', async () => {
    fx.plan = [{ ...BOUNDED[0], status: 302, redirectTo: 'https://ailleurs.example/fuite' }, ...BOUNDED.slice(1)];
    const rows: CaptureRecord[] = []; const store = collection(rows);
    await withCaptureContext(store, async () => {
      await expect(primeWafCookie(LISTING)).rejects.toThrow(/escaped its authorization/);
      expect(() => assertCaptureHealthy()).toThrow(/escaped its authorization/);
    });
    // Prémisse : `route` n'a vu que la page défiée ; la requête redirigée est pourtant partie — et elle est au journal.
    expect(fx.continued).toContain('https://ailleurs.example/fuite');
    expect(rows.map(row => row.requestUrl)).toContain('https://ailleurs.example/fuite');
  });

  it('une redirection d’une requête déjà partie, pendant la fermeture : jamais inscrite, l’amorçage échoue', async () => {
    fx.lateRedirect = 'https://ailleurs.example/apres-vidange';
    const rows: CaptureRecord[] = []; const store = collection(rows);
    await withCaptureContext(store, async () => {
      await expect(primeWafCookie(LISTING)).rejects.toThrow(/after the journal was drained/);
      expect(() => assertCaptureHealthy()).toThrow(/after the journal was drained/);
    });
    // Prémisse : la requête redirigée est partie après la vidange, et n'est pas au journal.
    expect(fx.continued).toContain('https://ailleurs.example/apres-vidange');
    expect(rows.map(row => row.requestUrl)).not.toContain('https://ailleurs.example/apres-vidange');
  });

  it('un WebSocket ouvert par la page est clos avant de joindre un serveur', async () => {
    fx.webSocket = 'wss://ailleurs.example/ws';
    const rows: CaptureRecord[] = [];
    expect(await withCaptureContext(collection(rows), () => primeWafCookie(LISTING))).toBe('aws-waf-token=final');
    expect(fx.wsLeaked).toEqual([]);
  });

  it('une requête émise pendant la fermeture ne part pas : rien d’envoyé qui ne soit inscrit', async () => {
    fx.lateRequest = `${AWS}/a/b/c/telemetry`;
    const rows: CaptureRecord[] = [];
    expect(await withCaptureContext(collection(rows), () => primeWafCookie(LISTING))).toBe('aws-waf-token=final');
    expect(fx.continued).not.toContain(`${AWS}/a/b/c/telemetry`);
    expect(rows.map(row => row.requestUrl)).not.toContain(`${AWS}/a/b/c/telemetry`);
  });
});
