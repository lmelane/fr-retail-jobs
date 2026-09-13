import { describe, it, expect } from 'vitest';
import {
  evaluateClosureRatio,
  CLOSURE_RATIO_THRESHOLD_PCT,
  type ClosurePlanEntry,
  type OwnerWaiver,
} from '../pipeline/closureRatioPolicy.js';

/**
 * LA GARDE DES 5 %, exercée sur chacun de ses chemins.
 *
 * Elle existe parce que le ratio était affiché sans être lu : un indicateur qu'on prend pour une barrière est
 * pire qu'une absence de barrière, puisqu'on cesse de chercher la protection ailleurs.
 *
 * Les sept cas ci-dessous sont ceux que le propriétaire a imposés. Le septième — « rétablir l'ancien
 * comportement fait échouer les tests » — est celui qui garantit que les six autres mesurent quelque chose.
 */
const entry = (externalId: string, jobId: string, consequence: ClosurePlanEntry['consequence'] = 'JOB_CANDIDATE_FOR_CLOSURE',
  sourceKey = 'american-vintage-dr'): ClosurePlanEntry => ({ sourceKey, externalId, jobId, consequence });

const PLAN_HASH = 'a'.repeat(64);

const waiverFor = (ids: string[], consequences: Record<string, ClosurePlanEntry['consequence']>): OwnerWaiver => ({
  planHash: PLAN_HASH,
  sourceKeys: ['american-vintage-dr'],
  approvedExternalIds: ids,
  approvedConsequences: consequences,
  decisionReference: 'audits/2026-09-09/lot4-world-coverage/p7/bilan-final.md#exception-american-vintage',
});

