import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CRAWLER_IDENTITY } from '../lib/crawlerIdentity.js';
import { BROWSER_USER_AGENT } from '../lib/browser.js';
import { parseAccessDocument, type AccessScope } from './accessScope.js';
import {
  assertJournaledBootstrap, bootstrapAuthorizedFor, bootstrapRequestCovered, deriveAccessBootstrap, grantedAllow, isChallengeHost, observeModeAllow,
  parseAccessBootstraps, WAF_BOOTSTRAP_SOURCES, type AccessBootstrap, type ObservedBootstrapRequest,
} from './wafBootstrap.js';

/*
 * Mesures RÉELLES du 30/09/2026 sur careers.ralphlauren.com (`scripts/ops/mesure-amorcage-waf-d483.mts`, copies des
 * sorties dans `audits/2026-09-30/d483-amorcage-waf/`, valeurs de requête omises) :
 *   - `observateur` : l'amorçage HISTORIQUE, sans borne — 146 requêtes du navigateur (la page défiée, le défi AWS, puis
 *     toute la page d'offres : 62 scripts, feuilles de style, polices, Google Maps, CDN Avature…), jeton obtenu ;
 *   - `borne` : l'amorçage du lot, filtre `observeModeAllow` — 5 requêtes parties, 26 refusées avant l'envoi, jeton
 *     obtenu en 4,9 s, et la liste relue avec lui : 200, 6 cartes, 225 offres annoncées.
 */
type Measured = { method: string; url: string; resourceType: string; status: number | null; userAgent: string | null };
type Measure = { challenge: { status: number; wafAction: string; bytes: number }; token: string | null;
  withToken: { status: number; cards: number; declaredTotal: number }; requests: Measured[]; blocked: Measured[] };
const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/ralph-lauren-amorcage-20260930.json', import.meta.url), 'utf8')) as
  { observateur: Measure; borne: Measure };
const ORIGIN = 'https://careers.ralphlauren.com';
/** L'adresse que la collecte demande (`fetchAvaturePortalJobs`), défiée à chaque première requête. */
const LISTING = `${ORIGIN}/en_US/CareersCorporate/SearchJobsCorporate/?jobOffset=0&listFilterMode=1`;
const AWS = 'https://7d6e0277a337.42c8209d.us-east-1.token.awswaf.com';
/** Les mesures omettent les valeurs de requête : la page défiée retrouve son adresse exacte, le reste garde sa forme. */
const exact = (request: Measured) => request.url.startsWith(`${ORIGIN}/en_US/CareersCorporate/SearchJobsCorporate/?`) && request.resourceType === 'document'
  ? LISTING : request.url;
const key = (request: Measured) => `${request.method} ${request.resourceType} ${exact(request)}`;
const observed = (requests: Measured[], firstSequence = 1): ObservedBootstrapRequest[] =>
  requests.map((request, index) => ({ sequence: firstSequence + index, url: new URL(exact(request)), method: request.method, userAgent: request.userAgent }));
const challenge = { sequence: 0, url: LISTING };
const scope: AccessScope = { origin: ORIGIN, path: { kind: 'PREFIX', value: '/en_US/CareersCorporate/' }, methods: ['GET'],
  query: { fixed: { listFilterMode: '1' }, variable: ['jobOffset'] }, surface: 'PUBLIC_ATS_HTML' };
const granted: AccessBootstrap = { vendor: 'AWS_WAF_CHALLENGE', origin: ORIGIN, challengeHosts: [AWS] };

describe('D-483 — prémisses mesurées', () => {
  it('le défi est servi à la collecte, l’amorçage historique charge toute la page, l’amorçage borné suffit au jeton', () => {
    for (const measure of [fixture.observateur, fixture.borne]) {
      expect(measure.challenge).toMatchObject({ status: 202, wafAction: 'challenge', bytes: 0 });
      expect(measure.token).toBe('aws-waf-token');
      expect(measure.withToken).toMatchObject({ status: 200, cards: 6 });
    }
    const hosts = new Set(fixture.observateur.requests.map(request => new URL(request.url).origin));
    expect(fixture.observateur.requests).toHaveLength(146);
    expect([...hosts]).toEqual(expect.arrayContaining(['https://maps.googleapis.com', 'https://templates-static-assets.avacdn.net', AWS]));
    expect(fixture.borne.requests).toHaveLength(5);
    expect(fixture.borne.blocked).toHaveLength(26);
    // Chaque requête partie a porté l’identité du collecteur dans le navigateur.
    expect(new Set([...fixture.observateur.requests, ...fixture.borne.requests].map(request => request.userAgent))).toEqual(new Set([BROWSER_USER_AGENT]));
  });
});

