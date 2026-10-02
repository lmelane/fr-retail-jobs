import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertCaptureHealthy, withCaptureContext, type CaptureContext, type CaptureRecord } from '../capture/context.js';
import { offlineReplay } from '../capture/offlineReplay.js';
import type { BootstrapObserver } from './browser.js';
import { BROWSER_USER_AGENT } from './browser.js';

vi.mock('./hostGate.js', () => ({ withHostGate: async (_url: string, run: () => Promise<unknown>) => run(), reportThrottle: () => {}, reportSuccess: () => {} }));
vi.mock('./sourceBudget.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./sourceBudget.js')>()), sourceDelay: vi.fn(async () => undefined) }));

import { wafBootstrapPolicy } from '../capture/batch.js';
import { assertJournaledBootstrap, deriveAccessBootstrap, MAX_COLLECTION_BOOTSTRAPS, type AccessBootstrap } from '../connectors/wafBootstrap.js';
import { fetchAvatureJobs } from '../ats/adapters/avature.js';
import { log } from '../observability/logger.js';
import { HttpStatusError } from './http.js';
import { clearWafTokens, setWafPrimer, WafChallengeError } from './wafToken.js';

/*
 * D-516 §1 (02/10/2026) — LE JETON ANTI-ROBOT REFUSÉ EN COURS DE COLLECTE.
 *
 * Forme RÉELLE reproduite : la collecte d'ingestion c81e14a5 du 02/10/2026 (production, lecture seule,
 * `audits/2026-10-02/d516-ralph-lauren/`) — défi 202 sur la page 0, amorçage de 5 requêtes, pages 0 (`jobOffset=0`) et
 * 1 (`jobOffset=6`) acceptées avec le jeton, page 2 (`jobOffset=12`) refusée par un 406 au corps nginx, 4,2 s après
 * l'amorçage. Le VRAI transport (`fetchText` → `fetchWithRetry`), le VRAI lecteur Avature et la VRAIE politique de
 * collecte sont exercés ; seuls Chromium (les 5 requêtes mesurées le 30/09) et le réseau sont simulés.
 */
const ORIGIN = 'https://careers.ralphlauren.com';
const LISTING = `${ORIGIN}/en_US/CareersCorporate/SearchJobsCorporate/?jobOffset=0&listFilterMode=1`;
const AWS = 'https://7d6e0277a337.42c8209d.us-east-1.token.awswaf.com';
const NGINX_406 = '<html>\r\n<head><title>406 Not Acceptable</title></head>\r\n<body bgcolor="white">\r\n<center><h1>406 Not Acceptable</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';
const page0 = gunzipSync(readFileSync(new URL('../ats/adapters/__fixtures__/avature-ralphlauren-corporate-p0-20260919.html.gz', import.meta.url))).toString('utf8');
type Measured = { method: string; url: string; resourceType: string; status: number | null };
const measured = JSON.parse(readFileSync(new URL('../connectors/__fixtures__/ralph-lauren-amorcage-20260930.json', import.meta.url), 'utf8')) as
  { borne: { requests: Measured[] } };
const exact = (request: Measured) => request.url.startsWith(`${ORIGIN}/en_US/CareersCorporate/SearchJobsCorporate/?`) ? LISTING : request.url;
const granted: AccessBootstrap = { vendor: 'AWS_WAF_CHALLENGE', origin: ORIGIN, challengeHosts: [AWS] };
const PAGES = 4;

/** La page `n` de la liste : la page archivée du 19/09, ses 6 offres renumérotées (des offres distinctes par page). */
const page = (n: number) => n === 0 ? page0 : page0.replace(/jobId=(\d+)/g, (_, id: string) => `jobId=${Number(id) + 100_000 * n}`);
const offsetOf = (url: string) => Number(new URL(url).searchParams.get('jobOffset') ?? -1);
const tokenOf = (init?: RequestInit) => /aws-waf-token=([^;]+)/.exec(new Headers(init?.headers).get('cookie') ?? '')?.[1];

