/**
 * D-483 — MESURE, lecture seule : ce que fait le défi anti-robot de careers.ralphlauren.com, et ce que fait
 * l'amorçage du navigateur qui le lève. Aucune base, aucune écriture. Trafic borné, jamais en boucle :
 *
 *  1. la page de liste Corporate par le transport HTTP de production (`fetchFollowingSafely`, identité
 *     `CRAWLER_IDENTITY`) : statut, `x-amzn-waf-action`, taille du corps ;
 *  2. robots.txt de l'origine, et son verdict pour la liste et une fiche (`robotsVerdictFor`, CatwalksBot) ;
 *  3. UN amorçage navigateur (`primeWafToken` avec observateur) : chaque requête que le navigateur envoie est
 *     décrite (hôte, chemin, méthode, type de ressource, statut, type et empreinte du corps) — les valeurs de
 *     requête et de cookie ne sont jamais écrites. En mode `--observer` l'observateur autorise tout ce que le
 *     garde public autorise déjà (mesure de ce que le défi demande) ; en mode `--borne` il applique l'autorisation
 *     du lot (`bootstrapAllow`, ci-dessous importée), pour prouver que l'amorçage borné obtient le jeton ;
 *  4. la même page de liste avec le jeton obtenu : statut, cartes lues, total annoncé.
 *
 * usage : npx tsx scripts/ops/mesure-amorcage-waf-d483.mts [--observer|--borne] > sortie.json
 */
import { createHash } from 'node:crypto';
import { installLogger, OperationalLogger } from '../../src/observability/logger.js';
import { fetchFollowingSafely, readBodyBounded } from '../../src/lib/http.js';
import { CRAWLER_IDENTITY } from '../../src/lib/crawlerIdentity.js';
import { robotsVerdictFor } from '../../src/lib/robotsVerdict.js';
import { parseAvaturePortalListing } from '../../src/ats/adapters/avature.js';
import { closeBrowser, primeWafToken, type BootstrapObservation } from '../../src/lib/browser.js';
import { observeModeAllow } from '../../src/connectors/wafBootstrap.js';

const HOST = 'careers.ralphlauren.com';
const ORIGIN = `https://${HOST}`;
const LISTING = `${ORIGIN}/en_US/CareersCorporate/SearchJobsCorporate/?jobOffset=0&listFilterMode=1`;
const DETAIL = '/en_US/CareersCorporate/JobDetailCorporate?jobId=1';
const mode = process.argv.includes('--borne') ? 'borne' : 'observer';

const events: Record<string, unknown>[] = [];
installLogger(new OperationalLogger({ runId: `mesure-d483-${Date.now()}`, write: async line => {
  const record = JSON.parse(line) as Record<string, unknown>;
  if (/^(tls|waf)\./.test(String(record.event))) events.push({ event: record.event, data: record.data });
} }));

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
/** L'adresse sans les valeurs de requête : les noms de paramètres suffisent à décrire la forme. */
const shape = (value: string) => {
  const url = new URL(value);
  return `${url.origin}${url.pathname}${[...url.searchParams.keys()].length ? `?${[...url.searchParams.keys()].join('&')}` : ''}`;
};

async function plain(url: string, cookie?: string) {
  const started = Date.now();
  const response = await fetchFollowingSafely(url, { headers: { 'user-agent': CRAWLER_IDENTITY, ...(cookie ? { cookie } : {}) } },
    AbortSignal.timeout(45_000));
  const body = await readBodyBounded(response, url);
  return { status: response.status, wafAction: response.headers.get('x-amzn-waf-action'), contentType: response.headers.get('content-type'),
    bytes: Buffer.byteLength(body), sha256: sha(body), ms: Date.now() - started, body };
}

const report: Record<string, unknown> = { node: process.version, at: new Date().toISOString(), mode, listing: shape(LISTING) };
const first = await plain(LISTING);
report.challenge = { ...first, body: undefined };
const robots = await plain(`${ORIGIN}/robots.txt`);
report.robots = { status: robots.status, bytes: robots.bytes, sha256: robots.sha256,
  listing: robotsVerdictFor(robots.body, new URL(LISTING).pathname + new URL(LISTING).search),
  detail: robotsVerdictFor(robots.body, DETAIL) };

const observed: Record<string, unknown>[] = [];
const blocked: Record<string, unknown>[] = [];
const allow = mode === 'borne' ? observeModeAllow(LISTING) : () => true;
const started = Date.now();
let token: string | undefined;
try {
  token = await primeWafToken(LISTING, {
    allow: request => { const ok = allow(request); if (!ok) blocked.push({ ...request, url: shape(request.url) }); return ok; },
    record: async (item: BootstrapObservation) => {
      observed.push({ method: item.method, url: shape(item.url), resourceType: item.resourceType, status: item.status,
        failure: item.failure, contentType: item.responseHeaders['content-type'] ?? null, wafAction: item.responseHeaders['x-amzn-waf-action'] ?? null,
        setCookie: /set-cookie/i.test(Object.keys(item.responseHeaders).join(',')), bytes: item.body?.byteLength ?? null,
        sha256: item.body ? sha(item.body) : null, userAgent: item.requestHeaders?.['user-agent'] ?? null,
        postBytes: item.postData?.byteLength ?? 0 });
    },
  });
} catch (error) { report.bootstrapError = error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
report.bootstrap = { ms: Date.now() - started, token: token ? token.split('=')[0] : null, requests: observed, blocked };

if (token) {
  const after = await plain(LISTING, token);
  const parsed = parseAvaturePortalListing(after.body);
  report.withToken = { ...after, body: undefined, cards: parsed.jobs.length, declaredTotal: parsed.declaredTotal ?? null };
}
report.events = events;
console.log(JSON.stringify(report, null, 2));
await closeBrowser();
process.exit(0);
