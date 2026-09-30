import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertCaptureHealthy, captureResponse, withCaptureContext, type CaptureContext, type CaptureRecord } from '../capture/context.js';
import { describeRequest } from '../capture/context.js';
import { observedHop } from '../capture/requestData.js';
import { offlineReplay } from '../capture/offlineReplay.js';
import type { BootstrapObserver } from './browser.js';
import { BROWSER_USER_AGENT } from './browser.js';

vi.mock('./hostGate.js', () => ({ withHostGate: async (_url: string, run: () => Promise<unknown>) => run(), reportThrottle: () => {}, reportSuccess: () => {} }));
vi.mock('./sourceBudget.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./sourceBudget.js')>()), sourceDelay: vi.fn(async () => undefined) }));

import { wafBootstrapPolicy } from '../capture/batch.js';
import { deriveAccessBootstrap, type AccessBootstrap } from '../connectors/wafBootstrap.js';
import { fetchAvatureJobs } from '../ats/adapters/avature.js';
import { clearWafTokens, primeWafCookie, setWafPrimer, WafChallengeError } from './wafToken.js';

/*
 * L'AMORÇAGE DU DÉFI RALPH LAUREN, DE LA COLLECTE AU REJEU HORS RÉSEAU (D-483, 30/09/2026).
 *
 * Réponses RÉELLES : le défi que careers.ralphlauren.com sert à la collecte (`202`, corps vide,
 * `x-amzn-waf-action: challenge`, mesuré le 30/09 trois fois sur trois), et la page 0 de la liste Corporate archivée
 * par la collecte du 19/09/2026 à 12:33 (lot 7b16d898, empreinte vérifiée ci-dessous). Le navigateur est simulé par
 * les requêtes MESURÉES le 30/09 (`connectors/__fixtures__/ralph-lauren-amorcage-20260930.json`) : les 5 de
 * l'amorçage borné, les 26 qu'il a refusées, et les requêtes de l'amorçage historique (Google Maps, CDN Avature).
 * Le VRAI transport (`fetchText` → `fetchWithRetry`), le VRAI lecteur Avature et la VRAIE politique de collecte
 * (`wafBootstrapPolicy`) sont exercés ; seul Chromium est remplacé.
 */
const ORIGIN = 'https://careers.ralphlauren.com';
const LISTING = `${ORIGIN}/en_US/CareersCorporate/SearchJobsCorporate/?jobOffset=0&listFilterMode=1`;
const AWS = 'https://7d6e0277a337.42c8209d.us-east-1.token.awswaf.com';
const COOKIE = 'aws-waf-token=jeton-du-test';
const config = { origin: ORIGIN, lists: ['en_US/CareersCorporate/SearchJobsCorporate'], maxPages: 1, withDescriptions: false };
const page0 = gunzipSync(readFileSync(new URL('../ats/adapters/__fixtures__/avature-ralphlauren-corporate-p0-20260919.html.gz', import.meta.url)));
type Measured = { method: string; url: string; resourceType: string; status: number | null };
const measured = JSON.parse(readFileSync(new URL('../connectors/__fixtures__/ralph-lauren-amorcage-20260930.json', import.meta.url), 'utf8')) as
  { borne: { requests: Measured[]; blocked: Measured[] }; observateur: { requests: Measured[] } };
const exact = (request: Measured) => request.url.startsWith(`${ORIGIN}/en_US/CareersCorporate/SearchJobsCorporate/?`) ? LISTING : request.url;
const granted: AccessBootstrap = { vendor: 'AWS_WAF_CHALLENGE', origin: ORIGIN, challengeHosts: [AWS] };

