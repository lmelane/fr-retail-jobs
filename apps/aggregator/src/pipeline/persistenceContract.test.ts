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
   * LA DISTINCTION QUE LA PREMIÈRE VERSION MANQUAIT, et qui décide de tout.
   *
   * Une JobSource active absente de la preuve peut être une VRAIE disparition — le cas normal, et ce que le
   * refresh existe pour fermer — ou un défaut de vocabulaire. Les traiter pareil rendait tout board vivant
   * « non conforme » et interdisait toute fermeture, à jamais.
   *
   * Ce qui les sépare : le sens inverse. Mesuré sur MECCA — 181 observés, 181 présents en base, 12 stockés non
   * observés, vus pour la dernière fois du 8 au 10 septembre. De vraies disparitions.
   */
  it('une JobSource absente de la preuve est une DISPARITION, pas une violation, si le vocabulaire est partagé', () => {
    const r = persistenceContract(sets({
      canonicalObservedIds: ['a'], persistedJobSourceExternalIds: ['a', 'disparue'],
    }));
    expect(r.satisfied).toBe(true);
    expect(r.absenceProvable).toBe(true);
    // Elle reste NOMMÉE : c'est une candidate à fermeture, que le refresh examinera.
    expect(r.persistedNotObserved).toEqual(['disparue']);
  });

  it('le cas réel MECCA : 181 observés tous en base, 12 stockés non observés → contrat SATISFAIT', () => {
    const observed = Array.from({ length: 181 }, (_, i) => `obs-${i}`);
    const gone = Array.from({ length: 12 }, (_, i) => `partie-${i}`);
    const r = persistenceContract(sets({
      canonicalObservedIds: observed, persistedJobSourceExternalIds: [...observed, ...gone],
    }));
    expect(r.satisfied).toBe(true);
    expect(r.persistedNotObserved).toHaveLength(12);
  });

  /** AUCUN recouvrement dans le sens observé → base : là, c'est bien le vocabulaire qui est en cause. */
  it('aucun identifiant observé n\'existant en base : contrat ROMPU (american-vintage-dr)', () => {
    const r = persistenceContract(sets({
      canonicalObservedIds: ['4594925-72559621', '4589143-51323249'],
      persistedJobSourceExternalIds: ['4459569', '4472375'],
    }));
    expect(r.satisfied).toBe(false);
    expect(r.absenceProvable).toBe(false);
    expect(r.violations.join(' ')).toMatch(/ne produisent pas le même identifiant/);
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
    expect(r.persistedNotObserved).toEqual([]);
  });
});
