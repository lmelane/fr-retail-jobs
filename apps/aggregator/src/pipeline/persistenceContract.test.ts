import { describe, it, expect } from 'vitest';
import { persistenceContract, type CycleSets } from './persistenceContract.js';

/**
 * LE CONTRAT DE PERSISTANCE ferme l'écart que le contrat d'adaptateur laisse ouvert : celui-ci démontre
 * « sortie de l'adaptateur ↔ preuve », celui-là « preuve ↔ ce qui existe réellement en base ».
 */
const sets = (over: Partial<CycleSets> = {}): CycleSets => ({
  sourceKey: 's', runId: 'run-1',
  canonicalObservedIds: ['a', 'b'],
  persistedJobSourceExternalIds: ['a', 'b'],
  heldIds: [], writeFailedIds: [], rejectedIds: [], collectionErrorIds: [],
  unattributableWriteFailures: 0, ...over,
});

describe('persistenceContract — l\'égalité des ensembles, par identifiant', () => {
  it('un cycle cohérent satisfait le contrat', () => {
    const r = persistenceContract(sets());
    expect(r.satisfied).toBe(true);
    expect(r.absenceProvable).toBe(true);
  });

  it.each([
    ['heldIds', 'retenue'],
    ['writeFailedIds', 'échec d\'écriture'],
    ['rejectedIds', 'rejet'],
    ['collectionErrorIds', 'erreur de collecte'],
  ])('une offre observée mais non persistée est couverte par sa disposition (%s)', (field) => {
    const r = persistenceContract(sets({
      canonicalObservedIds: ['a', 'b', 'c'], persistedJobSourceExternalIds: ['a', 'b'], [field]: ['c'],
    } as any));
    expect(r.satisfied).toBe(true);
  });

  /** Sens 1 — on ignore ce qu'est devenu un identifiant vu : rien ne peut être conclu d'une absence. */
  it('un identifiant OBSERVÉ sans devenir connu rompt le contrat', () => {
    const r = persistenceContract(sets({ canonicalObservedIds: ['a', 'b', 'orpheline'] }));
    expect(r.satisfied).toBe(false);
    expect(r.observedNotAccountedFor).toEqual(['orpheline']);
    expect(r.absenceProvable).toBe(false);
  });

  /**
   * Sens 2 — LE PLUS DANGEREUX : une JobSource active que la preuve n'a pas vue paraîtrait absente au refresh
   * suivant, et serait fermée à tort. C'est exactement le défaut American Vintage, vu depuis la persistance.
   */
  it('une JobSource ACTIVE absente de la preuve rompt le contrat', () => {
    const r = persistenceContract(sets({
      canonicalObservedIds: ['a'], persistedJobSourceExternalIds: ['a', 'invisible'],
    }));
    expect(r.satisfied).toBe(false);
    expect(r.persistedNotObserved).toEqual(['invisible']);
    expect(r.absenceProvable).toBe(false);
  });

  /**
   * Un échec non rattachable ne se compte JAMAIS comme zéro : la ligne disparue pourrait être précisément
   * celle dont l'écriture a échoué anonymement.
   */
  it('un échec d\'écriture non rattachable retire le droit de prouver une absence', () => {
    const r = persistenceContract(sets({ unattributableWriteFailures: 1 }));
    expect(r.satisfied).toBe(false);
    expect(r.absenceProvable).toBe(false);
    expect(r.violations.join(' ')).toMatch(/non rattachable/);
  });

  it('un cycle qui n\'observe rien et ne persiste rien est cohérent', () => {
    expect(persistenceContract(sets({ canonicalObservedIds: [], persistedJobSourceExternalIds: [] })).satisfied)
      .toBe(true);
  });

  /** Le cas MECCA du 12/09 : 9 refus d'identité, tous rattachés — le contrat tient. */
  it('MECCA : neuf refus d\'identité rattachés satisfont le contrat', () => {
    const refused = Array.from({ length: 9 }, (_, i) => `R${i}`);
    const r = persistenceContract(sets({
      canonicalObservedIds: ['a', ...refused], persistedJobSourceExternalIds: ['a'], writeFailedIds: refused,
    }));
    expect(r.satisfied).toBe(true);
  });
});
