import { describe, expect, it } from 'vitest';
import { ambiguousSources, previewRegistry, validateRegistryPlan, type RegistryEntry, type RegistrySource } from './explicitRegistry.js';

/** D-520 §2 — le registre explicite : aucune source non ACTIVE sans raison, trajectoire ni sortie. */
const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  key: 'alpha', maison: 'Alpha', currentStatus: 'PAUSED', intention: 'COLLECTER', targetStatus: 'PAUSED', trajectory: 'A_REPARER',
  basis: 'PREUVE', decision: 'Aucune décision CEO : pause de la revue du 23/09', reason: 'Lecteur incomplet.', nextAction: 'Réparer le lecteur.',
  reviewAt: '2026-10-09', question: null, ...over,
});
const plan = (...entries: RegistryEntry[]) => ({ kind: 'registre-explicite/1', reviewer: 'test', entries });
const source = (over: Partial<RegistrySource> = {}): RegistrySource => ({
  key: 'alpha', status: 'PAUSED', note: null, statusIntention: null, statusTrajectory: null, statusBasis: null, statusDecision: null,
  statusReason: null, statusNextAction: null, statusQuestion: null, statusReviewAt: null, statusExplainedFor: null, statusReviewId: null,
  activeJobs: 0, ...over,
});

describe('le fichier relu se refuse en nommant chaque défaut', () => {
  it('accepte une entrée complète', () => {
    expect(() => validateRegistryPlan(plan(entry()))).not.toThrow();
  });
  it.each([
    ['une pause sans date de réexamen', { reviewAt: null }, 'a pause needs its review date'],
    ['une exclusion laissée en pause', { trajectory: 'EXCLUE_PAR_DECISION', intention: 'NE_PAS_COLLECTER' }, 'an exclusion is RETIRED, not PAUSED'],
    ['une revue humaine sans question', { trajectory: 'REVUE_HUMAINE', intention: 'A_TRANCHER' }, 'a human review needs its question'],
    ['une trajectoire hors vocabulaire', { trajectory: 'HISTORIQUE' }, 'trajectory HISTORIQUE unknown'],
    ['une réouverture', { targetStatus: 'ACTIVE' }, 'reopening goes through qualification'],
    ['un retrait rouvert en pause', { currentStatus: 'RETIRED', targetStatus: 'PAUSED' }, 'never reopened'],
    ['un retrait qui « revient seul »', { currentStatus: 'RETIRED', targetStatus: 'RETIRED', trajectory: 'REVIENT_SEULE' }, 'never comes back by itself'],
    ['un canal couvert ailleurs qui ne serait pas exclu', { intention: 'COUVERTE_AILLEURS' }, 'COUVERTE_AILLEURS is an exclusion'],
    ['un motif vide', { reason: '  ' }, 'reason missing'],
    ['une décision vide', { decision: '' }, 'decision missing'],
    ['une date impossible', { reviewAt: '2026-02-30' }, 'is not a YYYY-MM-DD day'],
  ] as const)('refuse %s', (_label, over, message) => {
    expect(() => validateRegistryPlan(plan(entry(over as Partial<RegistryEntry>)))).toThrow(message);
  });
  it('refuse une source listée deux fois', () => {
    expect(() => validateRegistryPlan(plan(entry(), entry()))).toThrow('listed twice');
  });
});

describe("l'aperçu confronte le fichier au registre, sans rien écrire", () => {
  it('refuse une source non ACTIVE absente du fichier : le registre doit être complet', () => {
    const preview = previewRegistry(plan(entry()), [source(), source({ key: 'beta', status: 'RETIRED' }), source({ key: 'gamma', status: 'ACTIVE' })]);
    expect(preview.refused).toEqual([{ key: 'beta', code: 'NOT_IN_PLAN', detail: 'RETIRED' }]);
  });
  it('refuse une source inconnue, ACTIVE, ou dont le statut a changé depuis la relecture', () => {
    const preview = previewRegistry(plan(entry(), entry({ key: 'beta' }), entry({ key: 'zeta' })),
      [source({ status: 'RETIRED' }), source({ key: 'beta', status: 'ACTIVE' })]);
    expect(preview.refused.map(r => `${r.key} ${r.code}`)).toEqual(['alpha STATUS_CHANGED', 'beta ACTIVE_SOURCE', 'zeta UNKNOWN_SOURCE']);
  });
  it("liste le retrait d'une pause et ses publications actives", () => {
    const preview = previewRegistry(plan(entry({ targetStatus: 'RETIRED', trajectory: 'EXCLUE_PAR_DECISION', intention: 'NE_PAS_COLLECTER', reviewAt: null })),
      [source({ activeJobs: 7 })]);
    expect(preview.retirements).toEqual([{ key: 'alpha', from: 'PAUSED', activeJobs: 7 }]);
    expect(preview.refused).toEqual([]);
  });
  it("l'empreinte suit l'état lu (une note retouchée la change), pas l'ordre des entrées", () => {
    const sources = [source(), source({ key: 'beta', status: 'RETIRED' })];
    const entries = [entry(), entry({ key: 'beta', currentStatus: 'RETIRED', targetStatus: 'RETIRED', trajectory: 'EXCLUE_PAR_DECISION', intention: 'NE_PAS_COLLECTER', reviewAt: null })];
    const a = previewRegistry(plan(...entries), sources);
    expect(previewRegistry(plan(...[...entries].reverse()), sources).hash).toBe(a.hash);
    expect(previewRegistry(plan(...entries), [source({ note: 'retouchée' }), sources[1]]).hash).not.toBe(a.hash);
    expect(previewRegistry(plan(entries[0], { ...entries[1], reason: 'autre motif' }), sources).hash).not.toBe(a.hash);
  });
});

describe('ambiguousSources : la mesure de D-520 §2, qui doit rendre zéro', () => {
  const explained = { statusReviewId: 'r', statusExplainedFor: 'PAUSED', statusReviewAt: '2026-10-09' } as const;
  it('nomme la source sans explication, celle dont le statut a changé depuis, et la pause dont le réexamen est passé', () => {
    expect(ambiguousSources([
      source({ key: 'sans' }), source({ key: 'perimee', ...explained, status: 'RETIRED' }),
      source({ key: 'echue', ...explained, statusReviewAt: '2026-10-01' }), source({ key: 'claire', ...explained }),
      source({ key: 'active', status: 'ACTIVE' }),
    ], '2026-10-02').map(a => `${a.key} ${a.why}`)).toEqual(['sans UNEXPLAINED', 'perimee STALE_EXPLANATION', 'echue REVIEW_OVERDUE']);
  });
});