type Answer = { status: number; body?: string; headers?: Record<string, string> };
const challenge: Answer = { status: 202, headers: { 'x-amzn-waf-action': 'challenge', 'content-type': 'text/html; charset=UTF-8' } };
/**
 * Le réseau de la source : le défi à toute requête sans jeton ; avec un jeton, `refuse(url, jeton, rang de la
 * requête munie de ce jeton)` décide d'un refus, sinon la page (liste) ou une fiche.
 */
function network(refuse: (url: string, token: string, rank: number) => Answer | null) {
  const ranks = new Map<string, number>();
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const token = tokenOf(init);
    const answer = (value: Answer) => new Response(value.status === 202 ? null : value.body ?? '', { status: value.status, headers: { 'content-type': 'text/html', ...value.headers } });
    if (!token) return answer(challenge);
    const rank = (ranks.get(token) ?? 0) + 1; ranks.set(token, rank);
    const refused = refuse(url, token, rank);
    if (refused) return answer(refused);
    if (url.includes('JobDetail')) return answer({ status: 200, body: '<html><body>fiche</body></html>' });
    return answer({ status: 200, body: page(offsetOf(url) / 6), headers: { 'content-type': 'text/html;charset=UTF-8' } });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Le navigateur simulé : les 5 requêtes de l'amorçage borné mesuré le 30/09, puis un jeton NOUVEAU à chaque amorçage. */
function browser(tokenFor: (call: number) => string | undefined = call => `jeton-${call}`) {
  let calls = 0;
  const primer = vi.fn(async (url: string, observer?: BootstrapObserver) => {
    if (!observer) throw new Error('A collection never bootstraps without an observer');
    const call = ++calls;
    for (const request of measured.borne.requests) {
      const target = { url: exact(request), method: request.method, resourceType: request.resourceType };
      if (!observer.allow(target)) continue;
      await observer.record({ ...target, postData: null, requestHeaders: { 'user-agent': BROWSER_USER_AGENT, cookie: 'jamais-archive' },
        status: request.status, responseHeaders: { 'content-type': 'text/plain' }, body: Buffer.from(`corps ${request.url}`), failure: null });
    }
    expect(url).toBe(LISTING);
    const token = tokenFor(call);
    return token ? `aws-waf-token=${token}` : undefined;
  });
  setWafPrimer(primer);
  return primer;
}

const access = (bootstraps: AccessBootstrap[] = [granted]) => ({ decision: { validUntil: new Date(Date.now() + 86_400_000) },
  document: { bootstraps } }) as unknown as Parameters<typeof wafBootstrapPolicy>[1];

async function collect(config: Record<string, unknown>, decision: Parameters<typeof wafBootstrapPolicy>[1] = access()) {
  const records: CaptureRecord[] = [];
  const context: CaptureContext = { sequence: 0, observedAt: new Date('2026-10-02T10:05:34.208Z'), write: async row => { records.push(row); },
    wafBootstrap: wafBootstrapPolicy('ralph-lauren-avature', decision) };
  let result: Awaited<ReturnType<typeof fetchAvatureJobs>> | undefined; let error: unknown;
  try { result = await withCaptureContext(context, async () => { const read = await fetchAvatureJobs(config); assertCaptureHealthy(); return read; }); }
  catch (caught) { error = caught; }
  return { records, result, error, context };
}

const listOnly = { origin: ORIGIN, lists: ['en_US/CareersCorporate/SearchJobsCorporate'], maxPages: PAGES, withDescriptions: false };
const withDetails = { ...listOnly, maxPages: 2, withDescriptions: true, detailConcurrency: 4 };
const browserRows = (records: CaptureRecord[]) => records.filter(row => row.format === 'BROWSER_RESPONSE');
const journal = (context: CaptureContext) => [context.wafJournal?.challenges ?? [], context.wafJournal?.bootstrap ?? []] as const;
/** La forme du 02/10 : le premier jeton est refusé (406, corps nginx) à la 3e page qu'il porte. */
const refusedAtThirdPage = (url: string, token: string, rank: number): Answer | null =>
  token === 'jeton-1' && rank === 3 && offsetOf(url) === 12 ? { status: 406, body: NGINX_406 } : null;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { vi.stubEnv('PIPELINE_PAUSED', '0'); clearWafTokens(); vi.spyOn(console, 'error').mockImplementation(() => {});
  warn = vi.spyOn(log, 'warn'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); setWafPrimer(undefined); clearWafTokens(); });

