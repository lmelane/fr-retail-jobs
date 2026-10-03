import '../test/setup-integration.js';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient, type Prisma, type Source } from '@prisma/client';
import { captureHandoffFromEnv, runQualifiedIngest } from './ingestOrchestrator.js';
import { maintainSourceAccess } from '../connectors/sourceAccessQualification.js';
import { CAPTURE_ADOPTION_POLICY } from '../connectors/sourceAdmission.js';
import { setWafPrimer, clearWafTokens } from '../lib/wafToken.js';
import { BROWSER_USER_AGENT, type BootstrapObserver } from '../lib/browser.js';

/*
 * LECTURE UNIQUE — LES DEUX SOURCES AVATURE (D-516 §1, enquête du 02/10/2026, `audits/2026-10-02/d516-ralph-lauren/`).
 *
 * Ce qu'Avature fait, mesuré en production : une lecture qui suit de moins de 5 minutes une lecture complète est
 * refusée par un 406 au corps nginx dès son début (12 fois sur 12) ; L'Oréal Professionnel en a reçu 3 924 du 19/09 au
 * 01/10, Ralph Lauren à la 9e requête de sa collecte d'ingestion `c81e14a5`. Le réseau ci-dessous reproduit cette règle :
 * la PREMIÈRE lecture est servie ; dès qu'une seconde lecture recommence la liste à `jobOffset=0`, tout est refusé.
 * Le lecteur Avature, l'amorçage WAF inscrit (Ralph Lauren), la qualification, la décision d'accès, l'adoption, la
 * publication et le rapport de fin d'ingestion sont le chemin de production.
 *
 * Formes réelles : la liste et la fiche de careers.loreal.com (mode `listingUrl`, sans défi AWS, configuration de
 * production de `l-oreal-professionnel`) ; la page 0 Corporate archivée de careers.ralphlauren.com (lot 7b16d898) et
 * l'amorçage borné mesuré le 30/09 (configuration de production de `ralph-lauren-avature`).
 */
const db = new PrismaClient();
const fixture = (name: string) => readFileSync(new URL(`../ats/adapters/__fixtures__/${name}`, import.meta.url), 'utf8');
const NGINX_406 = '<html>\r\n<head><title>406 Not Acceptable</title></head>\r\n<body bgcolor="white">\r\n<center><h1>406 Not Acceptable</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';
const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 202 ? null : body, { status, headers: { 'content-type': 'text/html;charset=UTF-8', ...headers } });
const robots = () => new Response('User-agent: *\nAllow: /\n', { headers: { 'content-type': 'text/plain' } });

/** Avature, tel que mesuré : la première lecture complète est servie, une lecture qui recommence la liste est refusée. */
function avature(serve: (url: URL, init?: RequestInit) => Response | null, isListStart: (url: URL, init?: RequestInit) => boolean) {
  /** `reads` : les débuts de liste (une lecture, plus ses reprises par le transport une fois refusée). */
  const seen = { reads: 0, refused: 0, requests: 0 };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === '/robots.txt') return robots();
    const challenge = serve(url, init);
    if (challenge?.status === 202) return challenge;
    seen.requests++;
    if (isListStart(url, init)) seen.reads++;
    if (seen.reads > 1) { seen.refused++; return html(NGINX_406, 406); }
    return serve(url, init) ?? html('<html></html>');
  }));
  return seen;
}

async function activeSource(key: string, config: Prisma.InputJsonObject): Promise<Source> {
  const existing = await db.source.findUnique({ where: { key } });
  if (existing) {
    // Une nouvelle révision repasse la source hors ligne (déclencheur du registre) : elle est réactivée ensuite.
    await db.source.update({ where: { key }, data: { config, portalScope: 'SINGLE_BRAND', maison: key } });
    return db.source.update({ where: { key }, data: { status: 'ACTIVE' } });
  }
  return db.source.create({ data: { key, maison: key, kind: 'avature', config, portalScope: 'SINGLE_BRAND',
    tier: 'EMPLOYER_DIRECT', tenantKey: `${key}-${randomUUID()}`, status: 'ACTIVE' } });
}
/** Les collectes d'offres de la source depuis `since` (chaque témoin ne lit que les siennes). */
const jobBatches = (key: string, since: bigint) => db.captureBatch.findMany({ where: { sourceKey: key, purpose: 'JOBS', attemptOrdinal: { gt: since } },
  orderBy: { attemptOrdinal: 'asc' }, include: { outcome: true, ingestionAdmission: true, ingestionCompletion: true } });