describe('le filtre de l’amorçage : la page défiée et l’infrastructure du défi, rien d’autre', () => {
  it('sur les 146 requêtes réelles de l’amorçage historique, n’en laisse partir que les 5 de l’amorçage borné', () => {
    const allow = observeModeAllow(LISTING);
    const kept = fixture.observateur.requests.filter(request => allow({ url: exact(request), method: request.method }));
    expect(kept.map(key).sort()).toEqual(fixture.borne.requests.map(key).sort());
    expect(fixture.borne.blocked.every(request => !allow({ url: exact(request), method: request.method }))).toBe(true);
  });
  it('sous décision, les seuls hôtes déclarés : un autre hôte AWS, une autre adresse du site, un POST sur la page, jamais', () => {
    const allow = grantedAllow(LISTING, granted);
    expect(fixture.borne.requests.every(request => allow({ url: exact(request), method: request.method }))).toBe(true);
    const other = grantedAllow(LISTING, { ...granted, challengeHosts: ['https://autre.us-east-1.token.awswaf.com'] });
    expect(other({ url: `${AWS}/7d6e0277a337/580a42a23f40/39f553e05fca/challenge.js`, method: 'GET' })).toBe(false);
    expect(allow({ url: `${ORIGIN}/en_US/CareersCorporate/JobDetailCorporate?jobId=1`, method: 'GET' })).toBe(false);
    expect(allow({ url: LISTING, method: 'POST' })).toBe(false);
    expect(allow({ url: 'https://maps.googleapis.com/maps/api/js', method: 'GET' })).toBe(false);
  });
  it.each(['https://awswaf.com.evil.example', 'http://x.token.awswaf.com', 'https://x.token.awswaf.com:8443', 'https://evil.example',
    'https://user@x.token.awswaf.com', 'https://awswaf.com'])('n’est jamais une infrastructure du défi : %s', origin => {
    expect(isChallengeHost(origin)).toBe(false);
  });
  it('la liste nommée par D-483 : une seule source, une seule origine', () => {
    expect(Object.keys(WAF_BOOTSTRAP_SOURCES)).toEqual(['ralph-lauren-avature']);
    expect(bootstrapAuthorizedFor('ralph-lauren-avature', ORIGIN)).toBe(true);
    expect(bootstrapAuthorizedFor('ralph-lauren-avature', 'https://ralphlauren.avature.net')).toBe(false);
    expect(bootstrapAuthorizedFor('pvh', 'https://careers.pvh.com')).toBe(false);
    expect(bootstrapAuthorizedFor('constructor', ORIGIN)).toBe(false);
  });
});

describe('la dérivation : l’autorisation déclare ce que le journal prouve, jamais plus', () => {
  it('dérive de l’amorçage borné réel l’origine défiée et le seul hôte du défi observé', () => {
    expect(deriveAccessBootstrap('ralph-lauren-avature', [challenge], observed(fixture.borne.requests)))
      .toEqual({ vendor: 'AWS_WAF_CHALLENGE', origin: ORIGIN, challengeHosts: [AWS] });
    expect(deriveAccessBootstrap('ralph-lauren-avature', [challenge], [])).toBeNull();
  });
  it('lit l’origine défiée sur la page, pas sur l’ordre d’inscription (les réponses du défi peuvent s’inscrire avant)', () => {
    const order = [3, 1, 2, 4, 5];
    const shuffled = observed(fixture.borne.requests).map((request, index) => ({ ...request, sequence: order[index] }));
    // Prémisse : la première ligne inscrite est une requête vers l'infrastructure du défi.
    expect([...shuffled].sort((a, b) => a.sequence - b.sequence)[0].url.origin).toBe(AWS);
    expect(deriveAccessBootstrap('ralph-lauren-avature', [challenge], shuffled)).toEqual({ vendor: 'AWS_WAF_CHALLENGE', origin: ORIGIN, challengeHosts: [AWS] });
  });
  it('refuse l’amorçage historique entier : il a joint Google Maps et chargé la page entière', () => {
    expect(() => deriveAccessBootstrap('ralph-lauren-avature', [challenge], observed(fixture.observateur.requests))).toThrow(/ACCESS_BOOTSTRAP/);
  });
  it.each([
    ['une source que D-483 ne nomme pas', 'pvh', [challenge], observed(fixture.borne.requests)],
    ['aucun défi archivé avant l’amorçage', 'ralph-lauren-avature', [{ sequence: 99, url: LISTING }], observed(fixture.borne.requests)],
    ['un défi archivé sur une autre origine', 'ralph-lauren-avature', [{ sequence: 0, url: 'https://ralphlauren.avature.net/x' }], observed(fixture.borne.requests)],
    ['une feuille de style du site', 'ralph-lauren-avature', [challenge], observed([...fixture.borne.requests,
      { method: 'GET', url: `${ORIGIN}/portal/47/styles.css`, resourceType: 'stylesheet', status: 200, userAgent: BROWSER_USER_AGENT }])],
    ['une tuile Google Maps', 'ralph-lauren-avature', [challenge], observed([...fixture.borne.requests,
      { method: 'GET', url: 'https://maps.googleapis.com/maps/vt', resourceType: 'image', status: 200, userAgent: BROWSER_USER_AGENT }])],
    ['une requête sans l’identité du collecteur', 'ralph-lauren-avature', [challenge], observed(fixture.borne.requests.map((request, index) =>
      index === 1 ? { ...request, userAgent: CRAWLER_IDENTITY } : request))],
    ['aucun hôte du défi joint', 'ralph-lauren-avature', [challenge], observed(fixture.borne.requests.filter(request => request.url.startsWith(ORIGIN)))],
  ] as const)('refuse %s', (_label, source, challenges, requests) => {
    expect(() => deriveAccessBootstrap(source, [...challenges], [...requests])).toThrow(/ACCESS_BOOTSTRAP/);
  });
  it('couvre à l’inspection chaque requête de l’amorçage borné, et aucune requête de l’amorçage historique en plus', () => {
    const covered = (requests: Measured[]) => observed(requests).filter(request => bootstrapRequestCovered(granted, [LISTING], request)).length;
    expect(covered(fixture.borne.requests)).toBe(5);
    expect(covered(fixture.observateur.requests)).toBe(5);
    expect(bootstrapRequestCovered(granted, [], observed(fixture.borne.requests)[0])).toBe(false);
    expect(bootstrapRequestCovered(granted, [LISTING], { ...observed(fixture.borne.requests)[1], userAgent: null })).toBe(false);
  });
});

