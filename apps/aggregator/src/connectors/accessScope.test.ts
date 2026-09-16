import { describe, expect, it } from 'vitest';
import { accessDecision, type AccessSurface } from '../lib/accessDecision.js';
import { CRAWLER_IDENTITY } from '../lib/crawlerIdentity.js';
import { describeRequest } from '../capture/context.js';
import { matchingAccessScope, parseAccessDocument, parseAccessScopes, type AccessScope } from './accessScope.js';

const scope: AccessScope = { origin: 'https://api.jobs.example', path: { kind: 'PREFIX', value: '/boards/maison/' },
  methods: ['GET', 'POST'], query: { fixed: { tenant: 'maison' }, variable: ['page'] }, surface: 'PUBLIC_ATS_JOB_API' };
const request = (url: string) => describeRequest({ url, headers: { 'user-agent': CRAWLER_IDENTITY }, format: 'HTTP_RESPONSE' });
const document = () => ({ sourceKey: 'maison', sourceRevisionId: 'revision', captureBatchId: 'native-batch',
  verdict: 'ALLOWED', scopes: [structuredClone(scope)], robotsCaptureIds: ['robots'],
  reviewer: 'reviewer', statement: 'The reviewed public job feed belongs to this specific tenant.', checkedAt: new Date().toISOString() });

describe('closed public scope', () => {
  it.each(['UNKNOWN', '', 'public_official_html', null, undefined, 'constructor', '__proto__'])('never grants an unknown surface %s', surface => {
    expect(accessDecision({ robotsObserved: 'ALLOWED', accessSurface: surface as AccessSurface })).toMatchObject({ effectiveAccessDecision: 'NOT_AUTHORIZED', authorizationBasis: 'NONE' });
    expect(() => parseAccessScopes([{ ...scope, surface }])).toThrow();
  });
  it('allows new detail ids and pagination only inside the reviewed tenant directory', () => {
    expect(matchingAccessScope([scope], request('https://api.jobs.example/boards/maison/new-id?tenant=maison&page=2'))).toBe(0);
    expect(matchingAccessScope([scope], request('https://api.jobs.example/boards/maison/?tenant=maison'))).toBe(0);
  });
  it.each([
    'https://api.jobs.example/boards/maison2/1?tenant=maison', 'https://evil.example/boards/maison/1?tenant=maison',
    'https://api.jobs.example/boards/maison/1?tenant=other', 'https://api.jobs.example/boards/maison/1',
    'https://api.jobs.example/boards/maison/1?tenant=maison&tenant=maison',
    'https://api.jobs.example/boards/maison/1?tenant=maison&candidate=true',
    'https://api.jobs.example/boards/maison/%2Fprivate?tenant=maison',
    'https://api.jobs.example/boards/maison/%255cprivate?tenant=maison',
    'https://api.jobs.example/boards/maison/%2e%2e/private?tenant=maison',
    'https://api.jobs.example/boards/maison/1?tenant=maison#hidden',
    'https://credentials@api.jobs.example/boards/maison/1?tenant=maison',
    'http://api.jobs.example/boards/maison/1?tenant=maison',
  ])('rejects an unreviewed request %#', url => {
    expect(() => matchingAccessScope([scope], request(url))).toThrow(/reviewed/);
  });
  it.each([{ method: 'DELETE' }, { userAgent: null }, { userAgent: 'Googlebot' }, { format: 'BROWSER_RESPONSE' }, { format: 'RENDERED_DOM' }])('rejects unqualified transport %#', change => {
    expect(() => matchingAccessScope([scope], { ...request('https://api.jobs.example/boards/maison/1?tenant=maison'), ...change } as ReturnType<typeof request>)).toThrow();
  });
  it('rejects overlap instead of choosing a permissive rule', () => {
    expect(() => matchingAccessScope([scope, scope], request('https://api.jobs.example/boards/maison/1?tenant=maison'))).toThrow();
  });
  it.each([
    { origin: 'https://api.jobs.example/' }, { origin: 'http://api.jobs.example' },
    { origin: 'https://127.0.0.1' }, { path: { kind: 'PREFIX', value: '/' } },
    { path: { kind: 'PREFIX', value: '/boards/maison' } }, { path: { kind: 'EXACT', value: '//evil.example/jobs' } },
    { surface: 'PRIVATE_OR_INTERNAL' }, { surface: 'PUBLIC_JS_RENDERED_PAGE' },
    { methods: ['GET', 'GET'] }, { methods: ['PUT'] }, { query: { fixed: { tenant: 'x' }, variable: ['tenant'] } },
  ])('rejects a malformed or unproven perimeter %#', change => {
    expect(() => parseAccessScopes([{ ...scope, ...change }])).toThrow();
  });
});

it('freezes a private independent snapshot before asynchronous inspection', () => {
  const input = document(); const parsed = parseAccessDocument(input);
  input.scopes[0].origin = 'https://unreviewed.example';
  expect(parsed.scopes[0].origin).toBe(scope.origin);
  expect(() => { parsed.scopes[0].query.fixed.tenant = 'changed'; }).toThrow();
});
it.each([
  { verdict: 'UNKNOWN' }, { extra: true }, { checkedAt: '2020-01-01' }, { checkedAt: '2099-01-01' },
  { statement: 'yes' }, { robotsCaptureIds: ['same', 'same'] }, { scopes: [] }, { robotsCaptureIds: [] },
  { captureBatchId: null }, { reviewer: '' },
])('refuses incomplete or stale decisions %#', change => {
  expect(() => parseAccessDocument({ ...document(), ...change })).toThrow();
});
it('allows an explicit denial without pretending to have new native proof', () => {
  const input = { ...document(), verdict: 'NOT_AUTHORIZED', captureBatchId: null, scopes: [], robotsCaptureIds: [] };
  expect(parseAccessDocument(input).verdict).toBe('NOT_AUTHORIZED');
  expect(() => parseAccessDocument({ ...input, scopes: [scope] })).toThrow();
});
