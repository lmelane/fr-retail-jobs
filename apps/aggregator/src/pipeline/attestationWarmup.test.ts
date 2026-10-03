import { describe, expect, it } from 'vitest';
import { ATTESTATION_WARMUP_BY_KIND, attestationFacts, provenStreak } from './attestingCapture.js';
import { sourceEligibility, type EnumerationEvidence } from './refreshPlan.js';

/**
 * D-522 §6 (03/10/2026) : la MISE EN ROUTE des familles nouvellement probantes. Mesuré en lecture seule le 03/10 : au
 * premier refresh où lvmh, wttj-sector et les 41 sources SmartRecruiters attesteraient, 4 445 offres actives, absentes de
 * leur collecte du 02/10 et sans autre source fraîche, fermeraient d'un coup (lvmh 1 640, SmartRecruiters 2 292,
 * wttj-sector 513) sur 91 367 actives : 4,9 % à elles seules, et la garde globale du refresh (`refresh.ts`, plus de 5 % et
 * au moins 50 fermetures) refuse TOUT le refresh dès que les fermetures ordinaires du RUN (54 à 1 512 du 23/09 au 02/10)
 * s'y ajoutent ; le RUN est alors rouge (`REFRESH_REFUSED`). Sans relever la garde, ces familles attendent une ou deux
 * collectes prouvées consécutives AVANT celle qui atteste : le stock se ferme en deux RUN, sous la garde.
 */
const facts = (warmup?: { required: number; provenBefore: number }) => attestationFacts({ sourceKey: 'hm-group',
  captureBatchId: '1e98bc83-2edd-4b0b-9942-95fbfddaf580', startedAt: new Date('2026-10-02T16:30:00Z'),
  metadata: { complete: true, truncated: false, declaredTotal: 1930 }, outputs: 1930,
  counts: { published: 1926, held: 4, writeFailed: 0, skipped: 0 }, unreadableRows: 0, previousPublished: 1931, ...(warmup ? { warmup } : {}) });
const evidence = (termination: string): EnumerationEvidence => ({ sourceKey: 'hm-group', captureBatchId: '1e98bc83-2edd-4b0b-9942-95fbfddaf580',
  termination, canonicalSet: ['a'], canonicalContractDeclared: true, canonicalContractBroken: false, canonicalAbsenceProofUsable: true });

describe('mise en route des familles nouvellement probantes (D-522 §6)', () => {
  it('la première preuve est observée, pas consommée : pas d’attestation tant que la série prouvée est trop courte', () => {
    // Prémisse : sans mise en route, cette collecte atteste.
    expect(facts().canAttestAbsence).toBe(true);
    const pending = facts({ required: 2, provenBefore: 1 });
    expect(pending.canAttestAbsence).toBe(false);
    expect(pending.attestationWarmup).toEqual({ required: 2, provenBefore: 1 });
    const verdict = sourceEligibility(pending, evidence('DECLARED_TOTAL_REACHED'));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/mise en route : 1 collecte\(s\) prouvée\(s\) avant celle-ci sur 2 requises/);
  });
  it('la série atteinte, la collecte atteste, et ses faits restent ceux de toute source', () => {
    const ready = facts({ required: 2, provenBefore: 2 });
    expect(ready.canAttestAbsence).toBe(true);
    expect(ready).not.toHaveProperty('attestationWarmup');
    expect(sourceEligibility(ready, evidence('DECLARED_TOTAL_REACHED')).eligible).toBe(true);
  });
  it('étale le stock : lvmh et WTTJ attendent une collecte prouvée, SmartRecruiters deux ; toute autre famille aucune', () => {
    expect(ATTESTATION_WARMUP_BY_KIND).toEqual({ lvmh_algolia: 1, wttj: 1, 'wttj-sector': 1, 'smartrecruiters-whitelabel': 2 });
    expect(ATTESTATION_WARMUP_BY_KIND.workday).toBeUndefined();
  });
  it('compte la série prouvée depuis la plus récente, et l’arrête au premier manque', () => {
    expect(provenStreak([true, true, false, true])).toBe(2);
    expect(provenStreak([undefined, true])).toBe(0);
    expect(provenStreak([])).toBe(0);
  });
});
