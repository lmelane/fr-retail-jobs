import { describe, it, expect } from 'vitest';

/** Real-corpus checks are explicitly opted into on a local replay database.
 * No fixed credential/port: an obsolete local URL used to silently skip them.
 * This file only reads data; never run the destructive fixture suites here. */
const corpusUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const enabled = process.env.READ_ONLY_CORPUS_TEST === '1' &&
  !!corpusUrl && ['localhost', '127.0.0.1'].includes(corpusUrl.hostname) &&
  /^\/catwalks_.*replay/.test(corpusUrl.pathname);

describe.skipIf(!enabled)('intelligence facts (local prod copy, read-only)', () => {
  it('answers every aggregate and the totals reconcile', async () => {
    const facts = await import('../intelligence/facts');
    const [h, countries, cities, companies, sectors, functions, seniority, contracts, closed] = await Promise.all([
      facts.headline(), facts.byCountry(), facts.byCity({}, 1000), facts.byCompany({}, 10000), facts.bySector(),
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

/**
 * FUMÉE SQL — chaque requête brute doit au moins S'EXÉCUTER.
 *
 * Écrit après un 500 en prod le 2026-09-08 : `SELECT j.employmentTerm` (sans
 * guillemets) — Postgres replie l'identifiant non cité en minuscules, cherche
 * `j.employmentterm`, et toute la page Pays tombait. Le typecheck ne voit rien
 * dans une chaîne SQL, et le test d'intégration ci-dessus ne tournait que sur
 * une copie locale de prod que personne n'a.
 *
 * Celui-ci tourne sur N'IMPORTE QUELLE base au bon schéma, base vide comprise :
 * il n'affirme rien sur les données, seulement que le SQL est valide. C'est le
 * contrôle le moins cher qui aurait attrapé ce bug.
 */
const schemaOnly = Boolean(process.env.DATABASE_URL);

describe.skipIf(!schemaOnly)('intelligence facts — le SQL brut est valide', () => {
  it('exécute chaque agrégat sans erreur SQL', async () => {
    const facts = await import('../intelligence/facts');
    // Toute colonne mal citée fait échouer l'appel : c'est l'assertion.
    await Promise.all([
      facts.headline(),
      facts.byCountry(),
      facts.byCity({}, 5),
      facts.byCompany({}, 5),
      facts.bySector(),
      facts.byFunction(),
      facts.bySeniority(),
      facts.byContract(),
      facts.closedFacts(),
    ]);
  });

  /** Un périmètre non vide emprunte d'autres branches SQL (le `where` du scope). */
  it('exécute les agrégats sous un périmètre pays', async () => {
    const facts = await import('../intelligence/facts');
    await Promise.all([
      facts.headline({ country: 'FR' }),
      facts.byCity({ country: 'FR' }, 5),
      facts.byContract({ country: 'FR' }),
      facts.byFunction({ country: 'FR' }),
    ]);
  });
});