const mark = async () => (await db.captureBatch.aggregate({ _max: { attemptOrdinal: true } }))._max.attemptOrdinal ?? 0n;

beforeEach(() => clearWafTokens());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setWafPrimer(undefined); delete process.env.INGEST_SINGLE_READ; });
afterAll(async () => {
  await db.$executeRaw`TRUNCATE "SourceIngestionAdmission", "SourceIdentityReview"`;
  await db.$disconnect();
});

describe('L’Oréal Professionnel (Avature, mode liste, sans défi AWS)', { timeout: 120_000 }, () => {
  // La forme et la configuration de `l-oreal-professionnel` ; une clé propre au témoin, pour partir d'une source neuve.
  const KEY = `l-oreal-professionnel-temoin-${randomUUID()}`;
  const LISTING = 'https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0';
  const config = { origin: 'https://careers.loreal.com', listingUrl: LISTING, employerFromDataLayer: true };
  const page0 = '<script>var searchJobsAJAXPage = "https://careers.loreal.com/en_US/jobs/SearchJobsAJAX";</script>' + fixture('g6-loreal-listing-card.html');
  const network = () => avature(url => {
    if (url.pathname.endsWith('/SearchJobs/')) return html(page0);
    if (url.pathname.endsWith('/SearchJobsAJAX/')) return html(fixture('loreal-terminal-page.html'));
    if (url.pathname.includes('JobDetail')) return html(fixture('g6-loreal-jobdetail.html'));
    return null;
  }, url => url.pathname.endsWith('/SearchJobs/') && url.searchParams.get('jobOffset') === '0');

  it('avant (double lecture, l’interrupteur l’impose) : la seconde lecture est refusée dès son début, rien n’est publié', async () => {
    await activeSource(KEY, config); const since = await mark();
    process.env.INGEST_SINGLE_READ = 'off';
    const seen = network();
    const [stats] = await runQualifiedIngest(db, KEY, true, 120_000);
    const batches = await jobBatches(KEY, since);
    // Prémisse : la qualification a tout lu, puis l'ingestion a recommencé la liste et reçu le 406 nginx.
    expect(batches.map(b => [b.accessDecisionId === null ? 'qualification' : 'ingestion', b.outcome?.status])).toEqual([['qualification', 'EXTRACTED'], ['ingestion', 'FAILED']]);
    expect(seen.reads).toBeGreaterThanOrEqual(2); expect(seen.refused).toBeGreaterThan(0);
    expect(stats.errorNote).toMatch(/406/);
    expect(await db.jobSource.count({ where: { sourceKey: KEY } })).toBe(0);
  });

  it('après, le lendemain : la qualification est refaite (CAPTURE_SUPERSEDED par l’échec de la veille), lue une fois, publiée', async () => {
    await activeSource(KEY, config); const since = await mark();
    const seen = network();
    const [stats] = await runQualifiedIngest(db, KEY, true, 120_000);
    expect(seen).toMatchObject({ reads: 1, refused: 0 });
    const batches = await jobBatches(KEY, since);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ accessDecisionId: null, outcome: { status: 'EXTRACTED' }, ingestionAdmission: { policyVersion: CAPTURE_ADOPTION_POLICY } });
    expect(batches[0].ingestionCompletion).not.toBeNull();
    expect(stats.errorNote).toBeUndefined();
    expect(stats.fetched).toBeGreaterThan(0);
    expect(batches[0].ingestionCompletion!.published + batches[0].ingestionCompletion!.held + batches[0].ingestionCompletion!.writeFailed)
      .toBe(batches[0].outcome!.extractedCount);
  });
});

