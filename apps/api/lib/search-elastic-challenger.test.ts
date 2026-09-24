import { describe, expect, it } from 'vitest';
import { elasticQuery } from '../scripts/search-benchmark/elastic-query';
import { type SearchClause, type SearchIntent } from './search-intent';

const text = (patch: Partial<SearchClause> = {}): SearchClause => ({ kind: 'text', keys: [], phrases: ['tailleur'], observed: 'tailleur', exclude: false, corrected: false, ...patch });
const query = (...clauses: SearchClause[]) => elasticQuery({ version: 1, original: '', clauses } satisfies SearchIntent, ['FR'], 100);
describe('offline linguistic challenger safeguards', () => {
  it('keeps country, every composed clause, direct priority and deterministic tie breakers', () => {
    const q = query(text(), text({ kind: 'company', keys: ['employer'], phrases: ['Chanel'] }));
    expect(q.query.bool.filter).toEqual([{ terms: { country: ['FR'] } }]);
    expect(q.query.bool.must).toHaveLength(2);
    expect(q.sort).toEqual([{ origin: 'asc' }, '_score', { postedAt: 'desc' }, { firstSeenAt: 'desc' }, { id: 'asc' }]);
  });
  it('never stems or fuzzes employer identities, exclusions or ambiguous brands', () => {
    for (const c of [text({ kind: 'company', keys: ['employer'] }), text({ exclude: true })]) {
      const body = JSON.stringify(query(c));
      expect(body).not.toContain('linguistic_'); expect(body).not.toContain('fuzzy');
    }
    expect(JSON.stringify(query(text({ preferCompanyKeys: ['brand'] })))).not.toContain('fuzzy');
  });
  it('preserves title role precedence instead of retrieving deputies by broad stem', () => {
    const body = JSON.stringify(query(text({ kind: 'role', keys: ['store-manager'], phrases: ['store manager'] })));
    expect(body).toContain('"must_not":[{"exists":{"field":"titleRoles"}}]');
    expect(body).toContain('"roles":["store-manager"]'); expect(body).not.toContain('fuzzy');
  });
  it('bounds fuzzy tokens and keeps other words exact in the same field', () => {
    const body = JSON.stringify(query(text({ phrases: ['tailleur junior'] })));
    expect(body).toContain('"value":"tailleur","fuzziness":1,"prefix_length":2,"max_expansions":20');
    expect(body).toContain('"term":{"title":"junior"}');
    expect(body).not.toContain('"fuzzy":{"company"'); expect(body).not.toContain('"fuzzy":{"body"');
    for (const phrase of ['on', 'chef', 'tailleur 2026', 'a b c d tailleur']) {
      expect(JSON.stringify(query(text({ phrases: [phrase] })))).not.toContain('fuzzy');
    }
  });
  it('uses only the shared synonym phrases and confines title-only synonyms', () => {
    const q = query(text({ kind: 'role', keys: ['fixture'], phrases: ['tailleur'], titleOnlyPhrases: ['tailleur'] }));
    const body = JSON.stringify(q);
    expect(body).toContain('linguistic_fr_title^10'); expect(body).not.toContain('duties'); expect(body).not.toContain('body');
  });
});
