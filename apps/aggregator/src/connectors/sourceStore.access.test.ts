import { describe, expect, it } from 'vitest';
import { isAllowedAccessVerdict } from './sourceStore.js';

describe('access verdicts accepted by promotion', () => {
  it('accepts robots ALLOWED and an owner-recorded nominal authorization, keeping its note', () => {
    expect(isAllowedAccessVerdict('ALLOWED')).toBe(true);
    expect(isAllowedAccessVerdict(' allowed ')).toBe(true);
    expect(isAllowedAccessVerdict('ALLOWED (autorisation propriétaire — URBN (autorisation obtenue par Loïc), 2026-09-05)')).toBe(true);
    expect(isAllowedAccessVerdict('ALLOWED (autorisation sectorielle, 2026-09-05)')).toBe(true);
  });
  it('refuses anything else: disallowed, unknown, or an ALLOWED qualified by something that is not an authorization', () => {
    for (const v of ['DISALLOWED', 'UNKNOWN', '', null, undefined, 'ALLOWED (à vérifier)', 'ALLOWED?', 'NOT ALLOWED (autorisation)', 'ALLOWED (autorisation) trailing']) expect(isAllowedAccessVerdict(v as any)).toBe(false);
  });
});
