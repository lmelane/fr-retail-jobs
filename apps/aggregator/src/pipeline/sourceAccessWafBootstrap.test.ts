import '../test/setup-integration.js';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient, type Source } from '@prisma/client';
import { captureExtraction } from '../capture/batch.js';
import { fetchAtsJobs } from '../ats/index.js';
import { validateCapturedSource } from '../connectors/sourceValidation.js';
import { qualifySourceAccess } from '../connectors/sourceAccessQualification.js';
import { recordSourceAccessDecision, requireSourceAccess } from '../connectors/sourceAccess.js';
import type { AccessDocument } from '../connectors/accessScope.js';
import { BROWSER_USER_AGENT } from '../lib/browser.js';
import { setWafPrimer } from '../lib/wafToken.js';
import type { BootstrapObserver } from '../lib/browser.js';

/*
 * D-483 — LA PREUVE D'ACCÈS COUVRE L'AMORÇAGE, BASE RÉELLE (archive, rejeu, inspection, garde SQL).
 *
 * Réseau simulé à partir de réponses réelles : le défi de careers.ralphlauren.com (`202`, `x-amzn-waf-action:
 * challenge`, corps vide) et la page 0 de la liste Corporate archivée le 19/09/2026 (lot 7b16d898). Le navigateur
 * est simulé par les 5 requêtes de l'amorçage borné mesuré le 30/09 ; tout le reste (collecte, journal, rejeu
 * hors réseau, dérivation, inspection et `bind_source_access_decision`) est le chemin de production.
 */
const db = new PrismaClient();
const KEY = 'ralph-lauren-avature';
const ORIGIN = 'https://careers.ralphlauren.com';
const LISTING = `${ORIGIN}/en_US/CareersCorporate/SearchJobsCorporate/?jobOffset=0&listFilterMode=1`;
const AWS = 'https://7d6e0277a337.42c8209d.us-east-1.token.awswaf.com';
const COOKIE = 'aws-waf-token=jeton-integration';
const config = { origin: ORIGIN, lists: ['en_US/CareersCorporate/SearchJobsCorporate'] };
const page0 = gunzipSync(readFileSync(new URL('../ats/adapters/__fixtures__/avature-ralphlauren-corporate-p0-20260919.html.gz', import.meta.url)));
const BOUNDED = [
  { url: LISTING, method: 'GET', resourceType: 'document', status: 202 },
  { url: `${AWS}/7d6e0277a337/580a42a23f40/39f553e05fca/challenge.js`, method: 'GET', resourceType: 'script', status: 200 },
  { url: `${AWS}/7d6e0277a337/580a42a23f40/39f553e05fca/inputs?client=browser`, method: 'GET', resourceType: 'fetch', status: 200 },
  { url: `${AWS}/7d6e0277a337/580a42a23f40/39f553e05fca/mp_verify`, method: 'POST', resourceType: 'fetch', status: 200 },
  { url: LISTING, method: 'GET', resourceType: 'document', status: 200 },
];