/** Le réseau de la source : le défi à toute requête sans jeton, la vraie page avec lui. */
function network() {
  const mock = vi.fn(async (_url: string, init?: RequestInit) => {
    const cookie = new Headers(init?.headers).get('cookie');
    return cookie?.includes(COOKIE) ? new Response(page0, { status: 200, headers: { 'content-type': 'text/html;charset=UTF-8' } })
      : new Response(null, { status: 202, headers: { 'content-type': 'text/html; charset=UTF-8', 'x-amzn-waf-action': 'challenge' } });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/**
 * Le navigateur simulé : il tente, dans l'ordre mesuré, les requêtes de l'amorçage historique entier ; chacune passe
 * d'abord par `allow` (un refus = jamais envoyée), celles qui partent sont inscrites. Le jeton n'apparaît que si le
 * script du défi, `inputs` et `mp_verify` sont partis — comme en réalité.
 */
function browser() {
  const sent: string[] = []; const refused: string[] = [];
  const primer = vi.fn(async (url: string, observer?: BootstrapObserver) => {
    if (!observer) throw new Error('A collection never bootstraps without an observer');
    expect(url).toBe(LISTING);
    for (const request of measured.observateur.requests) {
      const target = { url: exact(request), method: request.method, resourceType: request.resourceType };
      if (!observer.allow(target)) { refused.push(`${request.method} ${target.url}`); continue; }
      sent.push(`${request.method} ${target.url}`);
      await observer.record({ ...target, postData: request.method === 'POST' ? Buffer.from('{"solution":"preuve"}') : null,
        requestHeaders: { 'user-agent': BROWSER_USER_AGENT, 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7', cookie: 'jamais-archive' },
        status: request.status, responseHeaders: { 'content-type': 'text/plain' },
        body: Buffer.from(request.url.includes('mp_verify') ? `{"token":"${COOKIE.split('=')[1]}"}` : `corps ${request.url}`), failure: null });
    }
    const solved = ['challenge.js', 'inputs', 'mp_verify'].every(name => sent.some(line => line.includes(`${AWS}/`) && line.includes(name)));
    return solved ? COOKIE : undefined;
  });
  setWafPrimer(primer);
  return { primer, sent, refused };
}

async function collect(context: Partial<CaptureContext>) {
  const records: CaptureRecord[] = [];
  const store: CaptureContext = { sequence: 0, observedAt: new Date('2026-09-30T09:26:45.985Z'), write: async row => { records.push(row); }, ...context };
  let result: Awaited<ReturnType<typeof fetchAvatureJobs>> | undefined; let error: unknown;
  try { result = await withCaptureContext(store, async () => { const read = await fetchAvatureJobs(config); assertCaptureHealthy(); return read; }); }
  catch (caught) { error = caught; }
  return { records, result, error, context: store };
}

function replay(records: CaptureRecord[], legacyBootstrap = false) {
  const { context, left } = offlineReplay(records.map(row => ({ ...row, data: row.requestData })), async row => row,
    { observedAt: new Date('2026-09-30T09:26:45.985Z'), legacyBootstrap });
  return { run: () => withCaptureContext(context, async () => { const read = await fetchAvatureJobs(config); assertCaptureHealthy(); return read; }), left };
}

beforeEach(() => { vi.stubEnv('PIPELINE_PAUSED', '0'); clearWafTokens(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); setWafPrimer(undefined); clearWafTokens(); });

describe('D-483 — prémisses', () => {
  it('la page archivée est bien celle du 19/09 (empreinte), et elle porte 6 offres', async () => {
    expect(createHash('sha256').update(page0).digest('hex')).toBe('d0760850742f616eb6dec781e81c38eb0beacbefd3693b0ec8887ff95864bc7e');
    expect(page0.toString('utf8').match(/article--result/g)).toHaveLength(6);
  });
});

describe('collecte de qualification (aucune décision) : l’amorçage borné est inscrit au journal', () => {
  it('le défi, 5 requêtes du navigateur, puis la page : tout est au journal, sous l’identité du collecteur', async () => {
    const transport = network(); const { primer, sent, refused } = browser();
    const { records, result, error, context } = await collect({ wafBootstrap: wafBootstrapPolicy('ralph-lauren-avature', null) });
    expect(error).toBeUndefined();
    expect(result!.jobs).toHaveLength(6);
    expect(primer).toHaveBeenCalledTimes(1);
    // Prémisse du filtre : l'amorçage simulé a TENTÉ la page entière (Google Maps compris) ; seules 5 requêtes sont parties.
    expect(sent).toHaveLength(5); expect(refused.length).toBeGreaterThan(100);
    expect(refused.some(line => line.includes('maps.googleapis.com'))).toBe(true);
    expect(records.map(row => [row.format, row.status])).toEqual([['HTTP_RESPONSE', 202], ...Array(5).fill(null).map((_, i) =>
      ['BROWSER_RESPONSE', measured.borne.requests[i].status]), ['HTTP_RESPONSE', 200]]);
    expect(records.slice(1, 6).every(row => row.requestData.origin === 'BROWSER_TRANSPORT' && row.requestData.hops[0].request.userAgent === BROWSER_USER_AGENT)).toBe(true);
    expect(JSON.stringify(records.map(row => row.requestData))).not.toContain('jamais-archive');
    // Le jeton rendu par l'infrastructure du défi n'entre jamais dans l'archive ; le script public du défi, si.
    const aws = records.filter(row => row.requestUrl.startsWith(AWS));
    expect(aws.map(row => [row.requestUrl.split('/').pop()!.split('?')[0], row.bytes === null, row.failure]))
      .toEqual([['challenge.js', false, null], ['inputs', true, 'CredentialNotArchived'], ['mp_verify', true, 'CredentialNotArchived']]);
    expect(records.some(row => row.bytes && Buffer.from(row.bytes).toString('utf8').includes('jeton-du-test'))).toBe(false);
    expect(context.wafBootstrapped).toBe(true); expect(context.unsupportedTransport).toBeUndefined();
    // La requête rejouée porte le jeton de CETTE collecte ; la première n'en portait aucun.
    expect(new Headers(transport.mock.calls[0][1]?.headers).get('cookie')).toBeNull();
    expect(new Headers(transport.mock.calls[1][1]?.headers).get('cookie')).toContain(COOKIE);
  });

  it('la dérivation lit du journal l’autorisation que la décision déclarera', async () => {
    network(); browser();
    const { records } = await collect({ wafBootstrap: wafBootstrapPolicy('ralph-lauren-avature', null) });
    const challenges = records.filter(row => row.status === 202 && row.headers['x-amzn-waf-action'] === 'challenge')
      .map(row => ({ sequence: row.sequence, url: row.requestData.hops.at(-1)!.request.url }));
    const bootstrap = records.filter(row => row.format === 'BROWSER_RESPONSE').map(row => ({ sequence: row.sequence,
      url: new URL(row.requestData.hops[0].request.url), method: row.requestData.hops[0].request.method, userAgent: row.requestData.hops[0].request.userAgent }));
    expect(deriveAccessBootstrap('ralph-lauren-avature', challenges, bootstrap)).toEqual(granted);
  });

  it('se rejoue hors réseau à l’identique : l’amorçage est consommé, jamais refait', async () => {
    network(); const { primer } = browser();
    const live = await collect({ wafBootstrap: wafBootstrapPolicy('ralph-lauren-avature', null) });
    const transport = vi.fn(async () => { throw new Error('Replay tried to use the network'); }); vi.stubGlobal('fetch', transport);
    const { run, left } = replay(live.records);
    expect(await run()).toEqual(live.result);
    expect(left()).toBe(0); expect(transport).not.toHaveBeenCalled(); expect(primer).toHaveBeenCalledTimes(1);
  });

  it('un rejeu sans l’amorçage inscrit diverge : le défi n’est pas levé', async () => {
    network(); browser();
    const live = await collect({ wafBootstrap: wafBootstrapPolicy('ralph-lauren-avature', null) });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Replay tried to use the network'); }));
    const { run } = replay(live.records.filter(row => row.format !== 'BROWSER_RESPONSE'));
    await expect(run()).rejects.toBeInstanceOf(WafChallengeError);
  });

  it('un amorçage inscrit que le rejeu ne consomme pas reste compté', async () => {
    network(); browser();
    const live = await collect({ wafBootstrap: wafBootstrapPolicy('ralph-lauren-avature', null) });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Replay tried to use the network'); }));
    const { run, left } = replay(live.records, true);
    await run();
    expect(left()).toBe(5);
  });
});

describe('aucun contournement général', () => {
  it('une source que D-483 ne nomme pas : aucun navigateur, le défi échoue comme avant', async () => {
    network(); const { primer } = browser();
    const { records, error } = await collect({ wafBootstrap: wafBootstrapPolicy('pvh', null) });
    expect(error).toBeInstanceOf(WafChallengeError);
    expect(primer).not.toHaveBeenCalled();
    expect(records.map(row => row.format)).toEqual(['HTTP_RESPONSE']);
  });

  it('une collecte sans politique d’amorçage (tout autre contexte) : aucun navigateur', async () => {
    network(); const { primer } = browser();
    const { error } = await collect({});
    expect(error).toBeInstanceOf(WafChallengeError); expect(primer).not.toHaveBeenCalled();
  });

  it('un autre fournisseur que le défi AWS ne s’amorce jamais dans une collecte', async () => {
    const { primer } = browser();
    await withCaptureContext({ sequence: 0, write: async () => {}, wafBootstrap: wafBootstrapPolicy('ralph-lauren-avature', null) }, async () => {
      expect(await primeWafCookie(LISTING, 'cloudflare')).toBeUndefined();
    });
    expect(primer).not.toHaveBeenCalled();
  });

  it('le jeton d’un amorçage hors collecte n’est jamais réutilisé par une collecte', async () => {
    const legacy = vi.fn(async () => 'aws-waf-token=hors-collecte'); setWafPrimer(legacy);
    expect(await primeWafCookie(LISTING)).toBe('aws-waf-token=hors-collecte');
    const transport = network(); const { primer } = browser();
    const { error } = await collect({ wafBootstrap: wafBootstrapPolicy('ralph-lauren-avature', null) });
    expect(error).toBeUndefined(); expect(primer).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls.every(call => !new Headers(call[1]?.headers).get('cookie')?.includes('hors-collecte'))).toBe(true);
  });

  it('pendant l’amorçage, une requête navigateur qui n’en fait pas partie reste un transport non certifié', async () => {
    const store: CaptureContext = { sequence: 0, write: async () => {}, wafBootstrapRun: { origin: ORIGIN, cookie: Promise.resolve(undefined) } };
    const request = { url: `${ORIGIN}/rendu`, format: 'BROWSER_RESPONSE' as const, headers: { 'user-agent': BROWSER_USER_AGENT } };
    const hop = observedHop(describeRequest(request), { status: 200, headers: new Headers() });
    await withCaptureContext(store, () => captureResponse({ ...request, transport: { origin: 'BROWSER_TRANSPORT', hops: [hop] } },
      { status: 200, headers: new Headers(), bytes: Buffer.from('page'), complete: true }));
    expect(store.unsupportedTransport).toBe(true); expect(store.wafBootstrapped).toBeUndefined();
    // Contre-épreuve : la même requête marquée par l'amorçage de CETTE collecte est un transport inscrit ; la marque
    // d'un autre amorçage ne l'est pas.
    const foreign: CaptureContext = { ...store, unsupportedTransport: undefined };
    await withCaptureContext(foreign, () => captureResponse({ ...request, wafBootstrap: { origin: ORIGIN, cookie: Promise.resolve(undefined) }, transport: { origin: 'BROWSER_TRANSPORT', hops: [hop] } },
      { status: 200, headers: new Headers(), bytes: Buffer.from('page'), complete: true }));
    expect(foreign.unsupportedTransport).toBe(true); expect(foreign.wafBootstrapped).toBeUndefined();
    const marked: CaptureContext = { ...store, unsupportedTransport: undefined };
    await withCaptureContext(marked, () => captureResponse({ ...request, wafBootstrap: marked.wafBootstrapRun, transport: { origin: 'BROWSER_TRANSPORT', hops: [hop] } },
      { status: 200, headers: new Headers(), bytes: Buffer.from('page'), complete: true }));
    expect(marked.unsupportedTransport).toBeUndefined(); expect(marked.wafBootstrapped).toBe(true);
  });

  it('un seul amorçage par collecte : une seconde origine défiée échoue sans navigateur', async () => {
    network(); const { primer } = browser();
    await withCaptureContext({ sequence: 0, write: async () => {}, wafBootstrap: () => ({ allow: () => true }) }, async () => {
      expect(await primeWafCookie(LISTING)).toBe(COOKIE);
      expect(await primeWafCookie('https://ralphlauren.avature.net/jobs')).toBeUndefined();
    });
    expect(primer).toHaveBeenCalledTimes(1);
  });
});

describe('collecte du RUN, sous décision d’accès', () => {
  const access = (bootstraps?: AccessBootstrap[]) => ({ decision: { validUntil: new Date(Date.now() + 86_400_000) },
    document: { bootstraps } }) as unknown as Parameters<typeof wafBootstrapPolicy>[1];

  it('une décision qui déclare l’amorçage : les mêmes 5 requêtes, et la page', async () => {
    network(); const { sent } = browser();
    const { records, error, context } = await collect({ wafBootstrap: wafBootstrapPolicy('ralph-lauren-avature', access([granted])) });
    expect(error).toBeUndefined(); expect(sent).toHaveLength(5);
    expect(records.filter(row => row.format === 'BROWSER_RESPONSE')).toHaveLength(5);
    expect(context.wafBootstrapped).toBe(true);
  });

  it('une décision sans amorçage arrête la collecte, même si le lecteur avale l’erreur', async () => {
    network(); const { primer } = browser();
    const store: CaptureContext = { sequence: 0, write: async () => {}, wafBootstrap: wafBootstrapPolicy('ralph-lauren-avature', access()) };
    await withCaptureContext(store, async () => {
      await expect(primeWafCookie(LISTING)).rejects.toMatchObject({ code: 'ACCESS_SCOPE' });
      expect(() => assertCaptureHealthy()).toThrow(/outside the reviewed access decision/);
    });
    expect(primer).not.toHaveBeenCalled();
  });

  it('une décision qui nomme un autre hôte du défi : le script réel ne part pas, pas de jeton, la collecte s’arrête', async () => {
    network(); const { sent } = browser();
    const { error, context } = await collect({ wafBootstrap: wafBootstrapPolicy('ralph-lauren-avature',
      access([{ ...granted, challengeHosts: ['https://autre.us-east-1.token.awswaf.com'] }])) });
    expect(sent.every(line => line.includes(`GET ${LISTING}`))).toBe(true);
    expect(error).toBeInstanceOf(WafChallengeError);
    expect(context.accessFailure).toBeInstanceOf(WafChallengeError);
  });

  it('une décision expirée pendant la collecte refuse l’amorçage', async () => {
    const policy = wafBootstrapPolicy('ralph-lauren-avature', { decision: { validUntil: new Date(Date.now() - 1) }, document: { bootstraps: [granted] } } as never);
    expect(() => policy(LISTING)).toThrow(/expired/);
  });
});
