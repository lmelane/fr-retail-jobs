import { describe, expect, it } from 'vitest';
import { CATALOGUE_LABEL, classifyLabel, readRobots, requestTarget, robotsReading, scopeEvidence } from './candidateChecks.js';

describe('explicit robots verdict', () => {
  const robots = 'User-agent: *\nDisallow: /private\nAllow: /v1/boards/';
  it('a READ file decides on the request path, and the reading is dated by its hash', () => {
    expect(robotsReading({ status: 200, text: robots }, '/v1/boards/onrunning/jobs')).toMatchObject({ verdict: 'ALLOWED', httpStatus: 200, bytes: robots.length });
    expect(robotsReading({ status: 200, text: robots }, '/private/x').verdict).toBe('DISALLOWED');
    expect(robotsReading({ status: 200, text: robots }, '/v1/boards/x').sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('an absent file is NO_ROBOTS, never ALLOWED', () => {
    expect(robotsReading({ status: 404, text: '' }, '/').verdict).toBe('NO_ROBOTS');
    expect(robotsReading({ status: 410, text: '' }, '/').verdict).toBe('NO_ROBOTS');
  });
  it('a blocked, throttled, failing or unreachable host is UNREACHABLE, with the cause', () => {
    for (const status of [401, 403, 429, 500, 503]) expect(robotsReading({ status, text: '' }, '/')).toMatchObject({ verdict: 'UNREACHABLE', httpStatus: status, error: `HTTP ${status}` });
    expect(robotsReading({ error: 'fetch failed' }, '/')).toMatchObject({ verdict: 'UNREACHABLE', httpStatus: null, error: 'fetch failed' });
  });
  it('readRobots turns a network failure into UNREACHABLE instead of throwing', async () => {
    const failing = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    expect(await readRobots('https://example.test', '/', failing)).toMatchObject({ verdict: 'UNREACHABLE', error: 'ECONNRESET' });
    const ok = (async () => new Response('User-agent: *\nDisallow:', { status: 200 })) as unknown as typeof fetch;
    expect((await readRobots('https://example.test', '/jobs', ok)).verdict).toBe('ALLOWED');
  });
});

describe('request target per kind', () => {
  it('points at the host the adapter calls, not the candidate page', () => {
    expect(requestTarget('greenhouse', { board: 'onrunning' })).toEqual({ origin: 'https://boards-api.greenhouse.io', path: '/v1/boards/onrunning/jobs' });
    expect(requestTarget('lever', { site: 'arcteryx.com' })).toEqual({ origin: 'https://api.lever.co', path: '/v0/postings/arcteryx.com' });
    expect(requestTarget('workday', { origin: 'https://fastretailing.wd3.myworkdayjobs.com', tenant: 'fastretailing', site: 'retail_us_Uniqlo' })).toEqual({ origin: 'https://fastretailing.wd3.myworkdayjobs.com', path: '/wday/cxs/fastretailing/retail_us_Uniqlo/jobs' });
    expect(requestTarget('digitalrecruiters', { domainName: 'careers.am-vintage.com' })).toEqual({ origin: 'https://careers.am-vintage.com', path: '/' });
  });
  it('refuses a configuration with nothing to request', () => {
    expect(() => requestTarget('generic-listing', {})).toThrow(/no request origin/);
  });
});

describe('native labels against the catalogued Maison', () => {
  it('OWNER: same identity or same normalized name, whatever the case or legal form', () => {
    expect(classifyLabel('UNIQLO USA LLC', 'Uniqlo')).toBe('OWNER');
    expect(classifyLabel('UNIQLO AUSTRALIA PTY LTD.', 'Uniqlo')).toBe('OWNER');
    expect(classifyLabel('la fée maraboutée', 'La Fée Maraboutée')).toBe('OWNER');
    expect(classifyLabel('Armand Thiery', 'Armand Thiery')).toBe('OWNER');
  });
  it("OWNER_ENTITY: the Maison's name survives inside the legal entity label", () => {
    expect(classifyLabel('UNIQLO Massachusetts LLC', 'Uniqlo')).toBe('OWNER_ENTITY');
    expect(classifyLabel("L'IMPERTINENTE - Ysé", 'Ysé')).toBe('OWNER_ENTITY');
    expect(classifyLabel('UNIQLO EUROPE LIMITED FRENCH BRANCH', 'UNIQLO')).toBe('OWNER_ENTITY');
    expect(classifyLabel('VF Outdoor, LLC', 'VF Corporation')).toBe('OWNER_ENTITY'); expect(classifyLabel('VF International S.a.g.l.', 'VF Corporation')).toBe('OWNER_ENTITY');
    expect(classifyLabel('Link Theory (UK) Ltd. FRENCH BRANCH', 'Theory')).toBe('OWNER_ENTITY');
  });
  it('OTHER: another brand on the same portal is never an entity of the owner', () => {
    expect(classifyLabel('GU USA LLC', 'Uniqlo')).toBe('OTHER');
    expect(classifyLabel('Kate Spade', 'Coach')).toBe('OTHER');
    expect(classifyLabel('Beiersdorf', 'La Prairie')).toBe('OTHER');
    expect(classifyLabel('Icebreaker New Zealand Limited', 'VF Corporation')).toBe('OTHER');
  });
  it('the perimeter verdict follows the worst label; a board without labels is NO_NATIVE_LABEL', () => {
    expect(scopeEvidence(new Map([['UNIQLO USA LLC', 13], ['GU USA LLC', 1]]), 'Uniqlo')).toMatchObject({ verdict: 'LABELS_OUTSIDE_OWNER', other: ['GU USA LLC (1)'] });
    expect(scopeEvidence(new Map([['UNIQLO USA LLC', 225], ['UNIQLO Massachusetts LLC', 32]]), 'Uniqlo').verdict).toBe('SINGLE_BRAND_CONSISTENT');
    expect(scopeEvidence(new Map([[CATALOGUE_LABEL, 309]]), 'On').verdict).toBe('NO_NATIVE_LABEL');
  });
});
