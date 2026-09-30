/**
 * D-453 §3 — PREUVE EN DIRECT, lecture seule : careers.ralphlauren.com lu par le transport de PRODUCTION.
 *
 *  1. prémisse : la connexion par défaut de Node refuse l'hôte (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) — sinon
 *     la preuve ne prouverait rien, et le script le dit ;
 *  2. la page de liste Corporate et robots.txt par `fetchFollowingSafely` (lib/http.ts → `publicDispatcher`
 *     → `chainCompletingFactory`), sans aucun traitement WAF : statut, `x-amzn-waf-action`, cartes lues ;
 *  3. la même page par `fetchText` SOUS une politique d'accès, comme le RUN (`ingest.ts` passe
 *     `requireActive: true`, `capture/batch.ts` pose alors `requestAccess`) — AVANT tout amorçage, pour
 *     qu'aucun jeton déjà obtenu ne masque le défi ;
 *  4. la même page par `fetchText` hors politique, le chemin de l'adaptateur Avature en local ;
 *  5. les événements `tls.chain_completed` / `tls.chain_completion_refused` / `waf.*` du journal.
 * Aucune base, aucune écriture. Trafic : la prémisse (une poignée de main), robots.txt, trois lectures de la
 * page de liste, l'intermédiaire chez l'autorité (une fois), et la navigation d'amorçage si l'hôte pose un défi.
 *
 * usage : npx tsx scripts/ops/verif-chaine-tls-d453.mts
 */
import tls from 'node:tls';
import { installLogger, OperationalLogger } from '../../src/observability/logger.js';
import { fetchFollowingSafely, fetchText, readBodyBounded } from '../../src/lib/http.js';
import { CRAWLER_IDENTITY } from '../../src/lib/crawlerIdentity.js';
import { parseAvaturePortalListing } from '../../src/ats/adapters/avature.js';
import { closeBrowser } from '../../src/lib/browser.js';
import { withCaptureContext } from '../../src/capture/context.js';

const HOST = 'careers.ralphlauren.com';
// La liste Corporate, telle que l'adaptateur la demande (`fetchAvaturePortalJobs`, avature.ts).
const LISTING = `https://${HOST}/en_US/CareersCorporate/SearchJobsCorporate/?jobOffset=0&listFilterMode=1`;
const HEADERS = { 'user-agent': CRAWLER_IDENTITY };

const events: Record<string, unknown>[] = [];
installLogger(new OperationalLogger({ runId: `verif-d453-${Date.now()}`, write: async line => {
  const record = JSON.parse(line) as Record<string, unknown>;
  if (/^(tls|waf)\./.test(String(record.event))) events.push({ event: record.event, data: record.data });
} }));

function premise(): Promise<string> {
  return new Promise(resolve => {
    const socket = tls.connect({ host: HOST, port: 443, servername: HOST, timeout: 15_000 });
    socket.once('secureConnect', () => { socket.destroy(); resolve('ACCEPTED'); });
    socket.once('error', (error: NodeJS.ErrnoException) => { socket.destroy(); resolve(error.code ?? error.message); });
    socket.once('timeout', () => { socket.destroy(); resolve('TIMEOUT'); });
  });
}

const cards = (html: string) => { const parsed = parseAvaturePortalListing(html); return { cards: parsed.jobs.length, declaredTotal: parsed.declaredTotal ?? null }; };
const failure = (error: unknown) => {
  const e = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  return { name: e?.name, message: e?.message, cause: e?.cause?.code ?? e?.cause?.message };
};

const report: Record<string, unknown> = { node: process.version, at: new Date().toISOString(), host: HOST, listing: LISTING };
report.premise = await premise();

async function raw(url: string) {
  try {
    const response = await fetchFollowingSafely(url, { headers: HEADERS }, AbortSignal.timeout(45_000));
    const body = await readBodyBounded(response, url);
    return { status: response.status, wafAction: response.headers.get('x-amzn-waf-action'),
      contentType: response.headers.get('content-type'), bytes: Buffer.byteLength(body), body };
  } catch (error) { return { failed: failure(error) }; }
}

const listing = await raw(LISTING);
report.transport = 'body' in listing ? { ...listing, body: undefined, ...cards(listing.body ?? '') } : listing;
const robots = await raw(`https://${HOST}/robots.txt`);
report.robots = 'body' in robots ? { ...robots, body: undefined } : robots;

// Politique d'accès qui accepte tout : seule sa PRÉSENCE compte ici, c'est elle que teste `noteUnsupportedTransport`.
try {
  const body = await withCaptureContext({ sequence: 0, requestAccess: () => undefined }, () => fetchText(LISTING, { headers: HEADERS }));
  report.underAccessPolicy = { bytes: Buffer.byteLength(body), ...cards(body) };
} catch (error) { report.underAccessPolicy = { failed: failure(error) }; }

try {
  const body = await fetchText(LISTING, { headers: HEADERS });
  report.adapterPath = { bytes: Buffer.byteLength(body), ...cards(body) };
} catch (error) { report.adapterPath = { failed: failure(error) }; }

report.events = events;
report.verdict = report.premise !== 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ? 'PREMISSE_NON_REMPLIE'
  : events.some(e => e.event === 'tls.chain_completed') && (report.transport as { status?: number }).status ? 'CHAINE_COMPLETEE' : 'ECHEC';
console.log(JSON.stringify(report, null, 2));
await closeBrowser();
process.exit(report.verdict === 'CHAINE_COMPLETEE' ? 0 : 1);
