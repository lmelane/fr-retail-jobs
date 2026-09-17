import { describe, expect, it } from 'vitest';
import { ACCESS_SCOPE_BUDGET, AccessScopeBudgetError, deriveAccessScopeDocument, deriveAccessScopes, observedSurface, parentDirectory, type ObservedRequest } from './accessScopeDerivation.js';
import { matchingAccessScope, parseAccessScopes, type AccessScope } from './accessScope.js';
import { CRAWLER_IDENTITY } from '../lib/crawlerIdentity.js';

/**
 * Les formes de requêtes sont celles réellement observées pendant les vagues définitives F3b (mecca, aigle, decjuba,
 * oska, la-redoute), reproduites hors réseau, plus les formes que la lecture adverse a construites (tenant Workday à
 * soixante-dix lieux, débordement sur une origine à côté d'une API sur une autre, point d'entrée POST sous un répertoire
 * GET). Chaque témoin affirme d'abord que sa situation de départ remplit la condition du défaut, puis que chaque requête
 * observée correspond à UN périmètre exactement : c'est la règle que `matchingAccessScope` applique à l'écriture de la
 * décision d'accès, et un recouvrement ou un chemin non couvert y refuse la source entière.
 */
const get = (url: string, contentType = 'application/json'): ObservedRequest => ({ method: 'GET', url: new URL(url), contentType });
const post = (url: string, contentType = 'application/json'): ObservedRequest => ({ method: 'POST', url: new URL(url), contentType });
const description = (request: ObservedRequest) => ({ url: request.url.toString(), method: request.method, format: 'HTTP_RESPONSE' as const, bodyHash: '',
  userAgent: CRAWLER_IDENTITY, negotiation: { accept: null, 'accept-language': null, 'content-type': null } });
const eachCoveredOnce = (scopes: AccessScope[], requests: ObservedRequest[]) => requests.map(request => matchingAccessScope(scopes, description(request)));
const distinctParents = (requests: ObservedRequest[]) => new Set(requests.map(request => `${request.url.origin}${parentDirectory(request.url.pathname)}`)).size;
const paths = (scopes: AccessScope[]) => scopes.map(scope => `${scope.path.kind} ${scope.methods.join('/')} ${scope.origin}${scope.path.value}`).sort();
const accepted = (scopes: AccessScope[], requests: ObservedRequest[]) => { expect(() => eachCoveredOnce(scopes, requests)).not.toThrow(); expect(() => parseAccessScopes(scopes)).not.toThrow(); };