function network() {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n', { headers: { 'content-type': 'text/plain' } });
    return new Headers(init?.headers).get('cookie')?.includes(COOKIE)
      ? new Response(page0, { headers: { 'content-type': 'text/html;charset=UTF-8' } })
      : new Response(null, { status: 202, headers: { 'content-type': 'text/html; charset=UTF-8', 'x-amzn-waf-action': 'challenge' } });
  }));
}
function browser(requests = BOUNDED) {
  const primer = vi.fn(async (_url: string, observer?: BootstrapObserver) => {
    for (const request of requests) {
      if (!observer!.allow(request)) continue;
      await observer!.record({ ...request, postData: request.method === 'POST' ? Buffer.from('{"solution":"preuve"}') : null,
        requestHeaders: { 'user-agent': BROWSER_USER_AGENT, 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7' },
        status: request.status, responseHeaders: { 'content-type': 'text/plain' }, body: Buffer.from(`corps ${request.url}`), failure: null });
    }
    return COOKIE;
  });
  setWafPrimer(primer);
  return primer;
}
const collect = (source: Source) => captureExtraction(db, source.key, config, undefined, settings => fetchAtsJobs('AVATURE', settings), 'AVATURE',
  { revisionId: source.currentRevisionId });

let source: Source;
beforeAll(async () => {
  await db.source.deleteMany({ where: { key: KEY } });
  source = await db.source.create({ data: { key: KEY, maison: 'Ralph Lauren (témoin D-483)', kind: 'avature', config,
    tier: 'EMPLOYER_DIRECT', tenantKey: `${KEY}-${randomUUID()}`, status: 'DRAFT' } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setWafPrimer(undefined); });
afterAll(async () => { await db.source.deleteMany({ where: { key: KEY } }); await db.$disconnect(); });

describe('D-483 — une collecte amorcée devient une preuve d’accès', () => {
  it('journal, rejeu identique, dérivation, inspection et garde SQL acceptent l’amorçage borné', async () => {
    network(); const primer = browser();
    const batch = await collect(source);
    expect(primer).toHaveBeenCalledTimes(1);
    expect(await db.captureOutcome.findUniqueOrThrow({ where: { batchId: batch.captureBatchId } })).toMatchObject({ status: 'EXTRACTED', transportCoverage: 'HTTP_WITH_WAF_BOOTSTRAP' });
    expect(await db.rawCapture.count({ where: { batchId: batch.captureBatchId, format: 'BROWSER_RESPONSE' } })).toBe(5);
    // Le rejeu hors réseau de la base consomme l'amorçage inscrit et rend exactement le résultat archivé.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Replay tried to use the network'); }));
    const validation = await validateCapturedSource(db, batch.captureBatchId);
    expect((validation.report as { replayExact: boolean }).replayExact).toBe(true);
    network();
    const qualification = await qualifySourceAccess(db, { key: KEY, kind: 'avature' }, source.currentRevisionId, batch.captureBatchId, 'integration-test');
    expect(qualification).toEqual({ allowed: true, reason: null });
    const { decision, document } = await requireSourceAccess(db, source);
    expect(document.bootstraps).toEqual([{ vendor: 'AWS_WAF_CHALLENGE', origin: ORIGIN, challengeHosts: [AWS] }]);
    expect(decision.report).toMatchObject({ bootstrapRequestCount: 5 });
    expect(document.statement).toContain('D-483');
    // La collecte du RUN, sous cette décision : amorçage autorisé par elle, inscrit, et lot lié à la décision.
    await db.source.update({ where: { key: KEY }, data: { status: 'ACTIVE' } });
    try {
      network(); const again = browser();
      const run = await captureExtraction(db, KEY, config, undefined, settings => fetchAtsJobs('AVATURE', settings), 'AVATURE',
        { revisionId: source.currentRevisionId, requireActive: true });
      expect(again).toHaveBeenCalledTimes(1);
      const stored = await db.captureBatch.findUniqueOrThrow({ where: { id: run.captureBatchId }, include: { outcome: true } });
      expect(stored).toMatchObject({ accessDecisionId: decision.id, outcome: { status: 'EXTRACTED', transportCoverage: 'HTTP_WITH_WAF_BOOTSTRAP' } });
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Replay tried to use the network'); }));
      expect(await validateCapturedSource(db, run.captureBatchId)).toMatchObject({ verdict: 'VALIDATED' });
    } finally { await db.source.update({ where: { key: KEY }, data: { status: 'DRAFT' } }); }
  });

  it('SQL refuse une projection d’amorçage falsifiée et un amorçage non déclaré', async () => {
    const { decision } = await requireSourceAccess(db, source);
    const report = decision.report as Prisma.JsonObject;
    const doc = decision.document as unknown as AccessDocument;
    const insert = (document: unknown, proof: unknown) => db.sourceAccessDecision.create({ data: { ...decision, sequence: undefined, id: randomUUID(),
      document: document as Prisma.InputJsonValue, report: proof as Prisma.InputJsonValue } });
    // Contre-épreuve : la même ligne, recopiée, est acceptée par le garde (seul l'identifiant change).
    await expect(insert(doc, report)).resolves.toBeTruthy();
    const { bootstraps: _declared, ...undeclared } = doc;
    const { bootstrapRequestCount: _count, ...uncounted } = report;
    for (const [document, proof] of [
      [doc, { ...report, bootstrapRequestCount: 4 }],
      [undeclared, uncounted],
      [doc, uncounted],
      [{ ...doc, bootstraps: [{ ...doc.bootstraps![0], challengeHosts: ['https://maps.googleapis.com'] }] }, report],
      [{ ...doc, bootstraps: [{ ...doc.bootstraps![0], vendor: 'CLOUDFLARE' }] }, report],
      [{ ...doc, bootstraps: [] }, report],
    ] as const) await expect(insert(document, proof)).rejects.toThrow();
  });

  it('l’inspection refuse un amorçage qui a joint un hôte que la décision ne nomme pas', async () => {
    network(); browser([...BOUNDED.slice(0, 1), { ...BOUNDED[1], url: 'https://autre.us-east-1.token.awswaf.com/challenge.js' }, ...BOUNDED.slice(1)]);
    const batch = await collect(source);
    // La décision dérivée au premier témoin (le second a ajouté une copie à identifiant libre, qui n'est plus « courante »).
    const derived = await db.sourceAccessDecision.findFirstOrThrow({ where: { sourceKey: KEY, sourceRevisionId: source.currentRevisionId,
      id: { startsWith: 'access-review:' } }, orderBy: { sequence: 'asc' } });
    const document = derived.document as unknown as AccessDocument;
    // Prémisse : la collecte a bien inscrit la requête vers l'hôte non déclaré.
    expect(await db.rawCapture.count({ where: { batchId: batch.captureBatchId, format: 'BROWSER_RESPONSE' } })).toBe(6);
    await expect(recordSourceAccessDecision(db, { ...document, captureBatchId: batch.captureBatchId, checkedAt: new Date().toISOString() }))
      .rejects.toThrow(/outside its reviewed authorization/);
  });

  it('une source que D-483 ne nomme pas n’amorce rien : la collecte échoue sur le défi, sans navigateur', async () => {
    const other = await db.source.create({ data: { key: `pvh-temoin-${randomUUID()}`, maison: 'Témoin hors liste', kind: 'avature', config,
      tier: 'EMPLOYER_DIRECT', tenantKey: `pvh-${randomUUID()}`, status: 'DRAFT' } });
    try {
      network(); const primer = browser();
      await expect(captureExtraction(db, other.key, config, undefined, settings => fetchAtsJobs('AVATURE', settings), 'AVATURE',
        { revisionId: other.currentRevisionId })).rejects.toMatchObject({ name: 'WafChallengeError' });
      expect(primer).not.toHaveBeenCalled();
    } finally { await db.source.deleteMany({ where: { key: other.key } }); }
  });
});