describe('fin de collecte : le journal de l’amorçage tient dans son autorisation', () => {
  const requests = observed(fixture.borne.requests);
  const escaped = observed([...fixture.borne.requests, { method: 'GET', url: 'https://ailleurs.example/fuite', resourceType: 'document', status: 200, userAgent: BROWSER_USER_AGENT }]);
  it('accepte l’amorçage borné, sous décision comme en qualification', () => {
    expect(() => assertJournaledBootstrap('ralph-lauren-avature', [granted], [challenge], requests)).not.toThrow();
    expect(() => assertJournaledBootstrap('ralph-lauren-avature', null, [challenge], requests)).not.toThrow();
    expect(() => assertJournaledBootstrap('pvh', null, [], [])).not.toThrow();
  });
  it.each([['sous décision', [granted]], ['en qualification', null]] as const)('refuse une requête échappée (redirection) %s', (_label, bootstraps) => {
    expect(() => assertJournaledBootstrap('ralph-lauren-avature', bootstraps ? [...bootstraps] : null, [challenge], escaped)).toThrow(/ACCESS_BOOTSTRAP/);
  });
  it('refuse un amorçage que la décision ne déclare pas, ou pour une source non nommée', () => {
    expect(() => assertJournaledBootstrap('ralph-lauren-avature', [], [challenge], requests)).toThrow(/ACCESS_BOOTSTRAP/);
    expect(() => assertJournaledBootstrap('pvh', [granted], [challenge], requests)).toThrow(/ACCESS_BOOTSTRAP/);
  });
});

describe('document.bootstraps : borné, exact, jamais sans son périmètre HTTP', () => {
  const document = (bootstraps?: unknown) => ({ sourceKey: 'ralph-lauren-avature', sourceRevisionId: 'revision', captureBatchId: 'native-batch',
    verdict: 'ALLOWED', scopes: [structuredClone(scope)], robotsCaptureIds: ['robots'], reviewer: 'reviewer',
    statement: 'The reviewed public job feed belongs to this specific tenant.', checkedAt: new Date().toISOString(),
    ...(bootstraps === undefined ? {} : { bootstraps }) });
  it('accepte l’amorçage dérivé, et une décision sans amorçage comme avant', () => {
    expect(parseAccessDocument(document([granted])).bootstraps).toEqual([granted]);
    expect(parseAccessDocument(document()).bootstraps).toBeUndefined();
  });
  it.each([
    ['une liste vide', []],
    ['deux amorçages', [granted, granted]],
    ['un autre fournisseur', [{ ...granted, vendor: 'CLOUDFLARE' }]],
    ['un hôte hors de l’infrastructure AWS', [{ ...granted, challengeHosts: ['https://maps.googleapis.com'] }]],
    ['des hôtes non triés', [{ ...granted, challengeHosts: ['https://b.token.awswaf.com', 'https://a.token.awswaf.com'] }]],
    ['aucun hôte', [{ ...granted, challengeHosts: [] }]],
    ['une origine sans périmètre HTTP revu', [{ ...granted, origin: 'https://ralphlauren.avature.net' }]],
    ['une clé de plus', [{ ...granted, allowAll: true }]],
    ['un objet au lieu d’une liste', granted],
  ])('refuse %s', (_label, bootstraps) => {
    expect(() => parseAccessDocument(document(bootstraps))).toThrow();
  });
  it('refuse un amorçage déclaré pour une source que D-483 ne nomme pas (document forgé)', () => {
    expect(() => parseAccessDocument({ ...document([granted]), sourceKey: 'pvh' })).toThrow(/not authorized/);
    expect(parseAccessDocument({ ...document(), sourceKey: 'pvh' }).sourceKey).toBe('pvh');
  });
  it('refuse un amorçage sur un refus d’accès', () => {
    expect(() => parseAccessDocument({ ...document([granted]), verdict: 'NOT_AUTHORIZED', captureBatchId: null, scopes: [], robotsCaptureIds: [] })).toThrow();
    expect(() => parseAccessBootstraps([granted], [])).toThrow();
  });
});