describe('D-516 §1 — prémisses du témoin', () => {
  it('la forme simulée est celle du 02/10 : deux pages acceptées avec le premier jeton, la troisième refusée en 406 nginx', async () => {
    const transport = network(refusedAtThirdPage); browser(() => 'jeton-1');
    const { records } = await collect(listOnly);
    const http = records.filter(row => row.format === 'HTTP_RESPONSE').map(row => row.status);
    // 202 (défi), page 0, page 1, puis le 406 sur `jobOffset=12` — exactement la séquence archivée de c81e14a5.
    expect(http.slice(0, 4)).toEqual([202, 200, 200, 406]);
    expect(transport.mock.calls.slice(1, 4).map(call => [offsetOf(call[0]), tokenOf(call[1])])).toEqual([[0, 'jeton-1'], [6, 'jeton-1'], [12, 'jeton-1']]);
    expect(page(1)).not.toBe(page(0));
  });
});

describe('D-516 §1 — refus en cours de collecte, puis réamorçage réussi', () => {
  it('le jeton refusé après une page acceptée est redemandé UNE fois, sous la même autorisation ; la liste est lue en entier', async () => {
    const transport = network(refusedAtThirdPage); const primer = browser();
    const { result, error, context, records } = await collect(listOnly);
    expect(error).toBeUndefined();
    expect(result!.jobs).toHaveLength(PAGES * 6);
    expect(primer).toHaveBeenCalledTimes(2);
    expect(context.wafBootstrapCount).toBe(2);
    // La page refusée est relue avec le NOUVEAU jeton ; les suivantes aussi.
    const after = transport.mock.calls.filter(call => tokenOf(call[1]) === 'jeton-2').map(call => offsetOf(call[0]));
    expect(after).toEqual([12, 18]);
    // Les deux amorçages sont au journal de la collecte (5 + 5), sous l'identité du collecteur, sans jeton archivé.
    expect(browserRows(records)).toHaveLength(10);
    expect(JSON.stringify(records.map(row => row.requestData))).not.toContain('jamais-archive');
    expect(records.some(row => row.bytes && Buffer.from(row.bytes).toString('utf8').includes('jeton-'))).toBe(false);
    // Même autorisation : le journal entier tient dans l'amorçage déclaré par la décision.
    expect(() => assertJournaledBootstrap('ralph-lauren-avature', [granted], ...journal(context))).not.toThrow();
    // Une trace au journal d'exploitation.
    expect(warn).toHaveBeenCalledWith('waf.bootstrap_renewed', expect.objectContaining({ origin: ORIGIN, status: 406, bootstrap: 2, max: 2 }));
    // La trace ne porte jamais un jeton.
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/jeton-|aws-waf-token/);
  });

  it('un 403 ou un nouveau défi après une page acceptée déclenche le même renouvellement unique', async () => {
    for (const refusal of [{ status: 403, body: '<html><head><title>403 Forbidden</title></head></html>' }, challenge]) {
      clearWafTokens();
      network((url, token, rank) => token === 'jeton-1' && rank === 2 ? refusal : null); const primer = browser();
      const { result, error } = await collect(listOnly);
      expect(error).toBeUndefined();
      expect(result!.jobs).toHaveLength(PAGES * 6);
      expect(primer).toHaveBeenCalledTimes(2);
    }
  });

  it('en qualification (aucune décision), la dérivation lit des deux amorçages la même autorisation', async () => {
    network(refusedAtThirdPage); browser();
    const { error, context } = await collect(listOnly, null);
    expect(error).toBeUndefined();
    expect(deriveAccessBootstrap('ralph-lauren-avature', ...journal(context))).toEqual(granted);
  });

  it('se rejoue hors réseau à l’identique : aucun amorçage refait, toute l’archive consommée', async () => {
    network(refusedAtThirdPage); const primer = browser();
    const live = await collect(listOnly);
    expect(live.error).toBeUndefined();
    const transport = vi.fn(async () => { throw new Error('Replay tried to use the network'); }); vi.stubGlobal('fetch', transport);
    const { context, left } = offlineReplay(live.records.map(row => ({ ...row, data: row.requestData })), async row => row,
      { observedAt: new Date('2026-10-02T10:05:34.208Z'), legacyBootstrap: false });
    const replayed = await withCaptureContext(context, async () => { const read = await fetchAvatureJobs(listOnly); assertCaptureHealthy(); return read; });
    expect(replayed).toEqual(live.result);
    expect(left()).toBe(0); expect(transport).not.toHaveBeenCalled(); expect(primer).toHaveBeenCalledTimes(2);
  });

  it('des fiches lues en parallèle refusées ensemble : un seul renouvellement, toutes relues avec le nouveau jeton', async () => {
    // Le premier jeton est refusé à partir de sa 4e requête (2 pages, puis les fiches, 4 à la fois).
    network((url, token, rank) => token === 'jeton-1' && rank >= 4 ? { status: 406, body: NGINX_406 } : null); const primer = browser();
    const { result, error } = await collect(withDetails);
    expect(error).toBeUndefined();
    expect(primer).toHaveBeenCalledTimes(2);
    expect(result!.jobs.every(job => (job.raw as Record<string, unknown>).avaturePortalDetail)).toBe(true);
  });
});