describe('Ralph Lauren (Avature, portail, défi AWS WAF amorcé et inscrit, D-483)', { timeout: 120_000 }, () => {
  const KEY = 'ralph-lauren-avature';
  const ORIGIN = 'https://careers.ralphlauren.com';
  const LISTING = `${ORIGIN}/en_US/CareersCorporate/SearchJobsCorporate/?jobOffset=0&listFilterMode=1`;
  const AWS = 'https://7d6e0277a337.42c8209d.us-east-1.token.awswaf.com';
  // La clé est imposée par D-483 (seule source autorisée à amorcer) : chaque témoin part d'une révision neuve de la
  // source (borne de pages distincte), donc sans validation ni décision courantes, quel que soit l'état laissé avant lui.
  let revision = 0;
  const config = () => ({ origin: ORIGIN, lists: ['en_US/CareersCorporate/SearchJobsCorporate'], maxPages: 50 + ++revision });
  const page0 = gunzipSync(readFileSync(new URL('../ats/adapters/__fixtures__/avature-ralphlauren-corporate-p0-20260919.html.gz', import.meta.url))).toString('utf8');
  const BOUNDED = [
    { url: LISTING, method: 'GET', resourceType: 'document', status: 202 },
    { url: `${AWS}/7d6e0277a337/580a42a23f40/39f553e05fca/challenge.js`, method: 'GET', resourceType: 'script', status: 200 },
    { url: `${AWS}/7d6e0277a337/580a42a23f40/39f553e05fca/inputs?client=browser`, method: 'GET', resourceType: 'fetch', status: 200 },
    { url: `${AWS}/7d6e0277a337/580a42a23f40/39f553e05fca/mp_verify`, method: 'POST', resourceType: 'fetch', status: 200 },
    { url: LISTING, method: 'GET', resourceType: 'document', status: 200 },
  ];
  /** Le navigateur simulé : l'amorçage borné mesuré le 30/09, un jeton neuf à chaque amorçage (chaque collecte a le sien). */
  const browser = () => {
    let calls = 0;
    const primer = vi.fn(async (_url: string, observer?: BootstrapObserver) => {
      for (const request of BOUNDED) {
        if (!observer!.allow(request)) continue;
        await observer!.record({ ...request, postData: request.method === 'POST' ? Buffer.from('{"solution":"preuve"}') : null,
          requestHeaders: { 'user-agent': BROWSER_USER_AGENT }, status: request.status, responseHeaders: { 'content-type': 'text/plain' },
          body: Buffer.from(`corps ${request.url}`), failure: null });
      }
      return `aws-waf-token=jeton-${++calls}`;
    });
    setWafPrimer(primer);
    return primer;
  };
  const tokened = (init?: RequestInit) => /aws-waf-token=jeton-/.test(new Headers(init?.headers).get('cookie') ?? '');
  /** La liste en deux pages de 6 offres distinctes (la page archivée, renumérotée) qui annonce ses 12 offres, puis une page vide. */
  const page = (n: number) => n >= 2 ? '<html><body></body></html>' : page0.replace(/of\s+217\s+results/g, 'of 12 results').replace(/jobId=(\d+)/g, (_, id: string) => `jobId=${Number(id) + 100_000 * n}`);
  const network = () => avature((url, init) => {
    if (!tokened(init)) return html('', 202, { 'content-type': 'text/html; charset=UTF-8', 'x-amzn-waf-action': 'challenge' });
    if (url.pathname.includes('SearchJobs')) return html(page(Number(url.searchParams.get('jobOffset') ?? 0) / 6));
    return html(page0);
  }, (url, init) => tokened(init) && url.pathname.includes('SearchJobs') && url.searchParams.get('jobOffset') === '0');

  it('avant (double lecture) : le second amorçage passe, la liste est refusée par le 406 nginx, rien n’est publié', async () => {
    await activeSource(KEY, config()); const since = await mark();
    process.env.INGEST_SINGLE_READ = 'off';
    const seen = network(); const primer = browser();
    const [stats] = await runQualifiedIngest(db, KEY, true, 120_000);
    const batches = await jobBatches(KEY, since);
    expect(batches.map(b => [b.accessDecisionId === null ? 'qualification' : 'ingestion', b.outcome?.status])).toEqual([['qualification', 'EXTRACTED'], ['ingestion', 'FAILED']]);
    expect(primer).toHaveBeenCalledTimes(2);
    expect(seen.reads).toBeGreaterThanOrEqual(2); expect(seen.refused).toBeGreaterThan(0);
    expect(stats.errorNote).toMatch(/406/);
    expect(await db.jobSource.count({ where: { sourceKey: KEY, lastSeenAt: { gt: (await db.captureBatch.findFirstOrThrow({ where: { id: batches[0].id } })).startedAt } } })).toBe(0);
  });

  it('après : un seul amorçage, une seule lecture, la capture amorcée et inscrite est publiée', async () => {
    await activeSource(KEY, config()); const since = await mark();
    const seen = network(); const primer = browser();
    const [stats] = await runQualifiedIngest(db, KEY, true, 120_000);
    expect(primer).toHaveBeenCalledTimes(1);
    expect(seen).toMatchObject({ reads: 1, refused: 0 });
    const batches = await jobBatches(KEY, since);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ accessDecisionId: null, ingestionAdmission: { policyVersion: CAPTURE_ADOPTION_POLICY },
      outcome: { status: 'EXTRACTED', transportCoverage: 'HTTP_WITH_WAF_BOOTSTRAP' } });
    expect(stats.errorNote).toBeUndefined();
    expect(batches[0].ingestionCompletion).not.toBeNull();
  });

  /*
   * D-522 §6 (03/10/2026) : la réouverture réelle de Ralph Lauren passe par `source-add --registered-revision`, donc par
   * une campagne (qualification amorcée et décision dans le run du parent) puis une ingestion ENFANT dans un autre run,
   * qui reçoit la capture par `INGEST_ADOPT_CAPTURE`. Ce chemin n'était prouvé que sans défi AWS (L'Oréal, plus bas).
   */
  const campaign = async () => {
    await activeSource(KEY, config()); const since = await mark();
    const seen = network(); const primer = browser();
    const access = await maintainSourceAccess(db, KEY, 60_000);
    const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: access.qualificationCaptureId! }, include: { outcome: true } });
    // Prémisse : la capture remise est bien amorcée et inscrite, collectée sans décision, et l'amorçage a eu lieu une fois.
    expect(batch).toMatchObject({ accessDecisionId: null, outcome: { status: 'EXTRACTED', transportCoverage: 'HTTP_WITH_WAF_BOOTSTRAP' } });
    expect(primer).toHaveBeenCalledTimes(1);
    return { seen, primer, since, handoff: { captureId: batch.id, runId: batch.runId } };
  };

  it('réouverture par campagne, avant (sans remise) : l’enfant refait un amorçage, relit la liste et reçoit le 406', async () => {
    const { seen, primer } = await campaign();
    const [stats] = await runQualifiedIngest(db, KEY, true, 120_000);
    expect(primer).toHaveBeenCalledTimes(2);
    expect(seen.refused).toBeGreaterThan(0);
    expect(stats.errorNote).toMatch(/406/);
  });

  it('réouverture par campagne, après : la capture amorcée remise à l’enfant est adoptée, sans second amorçage ni relecture', async () => {
    const { seen, primer, since, handoff } = await campaign();
    const [stats] = await runQualifiedIngest(db, KEY, true, 120_000, handoff);
    expect(primer).toHaveBeenCalledTimes(1);
    expect(seen).toMatchObject({ reads: 1, refused: 0 });
    expect(stats.errorNote).toBeUndefined();
    const batches = await jobBatches(KEY, since);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ id: handoff.captureId, ingestionAdmission: { policyVersion: CAPTURE_ADOPTION_POLICY },
      outcome: { transportCoverage: 'HTTP_WITH_WAF_BOOTSTRAP' } });
    expect(batches[0].ingestionCompletion).not.toBeNull();
  });
});