describe('garde des 5 % — le seuil global', () => {
  it('1. ratio ≤ 5 % sans dérogation : autorisé', () => {
    // 5 fermetures sur 235 = 2,13 % — le ratio réel du cycle 2.
    const entries = Array.from({ length: 5 }, (_, i) => entry(`e${i}`, `j${i}`));
    const v = evaluateClosureRatio(entries, 235, PLAN_HASH, null);
    expect(v.allowed).toBe(true);
    expect(v.ratioPct).toBe(2.13);
    expect(v.waiverApplied).toBe(false);
  });

  it('2. ratio > 5 % sans dérogation : REFUS avant mutation', () => {
    // 18 fermetures sur 248 = 7,26 % — le ratio réel du cycle 1.
    const entries = Array.from({ length: 18 }, (_, i) => entry(`e${i}`, `j${i}`));
    const v = evaluateClosureRatio(entries, 248, PLAN_HASH, null);
    expect(v.allowed).toBe(false);
    expect(v.ratioPct).toBe(7.26);
    expect(v.reasons.join(' ')).toContain('aucune dérogation');
  });

  it('3. ratio > 5 % avec manifeste propriétaire EXACT : autorisé pour ces identifiants seulement', () => {
    const ids = ['4516931', '4522689', '4555473'];
    const entries = ids.map((id, i) => entry(id, `j${i}`));
    const v = evaluateClosureRatio(entries, 37, PLAN_HASH,
      waiverFor(ids, Object.fromEntries(ids.map((id) => [id, 'JOB_CANDIDATE_FOR_CLOSURE' as const]))));
    expect(v.ratioPct).toBeGreaterThan(CLOSURE_RATIO_THRESHOLD_PCT);
    expect(v.allowed).toBe(true);
    expect(v.waiverApplied).toBe(true);
  });

  it('4. manifeste ÉLARGI d\'un identifiant : refus', () => {
    const approved = ['4516931', '4522689', '4555473'];
    const entries = [...approved, '9999999'].map((id, i) => entry(id, `j${i}`));
    const v = evaluateClosureRatio(entries, 37, PLAN_HASH,
      waiverFor(approved, Object.fromEntries(approved.map((id) => [id, 'JOB_CANDIDATE_FOR_CLOSURE' as const]))));
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toContain('9999999');
  });

  /**
   * Note de construction des cas 5a / 5c : la dérogation n'est CONSULTÉE qu'au-dessus du seuil — en dessous,
   * elle est inutile et l'exiger refuserait des opérations conformes. Un plan réduit à une seule fermeture
   * repasse donc sous 5 % et serait autorisé sans jamais regarder la dérogation… ce qui est précisément la
   * manœuvre interdite. On garde donc un dénominateur qui maintient le plan AU-DESSUS du seuil, sans quoi le
   * test ne prouverait rien de la garde.
   */
  it('5a. manifeste RÉDUIT après approbation : refus (fractionner est interdit)', () => {
    const approved = ['4516931', '4522689', '4555473'];
    const entries = [entry('4516931', 'j0')];
    // 1 fermeture sur 10 = 10 % : au-dessus du seuil, la dérogation est donc consultée.
    const v = evaluateClosureRatio(entries, 10, PLAN_HASH,
      waiverFor(approved, Object.fromEntries(approved.map((id) => [id, 'JOB_CANDIDATE_FOR_CLOSURE' as const]))));
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toContain('fractionner');
  });

  it('5b. CONSÉQUENCE modifiée après approbation : refus', () => {
    const ids = ['4516931', '4522689', '4555473'];
    const entries = ids.map((id, i) => entry(id, `j${i}`));
    const consequences: Record<string, ClosurePlanEntry['consequence']> = {
      '4516931': 'JOB_KEPT_BY_ANOTHER_SOURCE', // approuvé comme conservé, présenté comme fermeture
      '4522689': 'JOB_CANDIDATE_FOR_CLOSURE',
      '4555473': 'JOB_CANDIDATE_FOR_CLOSURE',
    };
    const v = evaluateClosureRatio(entries, 37, PLAN_HASH, waiverFor(ids, consequences));
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toContain('conséquence modifiée');
  });

  it('5c. planHash différent (manifeste régénéré) : refus', () => {
    const ids = ['4516931'];
    const entries = [entry('4516931', 'j0')];
    const w = waiverFor(ids, { '4516931': 'JOB_CANDIDATE_FOR_CLOSURE' });
    // Dénominateur 10 : 1 fermeture = 10 %, au-dessus du seuil, donc la dérogation est consultée.
    const v = evaluateClosureRatio(entries, 10, 'b'.repeat(64), w);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toContain('régénéré');
  });

  it('6. JobSource désactivée mais Job conservé : ne compte PAS comme fermeture', () => {
    // Le cas réel d'American Vintage : 6 représentations, 3 fermetures, 3 conservées par wttj-sector.
    const entries: ClosurePlanEntry[] = [
      entry('4516931', 'j1'), entry('4522689', 'j2'), entry('4555473', 'j3'),
      entry('4553457', 'j4', 'JOB_KEPT_BY_ANOTHER_SOURCE'),
      entry('4573163', 'j5', 'JOB_KEPT_BY_ANOTHER_SOURCE'),
      entry('4587897', 'j6', 'JOB_KEPT_BY_ANOTHER_SOURCE'),
    ];
    const v = evaluateClosureRatio(entries, 235, PLAN_HASH, null);
    expect(v.jobClosures).toBe(3);        // pas 6
    expect(v.ratioPct).toBe(1.28);        // 3/235, pas 6/235
    expect(v.allowed).toBe(true);
  });

  it('6b. plusieurs représentations de la MÊME offre ne comptent qu\'une fermeture', () => {
    const entries = [entry('a', 'jobX'), entry('b', 'jobX'), entry('c', 'jobY')];
    expect(evaluateClosureRatio(entries, 100, PLAN_HASH, null).jobClosures).toBe(2);
  });

  it('refuse un dénominateur nul plutôt que de diviser par zéro', () => {
    const v = evaluateClosureRatio([entry('a', 'j1')], 0, PLAN_HASH, null);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toContain('dénominateur');
  });

  it('dérogation sans référence de décision archivée : refus', () => {
    const ids = ['4516931'];
    const w = { ...waiverFor(ids, { '4516931': 'JOB_CANDIDATE_FOR_CLOSURE' as const }), decisionReference: '' };
    const v = evaluateClosureRatio([entry('4516931', 'j0')], 10, PLAN_HASH, w);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toContain('référence de décision');
  });
});
