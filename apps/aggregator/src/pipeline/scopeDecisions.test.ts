import { describe, expect, it } from 'vitest';
import { applyScopeExclusion, SCOPE_HOLD } from './scopeDecisions.js';
import { publicationDisposition } from './publicationDisposition.js';

describe('sector-perimeter decisions per posting — collection untouched, publication withheld', () => {
  const decidedAt = new Date('2026-09-10T12:00:00Z');
  const exclusions = new Map([['1405738533', { externalId: '1405738533', ruleVersion: 'aptar-perimeter-v2-20260910', decidedAt }]]);
  const job = { externalId: '1405738533', title: 'Account Manager', url: 'https://jobs.aptar.com/job/Congers-Account-Manager-NY-10920/1405738533/', raw: { id: '1405738533' } };

  it('turns an OUT_OF_SCOPE decision into a dated publication hold whose disposition is a withdrawal, never a closure', () => {
    const held = applyScopeExclusion(job, exclusions);
    expect(held.publicationHold).toBe(SCOPE_HOLD);
    expect(held.publicationWithdrawnAt).toEqual(decidedAt);
    expect((held.raw as any).scopeDecision).toEqual({ verdict: 'OUT_OF_SCOPE', ruleVersion: 'aptar-perimeter-v2-20260910', decidedAt: '2026-09-10T12:00:00.000Z' });
    expect((held.raw as any).id).toBe('1405738533');
    expect(publicationDisposition(SCOPE_HOLD)).toEqual({ kind: 'WITHDRAWN', reason: 'OUT_OF_SCOPE' });
  });

  it('leaves every other posting untouched (IN_SCOPE and UNDETERMINED are not loaded as exclusions) and never overrides an earlier hold', () => {
    expect(applyScopeExclusion({ ...job, externalId: '1432782933' }, exclusions)).toEqual({ ...job, externalId: '1432782933' });
    const earlier = { ...job, publicationHold: 'WORKDAY_DETAIL_FETCH_FAILED' };
    expect(applyScopeExclusion(earlier, exclusions)).toBe(earlier);
  });
});