describe('deriveAccessScopes', () => {
  it('declares a parent directory once when postings live both directly under it and under location subdirectories (Workday, mecca)', () => {
    const base = 'https://mecca.wd3.myworkdayjobs.com/wday/cxs/mecca/careers';
    const requests = [post(`${base}/jobs`), post(`${base}/jobs`),
      ...Array.from({ length: 60 }, (_, i) => get(`${base}/job/${['Richmond', 'Victoria', 'Queensland'][i % 3]}/Posting-${i}_R0${i}`)),
      get(`${base}/job/Remote-Posting_R900`), get(`${base}/job/Remote-Posting_R901`)];
    // Prémisse : des offres sous `/job/` ET sous `/job/{lieu}/` — le regroupement des frères seul produit un préfixe parent à côté de ses enfants.
    expect(requests.some(r => parentDirectory(r.url.pathname) === '/wday/cxs/mecca/careers/job/')).toBe(true);
    expect(requests.some(r => parentDirectory(r.url.pathname) === '/wday/cxs/mecca/careers/job/Richmond/')).toBe(true);
    const { scopes, derivation } = deriveAccessScopeDocument('workday', requests);
    expect(paths(scopes)).toEqual([`EXACT POST ${base}/jobs`, `PREFIX GET ${base}/job/`]);
    expect(scopes.find(s => s.path.kind === 'EXACT')).toMatchObject({ surface: 'PUBLIC_ATS_JOB_API', query: { fixed: {}, variable: [] } });
    expect(derivation).toEqual({ exact: 1, prefix: 1, climbs: 0, origins: 1 });
    accepted(scopes, requests);
  });

  it('absorbs an exact path under a sibling prefix and keeps the query contract of the listing API (DigitalRecruiters, aigle)', () => {
    const api = 'https://api.digitalrecruiters.com/public/v1/careers-site/job-ads';
    const requests = [1, 2, 3].map(page => post(`${api}?domainName=careers.aigle.com&limit=100&page=${page}&locale=fr_FR`));
    for (let i = 0; i < 70; i++) requests.push(get(`https://careers.aigle.com/fr/annonce/${4600000 + i}-sales-advisor-${i}`, 'text/html; charset=utf-8'));
    requests.push(get('https://careers.aigle.com/fr/annonce/2941903/65546321-stage-conseiller-de-vente', 'text/html'));
    requests.push(get('https://careers.aigle.com/fr/annonce/2941903/65546322-stage-vendeur', 'text/html'));
    // Prémisse : des annonces à identifiant de site intercalé, seules dans leur répertoire, sous le répertoire des autres.
    expect(distinctParents(requests)).toBe(3);
    const scopes = deriveAccessScopes('digitalrecruiters', requests);
    expect(paths(scopes)).toEqual([`EXACT POST ${api}`, 'PREFIX GET https://careers.aigle.com/fr/annonce/']);
    expect(scopes.find(s => s.origin === 'https://api.digitalrecruiters.com')).toMatchObject({
      query: { fixed: { domainName: 'careers.aigle.com', limit: '100', locale: 'fr_FR' }, variable: ['page'] }, surface: 'PUBLIC_ATS_JOB_API' });
    expect(scopes.find(s => s.origin === 'https://careers.aigle.com')).toMatchObject({ surface: 'PUBLIC_ATS_HTML' });
    accepted(scopes, requests);
  });

  it('climbs isolated posting directories one level at a time, deepest first, until the bounded list fits (SuccessFactors, decjuba)', () => {
    const origin = 'https://careers.decjuba.com.au';
    const requests = [0, 25, 50].map(row => get(`${origin}/search/?createNewAlert=false&q=&locationsearch=&startrow=${row}`, 'text/html'));
    for (let i = 0; i < 157; i++) requests.push(get(`${origin}/job/Location-${i % 30}/Title-${i}/${1000 + i}`, 'text/html'));
    // Prémisse : chaque offre dans son propre répertoire, plus de répertoires que le budget ; aucun frère ne les regroupe.
    expect(distinctParents(requests)).toBeGreaterThan(ACCESS_SCOPE_BUDGET);
    const { scopes, derivation } = deriveAccessScopeDocument('successfactors', requests);
    expect(scopes.length).toBeLessThanOrEqual(ACCESS_SCOPE_BUDGET);
    expect(scopes.filter(s => s.path.kind === 'PREFIX').map(s => s.path.value).sort()).toEqual(Array.from({ length: 30 }, (_, k) => `/job/Location-${k}/`).sort());
    expect(scopes.find(s => s.path.kind === 'EXACT')).toMatchObject({ path: { value: '/search/' },
      query: { fixed: { createNewAlert: 'false', q: '', locationsearch: '' }, variable: ['startrow'] } });
    expect(derivation).toEqual({ exact: 1, prefix: 30, climbs: 2, origins: 1 });
    accepted(scopes, requests);
  });

  it('never merges a POST entry point into the GET prefix of the postings, even when the list overflows (Workday tenant with seventy locations)', () => {
    const base = 'https://tenant.wd3.myworkdayjobs.com/wday/cxs/tenant/External';
    const requests = [post(`${base}/jobs`), ...Array.from({ length: 70 }, (_, i) => get(`${base}/job/Location-${i}/Posting-${i}_R${i}`))];
    // Prémisse : soixante-dix répertoires de lieu à une offre chacune, plus que le budget, et un point d'entrée POST moins profond.
    expect(distinctParents(requests)).toBeGreaterThan(ACCESS_SCOPE_BUDGET);
    const { scopes, derivation } = deriveAccessScopeDocument('workday', requests);
    expect(paths(scopes)).toEqual([`EXACT POST ${base}/jobs`, `PREFIX GET ${base}/job/`]);
    // Deux remontées : l'offre vers son répertoire de lieu, puis le lieu vers le répertoire des offres ; le POST n'a pas bougé.
    expect(derivation).toEqual({ exact: 1, prefix: 1, climbs: 2, origins: 1 });
    accepted(scopes, requests);
  });

  it('climbs only the overflowing origin: the listing API on another origin keeps its exact path', () => {
    const api = 'https://api.digitalrecruiters.com/public/v1/careers-site/job-ads';
    const requests = [post(`${api}?domainName=careers.maison.example&limit=100&page=1&locale=fr_FR`)];
    for (let i = 0; i < 70; i++) requests.push(get(`https://careers.maison.example/fr/annonce/${100 + i}/${5000 + i}-poste-${i}`, 'text/html'));
    // Prémisse : soixante-dix répertoires de site, tous seuls, sur l'origine des pages ; l'API est sur une autre origine.
    expect(distinctParents(requests)).toBeGreaterThan(ACCESS_SCOPE_BUDGET);
    const scopes = deriveAccessScopes('digitalrecruiters', requests);
    expect(paths(scopes)).toEqual([`EXACT POST ${api}`, 'PREFIX GET https://careers.maison.example/fr/annonce/']);
    accepted(scopes, requests);
  });

  it('keeps a POST endpoint apart from a GET prefix that covers its path, so that each request matches one scope by method', () => {
    const origin = 'https://careers.maison.example';
    const requests = [get(`${origin}/careers/`, 'text/html'), get(`${origin}/careers/a`, 'text/html'), get(`${origin}/careers/b`, 'text/html'),
      post(`${origin}/careers/search`), post(`${origin}/careers/search`)];
    const scopes = deriveAccessScopes('generic-listing', requests);
    expect(paths(scopes)).toEqual([`EXACT POST ${origin}/careers/search`, `PREFIX GET ${origin}/careers/`]);
    expect(scopes.find(s => s.path.kind === 'EXACT')).toMatchObject({ surface: 'PUBLIC_PORTAL_JSON' });
    expect(scopes.find(s => s.path.kind === 'PREFIX')).toMatchObject({ surface: 'PUBLIC_OFFICIAL_HTML' });
    accepted(scopes, requests);
  });

  it('lets a prefix absorb the listing page that shares its path, and names the sitemap surface (generic listing, oska)', () => {
    const origin = 'https://www.oska.com';
    const requests = [get(`${origin}/jobs-sitemap1.xml`, 'application/xml'), get(`${origin}/jobs/`, 'text/html'),
      get(`${origin}/jobs/modeberater-stgallen/`, 'text/html'), get(`${origin}/jobs/verkauf-berlin/`, 'text/html'),
      get(`${origin}/fr/jobs/modeberater-stgallen/`, 'text/html'), get(`${origin}/fr/jobs/verkauf-berlin/`, 'text/html')];
    // Prémisse : la page de liste `/jobs/` est elle-même observée, et c'est aussi le répertoire de ses offres.
    expect(requests.filter(r => r.url.pathname === '/jobs/')).toHaveLength(1);
    const scopes = deriveAccessScopes('generic-listing', requests);
    expect(paths(scopes)).toEqual([`EXACT GET ${origin}/jobs-sitemap1.xml`, `PREFIX GET ${origin}/fr/jobs/`, `PREFIX GET ${origin}/jobs/`]);
    expect(scopes.find(s => s.path.kind === 'EXACT')).toMatchObject({ surface: 'PUBLIC_SITEMAP' });
    expect(scopes.find(s => s.path.value === '/jobs/')).toMatchObject({ surface: 'PUBLIC_OFFICIAL_HTML' });
    accepted(scopes, requests);
  });

  it('absorbs a campaigns directory under the company prefix that covers it (TalentView, la-redoute)', () => {
    const origin = 'https://api.talentview.example';
    const requests = [get(`${origin}/funnel/v2/companies/laredoute-talent/`), get(`${origin}/funnel/v2/companies/laredoute-talent/campaigns/1`),
      get(`${origin}/funnel/v2/companies/laredoute-talent/campaigns/2`), get(`${origin}/funnel/v2/companies/laredoute-talent/campaigns/3`),
      get(`${origin}/funnel/v2/companies/laredoute-talent/settings`), get(`${origin}/funnel/v2/companies/laredoute-talent/pages`)];
    const scopes = deriveAccessScopes('talentview', requests);
    expect(paths(scopes)).toEqual([`PREFIX GET ${origin}/funnel/v2/companies/laredoute-talent/`]);
    accepted(scopes, requests);
  });

  it('marks a query key variable when only some members of a prefix carry it', () => {
    const requests = [get('https://jobs.example/list/a?lang=fr', 'text/html'), get('https://jobs.example/list/b', 'text/html')];
    const [scope] = deriveAccessScopes('generic-listing', requests);
    expect(scope).toMatchObject({ path: { kind: 'PREFIX', value: '/list/' }, query: { fixed: {}, variable: ['lang'] } });
    accepted([scope], requests);
  });

  it('classifies a mixed prefix by the majority of served types, independently of the order of observation', () => {
    const html = (i: number) => get(`https://jobs.example/api/page-${i}`, 'text/html');
    const json = (i: number) => get(`https://jobs.example/api/item-${i}`, 'application/json');
    const forward = [html(1), html(2), json(1)]; const backward = [json(1), html(2), html(1)];
    expect(deriveAccessScopes('generic-listing', forward)[0].surface).toBe('PUBLIC_OFFICIAL_HTML');
    expect(deriveAccessScopes('generic-listing', backward)[0].surface).toBe('PUBLIC_OFFICIAL_HTML');
    // À égalité, l'ordre fixe départage : l'API JSON avant la page HTML, quel que soit l'ordre d'arrivée.
    expect(deriveAccessScopes('teamtailor', [html(1), json(1)])[0].surface).toBe('PUBLIC_ATS_JOB_API');
    expect(deriveAccessScopes('teamtailor', [json(1), html(1)])[0].surface).toBe('PUBLIC_ATS_JOB_API');
  });

  it('names the origin when the budget cannot be met without widening to the root, and never declares the root', () => {
    const flat = Array.from({ length: ACCESS_SCOPE_BUDGET + 6 }, (_, i) => get(`https://flat.example/p${i}`));
    expect(() => deriveAccessScopes('generic-listing', flat)).toThrow(AccessScopeBudgetError);
    expect(() => deriveAccessScopes('generic-listing', flat)).toThrow(/ACCESS_SCOPE_BUDGET: 70 périmètres observés, non regroupables sans élargir à la racine \(https:\/\/flat\.example\)/);
    const nested = Array.from({ length: ACCESS_SCOPE_BUDGET + 6 }, (_, i) => get(`https://deep.example/a/b${i}/c${i}`));
    const { scopes, derivation } = deriveAccessScopeDocument('generic-listing', nested);
    expect(paths(scopes)).toEqual(['PREFIX GET https://deep.example/a/']);
    expect(derivation).toEqual({ exact: 0, prefix: 1, climbs: 2, origins: 1 });
    accepted(scopes, nested);
    expect(() => deriveAccessScopes('generic-listing', [])).toThrow(/aucune requête observée/);
  });

  it('classifies the served surface from the content type and the family', () => {
    expect(observedSurface('teamtailor', '/jobs.json', ['application/json; charset=utf-8'])).toBe('PUBLIC_ATS_JOB_API');
    expect(observedSurface('generic-listing', '/jobs-sitemap1.xml', ['application/xml'])).toBe('PUBLIC_SITEMAP');
    expect(observedSurface('generic-listing', '/feed.xml', ['application/rss+xml'])).toBe('PUBLIC_XML_OR_RSS');
    expect(observedSurface('generic-listing', '/jobs/', ['text/html; charset=utf-8'])).toBe('PUBLIC_OFFICIAL_HTML');
    expect(observedSurface('workday', '/en-US/careers', ['text/html'])).toBe('PUBLIC_ATS_HTML');
    expect(observedSurface('generic-listing', '/api', [''])).toBe('PUBLIC_PORTAL_JSON');
    expect(observedSurface('generic-listing', '/api', [])).toBe('PUBLIC_PORTAL_JSON');
  });
});
