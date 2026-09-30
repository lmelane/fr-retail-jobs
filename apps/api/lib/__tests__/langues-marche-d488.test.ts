import { describe, expect, it } from 'vitest';
import v3 from '../../../../audits/2026-09-28/curation-v3/6-manifeste-v3.json' with { type: 'json' };
import sectors from '../../../../packages/db/data/sectors-v1.json' with { type: 'json' };
import { MARCHES } from '@catwalks/db/marches';
import type { OccupationManifest } from '@catwalks/db/occupations';
import { snapshotModel, type SnapshotMetadata } from '../search-model';
import { searchSql } from '../search-sql';
import { searchWords } from '../search-intent';
import { languesDuMarche } from '../search-langues';
import { MARCHE_RELU_EN_ENTIER, metiersSansIndex } from '../search-chemin';

/**
 * D-488 : la recherche par métier ne porte que les variantes des langues du marché. Témoin pur, sur le manifeste v3
 * ACTIF en production (`catwalks-occupations-20260929-v3`), par le vrai modèle et le vrai SQL.
 * La preuve que les résultats d'un marché ne changent pas se fait sur les documents réels (production, lecture seule,
 * `audits/2026-10-01/d488-langues-marche/`) ; la preuve que la chaîne va jusqu'à la base, dans `jobs-database.test.ts`.
 */
const manifest = v3 as unknown as OccupationManifest;
const model = snapshotModel({
  asOf: '2026-10-01T00:00:00.000Z', occupationRelease: { id: manifest.id, manifest }, companies: [], aliases: [],
  sectorConcepts: sectors.map((s) => ({ code: s.code, labels: s.labels as Record<string, string> })),
} as SnapshotMetadata);
const e = (v: string) => searchWords(v).join(' ');
const metier = (q: string, marche?: (typeof MARCHES)[keyof typeof MARCHES]) => model.intention(q, marche).clauses[0];
/** Le texte des `tsquery` de la requête : ce que la base évalue pour chaque document. */
const tsquery = (q: string, marche?: (typeof MARCHES)[keyof typeof MARCHES]) =>
  searchSql(model.intention(q, marche)).condition.values.filter((v): v is string => typeof v === 'string').join(' ');