/*
 * La réouverture passe par une campagne (`source-campaign --ingest`) : qualification et décision d'accès dans le run de la
 * campagne, PUIS une ingestion enfant dans un autre run (release r5 du 02/10/2026, Ralph Lauren : `da424ede` puis
 * `c81e14a5`, 406 à la 9e requête). La validation est alors fraîche : l'enfant ne requalifie rien et relisait le site.
 * La campagne lui remet désormais sa capture (`INGEST_ADOPT_CAPTURE`, `INGEST_ADOPT_RUN`).
 */
describe('réouverture par campagne : la capture qualifiée est remise à l’ingestion enfant', { timeout: 120_000 }, () => {
  const LISTING = 'https://careers.loreal.com/en_US/jobs/SearchJobs/?jobOffset=0';
  const config = { origin: 'https://careers.loreal.com', listingUrl: LISTING, employerFromDataLayer: true };
  const page0 = '<script>var searchJobsAJAXPage = "https://careers.loreal.com/en_US/jobs/SearchJobsAJAX";</script>' + fixture('g6-loreal-listing-card.html');
  const network = () => avature(url => {
    if (url.pathname.endsWith('/SearchJobs/')) return html(page0);
    if (url.pathname.endsWith('/SearchJobsAJAX/')) return html(fixture('loreal-terminal-page.html'));
    if (url.pathname.includes('JobDetail')) return html(fixture('g6-loreal-jobdetail.html'));
    return null;
  }, url => url.pathname.endsWith('/SearchJobs/') && url.searchParams.get('jobOffset') === '0');
  /** Le temps de la campagne : qualification native et décision d'accès, sans ingestion. */
  const campaign = async (key: string) => {
    await activeSource(key, config); const since = await mark();
    const seen = network();
    const access = await maintainSourceAccess(db, key, 60_000);
    const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: access.qualificationCaptureId! } });
    return { seen, since, handoff: { captureId: batch.id, runId: batch.runId } };
  };

  it('l’environnement remis par la campagne est lu, et absent partout ailleurs', () => {
    expect(captureHandoffFromEnv({})).toBeUndefined();
    expect(captureHandoffFromEnv({ INGEST_ADOPT_CAPTURE: 'lot', INGEST_ADOPT_RUN: 'run' })).toEqual({ captureId: 'lot', runId: 'run' });
    expect(captureHandoffFromEnv({ INGEST_ADOPT_CAPTURE: 'lot', INGEST_ADOPT_RUN: '' })).toEqual({ captureId: 'lot', runId: null });
  });

  it('avant (sans remise) : l’ingestion enfant relit le site et reçoit le 406', async () => {
    const key = `l-oreal-professionnel-campagne-${randomUUID()}`;
    const { seen, since } = await campaign(key);
    const [stats] = await runQualifiedIngest(db, key, true, 120_000);
    expect(seen.reads).toBeGreaterThanOrEqual(2); expect(seen.refused).toBeGreaterThan(0);
    expect(stats.errorNote).toMatch(/406/);
    expect((await jobBatches(key, since)).map(b => b.outcome?.status)).toEqual(['EXTRACTED', 'FAILED']);
  });

  it('après : la capture remise est adoptée, une seule lecture, publiée', async () => {
    const key = `l-oreal-professionnel-campagne-${randomUUID()}`;
    const { seen, since, handoff } = await campaign(key);
    const [stats] = await runQualifiedIngest(db, key, true, 120_000, handoff);
    expect(seen).toMatchObject({ reads: 1, refused: 0 });
    expect(stats.errorNote).toBeUndefined();
    const batches = await jobBatches(key, since);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ id: handoff.captureId, ingestionAdmission: { policyVersion: CAPTURE_ADOPTION_POLICY } });
    expect(batches[0].ingestionCompletion).not.toBeNull();
  });

  it('une remise qui nomme un autre run est refusée : l’enfant relit le site', async () => {
    const key = `l-oreal-professionnel-campagne-${randomUUID()}`;
    const { seen, handoff } = await campaign(key);
    const [stats] = await runQualifiedIngest(db, key, true, 120_000, { ...handoff, runId: `autre-${randomUUID()}` });
    expect(seen.reads).toBeGreaterThanOrEqual(2);
    expect(stats.errorNote).toMatch(/406/);
  });
});
