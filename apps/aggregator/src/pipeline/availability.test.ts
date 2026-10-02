import { describe, expect, it } from 'vitest';
import { collectionReconfirms, reconfirmationVerdict } from './availability.js';
import type { AttestationFacts } from './refreshPlan.js';

/** R-143 §2 — ce qui rend une collecte assez crédible pour retirer de l'expérience une offre qu'elle n'a pas vue. */
const facts = (over: Partial<AttestationFacts> = {}): AttestationFacts => ({
  sourceKey: 'hm-group', captureBatchId: 'b', startedAt: new Date('2026-10-01T17:00:00Z'), status: 'OK', errors: 0, truncated: false,
  complete: null, declaredTotal: 1935, fetched: 1935, published: 1935, previous: 1942, canAttestAbsence: false, ...over,
});

describe('collectionReconfirms', () => {
  it('le cas mesuré H&M : tout le total annoncé lu, fin de parcours non prouvée : crédible pour la disponibilité', () => {
    // canAttestAbsence = false : la source ne peut rien FERMER, mais elle peut dire ce qu'elle ne liste plus.
    expect(collectionReconfirms(facts())).toBeNull();
  });
  it.each([
    [{ status: 'BROKEN' as const }, /BROKEN/],
    [{ status: 'NEW' as const }, /NEW/],
    [{ truncated: true }, /tronquée/],
    [{ declaredTotal: 0, fetched: 0, published: 0 }, /zéro annoncé/],
    [{ declaredTotal: 1935, fetched: 1000, published: 1000 }, /lecture partielle/],
    [{ complete: true, declaredTotal: null, published: 900, previous: 1942 }, /effondrement/],
    [{ complete: false }, /incomplet/],
    [{ declaredTotal: null }, /ni parcours prouvé, ni total annoncé/],
  ])('refuse %o', (over, motif) => {
    expect(collectionReconfirms(facts(over))).toMatch(motif);
  });
  it('un parcours prouvé complet sans total annoncé est crédible', () => {
    expect(collectionReconfirms(facts({ complete: true, declaredTotal: null }))).toBeNull();
  });
  it('une chute confirmée par l’éditeur (D-484 §2) reste crédible', () => {
    expect(collectionReconfirms(facts({ declaredTotal: 60, fetched: 60, published: 60, previous: 121, confirmedDrop: { previousDeclaredTotal: 122 } }))).toBeNull();
  });
});

describe('reconfirmationVerdict — la garde par source : une collecte ne retire pas la moitié d’un stock', () => {
  it('H&M, 904 manquées sur 2 839 (32 %) : appliqué', () => {
    expect(reconfirmationVerdict({ facts: facts(), stock: 2839, missed: 904 })).toBeNull();
  });
  it('plus de la moitié d’un stock d’au moins 10 : anomalie, rien n’est retenu', () => {
    expect(reconfirmationVerdict({ facts: facts(), stock: 2839, missed: 1500 })).toMatch(/anomalie/);
    expect(reconfirmationVerdict({ facts: facts(), stock: 11, missed: 6 })).toMatch(/anomalie/);
  });
  it('une petite source peut perdre son unique offre', () => {
    expect(reconfirmationVerdict({ facts: facts({ declaredTotal: 2, fetched: 2, published: 2, previous: 3 }), stock: 3, missed: 1 })).toBeNull();
    expect(reconfirmationVerdict({ facts: facts({ declaredTotal: 1, fetched: 1, published: 1, previous: 1 }), stock: 2, missed: 1 })).toBeNull();
  });
});