describe('D-488 : les variantes d\'un métier sont celles des langues du marché', () => {
  it('PRÉMISSE : sans marché, « conseiller de vente » embarque ses libellés dans 25 langues', () => {
    const c = metier('conseiller de vente');
    expect(c).toMatchObject({ kind: 'role', keys: ['sales-advisor'] });
    for (const etrangere of ['مستشار مبيعات', 'Verkaufsberater', 'Asesor de ventas', 'セールスアドバイザー', 'Σύμβουλος πωλήσεων'])
      expect(c.phrases).toContain(e(etrangere));
    expect(c.phrases.length).toBe(80);
  });

  it('sur le marché français : ni arabe, ni allemand, ni japonais ; la requête est plus courte', () => {
    const c = metier('conseiller de vente', MARCHES.FR);
    expect(languesDuMarche(MARCHES.FR)).toEqual(['en', 'fr']);
    for (const retiree of ['مستشار مبيعات', 'Verkaufsberater', 'Asesor de ventas', 'セールスアドバイザー', 'Σύμβουλος πωλήσεων', '销售顾问'])
      expect(c.phrases).not.toContain(e(retiree));
    // Libellés du marché, libellé d'une autre langue écrit avec les mots du marché, variantes relevées en écriture latine.
    for (const gardee of ['Conseiller de vente', 'Sales Advisor', 'Sales Assistant', 'Addetto vendite', 'Conseillère de vente', 'Vendeuse'])
      expect(c.phrases).toContain(e(gardee));
    expect(c.phrases.length).toBeLessThan(55);
    const avant = tsquery('conseiller de vente').length, apres = tsquery('conseiller de vente', MARCHES.FR).length;
    expect(apres).toBeLessThan(avant * 0.7);
    // L'identité du métier ne change pas : l'offre classée reste trouvée par son code.
    expect(c.keys).toEqual(['sales-advisor']);
  });

  it('sur le marché japonais, le libellé japonais reste ; sur le marché chinois, le chinois', () => {
    expect(metier('sales advisor', MARCHES.JP).phrases).toContain(e('セールスアドバイザー'));
    expect(metier('sales advisor', MARCHES.JP).phrases).not.toContain(e('مستشار مبيعات'));
    expect(metier('sales advisor', MARCHES.CN).phrases).toContain(e('销售顾问'));
    expect(metier('sales advisor', MARCHES.HK).phrases).toContain(e('銷售顧問'));
    expect(metier('store manager', MARCHES.CH).phrases).toEqual(expect.arrayContaining([e('Filialleiter')]));
  });

  it('ce que la personne a tapé reste dans la requête, même dans une autre langue', () => {
    const c = metier('Verkaufsberater', MARCHES.FR);
    expect(c.keys).toEqual(['sales-advisor']);
    expect(c.phrases).toContain('verkaufsberater');
    expect(c.phrases).not.toContain(e('Asesor de ventas'));
  });

  it('sans marché, ou hors métier (texte, famille), la requête est inchangée', () => {
    expect(model.intention('conseiller de vente', undefined)).toEqual(model.resolver.resolve('conseiller de vente'));
    const famille = model.resolver.resolve('conseil de vente');
    expect(famille.clauses[0].kind).toBe('family');
    expect(model.intention('conseil de vente', MARCHES.FR)).toEqual(famille);
    expect(model.intention('chanel paris', MARCHES.FR)).toEqual(model.resolver.resolve('chanel paris'));
  });

  it('le chemin : relire le marché pour un petit marché ou un métier large, l\'index pour un métier rare d\'un grand marché', () => {
    const vente = model.intention('conseiller de vente', MARCHES.FR), horloger = model.intention('horloger', MARCHES.FR);
    const grand = { total: 13_368, parMetier: new Map([['sales-advisor', 4_500], ['watchmaker', 60]]) };
    expect(metiersSansIndex(vente, grand)).toBe(true);
    expect(metiersSansIndex(horloger, grand)).toBe(false);
    expect(metiersSansIndex(horloger, { total: MARCHE_RELU_EN_ENTIER, parMetier: new Map() })).toBe(true);
    // Sans clause de métier (Maison, mots libres), ou un métier seulement exclu : le chemin d'avant.
    expect(metiersSansIndex(model.intention('chanel paris', MARCHES.FR), { total: 10, parMetier: new Map() })).toBe(false);
    expect(metiersSansIndex(model.intention('sans vendeur', MARCHES.FR), { total: 10, parMetier: new Map() })).toBe(false);
  });

  it('le SQL : sans l\'option, la condition d\'avant à l\'identique ; avec, la clause de métier hors index, le reste indexable', () => {
    const i = model.intention('conseiller de vente sans chanel', MARCHES.FR);
    expect(i.clauses.map((c) => c.kind)).toEqual(['role', 'text']);
    const avant = searchSql(i).condition, apres = searchSql(i, { metiersSansIndex: true }).condition;
    expect(avant.sql.startsWith('s.vector @@ (')).toBe(true);
    expect(avant.sql).not.toContain('coalesce');
    expect(apres.sql).toContain("coalesce(s.vector, ''::tsvector) @@");
    expect(apres.sql).toContain('s.vector @@ (!!(');
    // Les mêmes valeurs liées : seul le chemin change, jamais la requête de mots.
    expect([...apres.values].map(String).sort()).toEqual([...avant.values].map(String).sort());
  });

  it('pour chaque métier et chaque marché : une partie des expressions, jamais vide, avec le libellé du marché', () => {
    for (const o of manifest.occupations) for (const m of Object.values(MARCHES)) {
      const q = o.labels.en ?? Object.values(o.labels)[0];
      const entiere = model.resolver.resolve(q).clauses;
      if (entiere.length !== 1 || entiere[0].kind !== 'role' || entiere[0].keys[0] !== o.key) continue;
      const c = model.intention(q, m).clauses[0];
      expect(c.phrases.length).toBeGreaterThan(0);
      expect(c.phrases.every((p) => entiere[0].phrases.includes(p))).toBe(true);
      for (const l of languesDuMarche(m)) for (const [etiquette, v] of Object.entries(o.labels))
        if (etiquette.split('-')[0] === l && e(v)) expect(c.phrases, `${o.key} ${m.code} ${etiquette}`).toContain(e(v));
    }
  });
});
