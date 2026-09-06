import { describe, it, expect } from 'vitest';

/**
 * Test d'intégration LÉGER sur la copie locale de prod — et SEULEMENT elle :
 * il ne tourne que si DATABASE_URL est exactement l'URL locale du brief
 * (jamais `catwalks_test`, vidée par d'autres tests ; jamais la prod). Lecture
 * seule. Il vérifie que chaque requête SQL répond et que les totaux se
 * recoupent (pays + sans pays = actives ; villes ≤ actives ; scope FR ⊂ monde).
 */
const LOCAL = 'postgresql://catwalks:catwalks@localhost:55440/catwalks';
const enabled = process.env.DATABASE_URL === LOCAL;

describe.skipIf(!enabled)('intelligence facts (local prod copy, read-only)', () => {
  it('answers every aggregate and the totals reconcile', async () => {
    const facts = await import('../intelligence/facts');
    const [h, countries, cities, companies, sectors, functions, seniority, contracts, closed] = await Promise.all([
      facts.headline(), facts.byCountry(), facts.byCity({}, 1000), facts.byCompany({}, 1000), facts.bySector(),
      facts.byFunction(), facts.bySeniority(), facts.byContract(), facts.closedFacts(),
    ]);
    expect(h.active).toBeGreaterThan(0);
    const sum = (rows: { count: number }[]) => rows.reduce((s, r) => s + r.count, 0);
    expect(countries.rows.reduce((s, r) => s + r.active, 0) + countries.unknown).toBe(h.active);
    expect(cities.reduce((s, r) => s + r.active, 0)).toBeLessThanOrEqual(h.active);
    expect(companies.reduce((s, r) => s + r.active, 0)).toBe(h.active);
    expect(sum(sectors)).toBe(h.active);
    expect(sum(functions)).toBe(h.active);
    expect(sum(seniority)).toBe(h.active);
    expect(sum(contracts)).toBe(h.active);
    expect(closed.closed30d).toBeGreaterThanOrEqual(closed.closed7d);

    const fr = await facts.headline({ country: 'FR' });
    expect(fr.active).toBe(countries.rows.find((c) => c.code === 'FR')?.active ?? 0);
    expect(fr.active).toBeLessThanOrEqual(h.active);

    const top = companies[0];
    const one = await facts.headline({ companyId: top.id });
    expect(one.active).toBe(top.active);
  });

  it('reads MarketSnapshot without failing when it is empty', async () => {
    const snap = await import('../intelligence/snapshots');
    const s = await snap.series('global', '', 400);
    expect(Array.isArray(s)).toBe(true);
    expect(await snap.snapshotDays('global', '')).toBe(s.length);
  });
});