describe('D-516 §1 — deux refus : échec franc', () => {
  it('le jeton renouvelé refusé à son tour sur une page de LISTE : la collecte échoue sur le 406, sans troisième amorçage', async () => {
    network((url, token, rank) => (token === 'jeton-1' && rank === 3) || token === 'jeton-2' ? { status: 406, body: NGINX_406 } : null);
    const primer = browser();
    const { result, error, context } = await collect(listOnly);
    expect(result).toBeUndefined();
    expect(error).toBeInstanceOf(HttpStatusError); expect((error as HttpStatusError).status).toBe(406);
    expect(primer).toHaveBeenCalledTimes(2);
    expect(context.wafBootstrapCount).toBe(2);
    expect(warn).toHaveBeenCalledWith('waf.token_refused', expect.objectContaining({ origin: ORIGIN, status: 406, bootstraps: 2, max: 2 }));
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/jeton-|aws-waf-token/);
  });

  it('refusé encore sur des FICHES : chaque offre garde sa carte, comme avant le lot (critère 8 de D-483)', async () => {
    // Arbitrage du 02/10/2026 : seul un refus de la liste fait échouer la collecte ; une fiche refusée après le
    // renouvellement garde l'offre de liste, et le critère 8 (descriptions) la juge.
    // Le premier jeton est refusé dès la première fiche (sa 3e requête, après les 2 pages de liste).
    network((url, token, rank) => (token === 'jeton-1' && rank >= 3) || (token === 'jeton-2' && url.includes('JobDetail')) ? { status: 406, body: NGINX_406 } : null);
    const primer = browser();
    const { result, error, context } = await collect(withDetails);
    expect(error).toBeUndefined();
    expect(context.accessFailure).toBeUndefined();
    expect(result!.jobs).toHaveLength(12);
    expect(result!.jobs.some(job => (job.raw as Record<string, unknown>).avaturePortalDetail)).toBe(false);
    expect(primer).toHaveBeenCalledTimes(2);
    // Une trace, pas une par fiche refusée.
    expect(warn.mock.calls.filter((call: unknown[]) => call[0] === 'waf.token_refused')).toHaveLength(1);
  });

  it('1 131 offres dont un tiers de fiches refusées après le renouvellement : les 1 131 offres sont extraites', async () => {
    const LAST = 188; // 188 pages de 6 + une de 3 = 1 131
    const cards = [...page(LAST).matchAll(/<article class="article article--result[\s\S]*?<\/article>/g)].map(match => match[0]);
    expect(cards).toHaveLength(6);
    const listing = (n: number) => n < LAST ? page(n) : cards.slice(3).reduce((html, card) => html.replace(card, ''), page(LAST));
    const refusedDetail = (url: string) => url.includes('JobDetail') && Number(new URL(url).searchParams.get('jobId')) % 3 === 0;
    const transport = network((url, token) => refusedDetail(url) ? { status: 406, body: NGINX_406 } : null);
    transport.mockImplementation(async (url: string, init?: RequestInit) => {
      const token = tokenOf(init);
      if (!token) return new Response(null, { status: 202, headers: { 'x-amzn-waf-action': 'challenge' } });
      if (refusedDetail(url)) return new Response(NGINX_406, { status: 406, headers: { 'content-type': 'text/html' } });
      if (url.includes('JobDetail')) return new Response('<html><body>fiche</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response(listing(Math.min(LAST, offsetOf(url) / 6)), { status: 200, headers: { 'content-type': 'text/html;charset=UTF-8' } });
    });
    const primer = browser();
    const { result, error } = await collect({ ...withDetails, maxPages: 300 });
    expect(error).toBeUndefined();
    expect(result!.jobs).toHaveLength(1131);
    const refused = result!.jobs.filter(job => !(job.raw as Record<string, unknown>).avaturePortalDetail);
    // Prémisse : environ un tiers des fiches est refusé, et chaque offre refusée est bien dans le résultat.
    expect(refused.length).toBeGreaterThan(300); expect(refused.length).toBeLessThan(460);
    expect(refused.every(job => Number(job.externalId) % 3 === 0)).toBe(true);
    expect(primer).toHaveBeenCalledTimes(2);
  });

  it('un renouvellement qui n’obtient pas de jeton : échec franc, pas de troisième essai', async () => {
    network(refusedAtThirdPage); const primer = browser(call => call === 1 ? 'jeton-1' : undefined);
    const { result, error } = await collect(listOnly);
    expect(result).toBeUndefined(); expect(error).toBeInstanceOf(WafChallengeError);
    expect(primer).toHaveBeenCalledTimes(2);
  });
});

describe('D-516 §1 — jamais plus de deux amorçages par collecte', () => {
  it('chaque jeton refusé dès sa 2e requête : exactement deux amorçages, puis l’échec sur la liste', async () => {
    network((url, token, rank) => rank >= 2 ? { status: 406, body: NGINX_406 } : null); const primer = browser();
    const { error, records } = await collect(listOnly);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect(primer).toHaveBeenCalledTimes(MAX_COLLECTION_BOOTSTRAPS);
    expect(MAX_COLLECTION_BOOTSTRAPS).toBe(2);
    expect(browserRows(records)).toHaveLength(10);
  });

  it('un refus AVANT toute page acceptée (forme du 19/09, abe33bc1) n’est pas un jeton refusé en cours de collecte : comportement d’avant', async () => {
    network((url, token, rank) => token === 'jeton-1' && rank === 1 ? { status: 406, body: NGINX_406 } : null); const primer = browser();
    const { error } = await collect(listOnly);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect(primer).toHaveBeenCalledTimes(1);
  });

  it('un 403 AVANT toute page acceptée : aucun renouvellement, les 3 essais d’avant avec le même jeton', async () => {
    const transport = network((url, token) => token === 'jeton-1' ? { status: 403, body: '<html><head><title>403 Forbidden</title></head></html>' } : null);
    const primer = browser();
    const { error } = await collect(listOnly);
    expect(error).toBeInstanceOf(HttpStatusError); expect((error as HttpStatusError).status).toBe(403);
    expect(primer).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls.filter(call => tokenOf(call[1]) === 'jeton-1')).toHaveLength(3);
    expect(warn.mock.calls.some((call: unknown[]) => call[0] === 'waf.bootstrap_renewed')).toBe(false);
  });

  it('une décision qui n’autorise plus l’amorçage au moment du renouvellement : échec franc, aucun navigateur', async () => {
    let valid = true;
    // La décision expire à l'instant du refus : le renouvellement la relit et ne part pas.
    network((url, token, rank) => { const refusal = refusedAtThirdPage(url, token, rank); if (refusal) valid = false; return refusal; });
    const primer = browser();
    const decision = { decision: { get validUntil() { return new Date(Date.now() + (valid ? 86_400_000 : -1)); } }, document: { bootstraps: [granted] } } as never;
    const { error, context } = await collect(listOnly, decision);
    expect(error).toMatchObject({ code: 'ACCESS_STALE' });
    expect(primer).toHaveBeenCalledTimes(1);
    expect(context.wafBootstrapCount).toBe(1);
  });
});
