import { describe, it, expect } from 'vitest';
import { canonicalIdContract, type AdapterEnumerationResult } from './canonicalIdContract.js';

/**
 * LE CONTRAT DES IDENTIFIANTS — générique, imposé à la SOURCE et non compensé par un seuil.
 *
 * Un seuil de recouvrement serait arbitraire et, surtout, faux : « un seul identifiant commun suffit »
 * laisserait passer 1 ancien format + 99 nouveaux, soit 99 fausses absences. La règle est donc structurelle :
 * chaque `job.externalId` DOIT figurer dans les identifiants canoniques observés, et chaque identifiant
 * canonique observé qui ne devient pas une offre DOIT avoir une disposition NOMMÉE.
 */
const result = (over: Partial<AdapterEnumerationResult> = {}): AdapterEnumerationResult => ({
  candidateExternalIds: ['a', 'b'],
  canonicalObservedIds: ['a', 'b'],
  heldIds: [], writeFailedIds: [], rejectedIds: [], collectionErrorIds: [],
  ...over,
});

describe('canonicalIdContract — chaque offre écrite doit figurer dans la preuve', () => {
  it('un résultat cohérent satisfait le contrat', () => {
    expect(canonicalIdContract(result())).toEqual({ satisfied: true, violations: [] });
  });

  /**
   * LE CAS QUI IMPORTE : une offre écrite mais ABSENTE de la preuve signifie que les deux chemins ne
   * produisent pas le même identifiant. Sans ce contrôle, elle paraîtrait absente au refresh suivant.
   */
  it('refuse une offre produite qui ne figure pas dans les identifiants observés', () => {
    const r = canonicalIdContract(result({ candidateExternalIds: ['a', 'b', 'fantome'] }));
    expect(r.satisfied).toBe(false);
    expect(r.violations.join(' ')).toMatch(/fantome/);
  });

  it('refuse un identifiant observé sans disposition explicite', () => {
    const r = canonicalIdContract(result({ canonicalObservedIds: ['a', 'b', 'orpheline'] }));
    expect(r.satisfied).toBe(false);
    expect(r.violations.join(' ')).toMatch(/orpheline/);
  });

  it.each([
    ['heldIds', 'retenue'],
    ['writeFailedIds', 'refus d\'écriture'],
    ['rejectedIds', 'rejet motivé'],
    ['collectionErrorIds', 'erreur de collecte'],
  ])('accepte un identifiant observé non publié quand sa disposition est nommée (%s)', (field) => {
    const r = canonicalIdContract(result({ canonicalObservedIds: ['a', 'b', 'x'], [field]: ['x'] } as any));
    expect(r).toEqual({ satisfied: true, violations: [] });
  });

  /**
   * LE CONTRE-EXEMPLE EXIGÉ : 1 identifiant dans l'ancien format, 99 dans un format incompatible.
   * Une garde « un seul recouvrement suffit » l'aurait déclaré comparable et produit 99 fausses absences.
   */
  it('1 ancien format + 99 nouveaux : le contrat REFUSE, là où un seuil de recouvrement aurait accepté', () => {
    const stored = ['legacy-1', ...Array.from({ length: 99 }, (_, i) => `legacy-${i + 2}`)];
    const observed = ['legacy-1', ...Array.from({ length: 99 }, (_, i) => `nouveau/${i + 2}-slug`)];
    const r = canonicalIdContract(result({ candidateExternalIds: stored, canonicalObservedIds: observed }));
    expect(r.satisfied).toBe(false);
    // Les 99 offres écrites absentes de la preuve sont nommées, pas noyées dans un ratio.
    expect(r.violations.length).toBeGreaterThanOrEqual(99);
  });

  /** Une preuve sans identifiants canoniques ne permet aucune conclusion — elle n'est pas « vide ». */
  it('refuse une preuve dépourvue d\'identifiants canoniques alors que des offres ont été produites', () => {
    const r = canonicalIdContract(result({ canonicalObservedIds: [] }));
    expect(r.satisfied).toBe(false);
    expect(r.violations.join(' ')).toMatch(/aucun identifiant canonique/);
  });

  it('un run qui n\'écrit rien et n\'observe rien est cohérent', () => {
    expect(canonicalIdContract(result({ candidateExternalIds: [], canonicalObservedIds: [] })).satisfied).toBe(true);
  });
});
