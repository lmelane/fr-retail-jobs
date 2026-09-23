import { describe, it, expect } from 'vitest';
import { createIntentResolver } from './search-intent';
const resolver = createIntentResolver([
  { key: 'sales', kind: 'role', aliases: ['conseiller de vente', 'conseillère de vente', 'sales advisor', 'vendeuse', '销售顾问'] },
  { key: 'manager', kind: 'role', aliases: ['store manager', 'responsable de boutique'] },
  { key: 'deputy', kind: 'role', aliases: ['assistant store manager'] },
  { key: 'planner-1', kind: 'role', aliases: ['demand planner'] },
  { key: 'planner-2', kind: 'role', aliases: ['demand planner'] },
], [{ id: 'chanel', names: ['Chanel'] }, { id: 'on', names: ['On'] }]);
describe('engine-independent search intent', () => {
  it('requires both role and Maison across languages and accents', () => {
    for (const q of ['conseillère de vente Chanel', 'sales advisor chez Chanel', 'vendeuse CHANEL', '销售顾问 Chanel']) {
      expect(resolver.resolve(q).clauses.map(c => [c.kind, c.keys])).toEqual([['role', ['sales']], ['company', ['chanel']]]);
    }
  });
  it('corrects an unambiguous transposition but preserves Maison and modifiers', () => {
    const result = resolver.resolve('senior sales advsior Chanel Paris').clauses;
    expect(result.map(c => c.kind)).toEqual(['text', 'role', 'company', 'text']);
    expect(result[1].corrected).toBe(true);
    expect(resolver.resolve('sales advisor Chanle').clauses.at(-1)?.kind).toBe('text');
  });
  it('keeps rank, negation, long queries and ambiguous expressions', () => {
    expect(resolver.resolve('assistant store manager').clauses[0].keys).toEqual(['deputy']);
    expect(resolver.titleConcepts('Assistant Store Manager H/F').roles).toEqual(['deputy']);
    expect(resolver.resolve('sales advisor sans Chanel').clauses[1].exclude).toBe(true);
    expect(resolver.resolve('demand planner').clauses.every(c => c.kind === 'text')).toBe(true);
    expect(resolver.resolve('on sales advisor').clauses[0].kind).toBe('text');
    expect(resolver.resolve('sales advisor senior paris samedi dimanche luxe mode temps partiel').clauses.at(-1)?.observed).toBe('partiel');
    expect(() => resolver.resolve('a'.repeat(501))).toThrow('SEARCH_QUERY_TOO_LONG');
  });
  it('does not infer semantic facts from typos in observed titles', () => {
    expect(resolver.titleConcepts('Sales advsior').roles).toEqual([]);
  });
});
