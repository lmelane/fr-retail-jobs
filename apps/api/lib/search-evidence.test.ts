import { describe, expect, it } from 'vitest';
import { searchEvidence } from './search-evidence';
import { searchConcepts } from './search-vocabulary';
import { createIntentResolver } from './search-intent';
import type { OccupationManifest } from '@catwalks/db/occupations';

describe('native search evidence', () => {
  it('separates founder history and hiring-event directions from duties', () => {
    const result = searchEvidence('Christian Dior fut le couturier du rêve.\nVos missions :\nConseiller les clients.\nProfil recherché\nExpérience couture appréciée.\nHow to attend\nUse elevators closest to the Gucci department.');
    expect(result.duties).toContain('Conseiller les clients');
    expect(result.duties).not.toMatch(/couturier|couture|Gucci/);
    expect(result.affiliations).toBe('');
    expect(searchEvidence('Your responsibilities\nDevelop software\nHiring process\nYou will be contacted by our recruiter').duties).not.toContain('recruiter');
  });
  it('keeps a real retailer relationship without treating the whole description as company evidence', () => {
    const result = searchEvidence('Nous recherchons un conseiller soin pour nos points de vente Nocibé situés à Nantes.\nNotre groupe détient aussi UneAutreMarque.');
    expect(result.affiliations).toContain('Nocibé');
    expect(result.affiliations).not.toContain('UneAutreMarque');
  });
  it('preserves HTML structure and multilingual duty headings', () => {
    const result = searchEvidence('<p>Company history</p><h2>YOUR RESPONSIBILITIES</h2><ul><li>Repair watches</li></ul><h2>Requirements</h2><p>Prior sales experience</p>');
    expect(result.duties).toContain('Repair watches');
    expect(result.duties).not.toMatch(/Company history|Prior sales/);
    expect(searchEvidence('工作职责\n完成销售目标\n任职要求\n有经验').duties).toContain('完成销售目标');
  });
  it('recognizes an unclassified CJK role inside an unsegmented native title', () => {
    const resolver = createIntentResolver([{ key: 'sales', kind: 'role', aliases: ['销售顾问', 'sales advisor'] }], []);
    expect(resolver.titleConcepts('资深销售顾问上海').roles).toEqual(['sales']);
    expect(resolver.resolve('销售顾问').clauses[0].keys).toEqual(['sales']);
  });
  it('adds search aliases and conjunction-free family forms without changing the occupation release', () => {
    const manifest = { occupations: [{ key: 'product-developer', family: 'product-development-rd', labels: { en: 'Product developer' } }],
      families: [{ key: 'health-optical-services', labels: { en: 'Health, pharmacy and optical services', fr: 'Santé, pharmacie et optique' } }] } as unknown as OccupationManifest;
    const before = JSON.stringify(manifest);
    const resolver = createIntentResolver(searchConcepts(manifest, []), [{ id: 'on', names: ['On'] }]);
    expect(resolver.titleConcepts('Senior Footwear Developer').roles).toEqual(['product-developer']);
    expect(resolver.resolve('santé pharmacie optique').clauses[0].kind).toBe('family');
    expect(resolver.resolve('product developer On').clauses.map(c => c.kind)).toEqual(['role', 'company']);
    expect(resolver.resolve('product developer chez On').clauses.map(c => c.kind)).toEqual(['role', 'company']);
    expect(resolver.resolve('on Monday').clauses.every(c => c.kind === 'text')).toBe(true);
    expect(resolver.resolve('On').clauses[0]).toMatchObject({ kind: 'text', keys: [], preferCompanyKeys: ['on'] });
    expect(JSON.stringify(manifest)).toBe(before);
    const finance = searchConcepts({ ...manifest, occupations: [{ key: 'financial-controller', labels: { en: 'Financial controller' } }] }, []);
    expect(createIntentResolver(finance, []).resolve('financial controller').clauses[0].titleOnlyPhrases).toContain('controlling');
  });
});
