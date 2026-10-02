import { describe, expect, it } from 'vitest';
import { ageState, CAUSE_CLASSES, CAUSES, computeSourceState, ESCALATION, issueCause, reconcileRun, summarizeStates, summaryLines,
  REPAIR_CEILING_DAYS, SYSTEMIC_OUR_SIDE_BLOCKED, systemFailuresOf, unexplainedCoverageOf, type CollectionOutcome, type SourceState } from './sourceState.js';
import { summarizeOrchestration } from '../lib/runSummary.js';

const H = 3_600_000;
const T0 = new Date('2026-10-01T16:00:00Z');
const at = (hours: number) => new Date(T0.getTime() + hours * H);
const active = (key = 'maison') => ({ key, status: 'ACTIVE', note: null });
const run = (over: Partial<CollectionOutcome> = {}, hours = 0): CollectionOutcome =>
  ({ kind: 'RUN', at: at(hours), runId: 'r', runStatus: 'OK', jobs: 10, issues: [], ...over });

describe('D-520 — vocabulaire fermé', () => {
  it('chaque classe a un libellé, un état de base, une trajectoire et ce qui manque', () => {
    for (const cause of CAUSE_CLASSES) {
      const spec = CAUSES[cause];
      expect(spec.label.length).toBeGreaterThan(5);
      expect(spec.missing.length).toBeGreaterThan(5);
      expect(['AUTO', 'A_REPARER', 'REVUE_HUMAINE', 'DECISION']).toContain(spec.trajectory);
    }
  });

  it('les codes mesurés du 24/09 au 01/10 ont tous une classe (aucun NON_CLASSEE)', () => {
    const observed: Array<[string, string, string?]> = [['UNKNOWN', 'EmployerIdentityReviewRequired'], ['UNKNOWN', 'SOURCE_HEALTH_REGRESSION'],
      ['UNKNOWN', 'ENUMERATION_NOT_PROVEN'], ['UNKNOWN', 'SourceAdmissionGateError'], ['UNKNOWN', 'ENUMERATION_REFUTED'], ['INTERNAL', 'CaptureUnavailableError'],
      ['UNKNOWN', 'HttpStatusError', 'HTTP_403'], ['UNKNOWN', 'SourceAccessGateError'], ['UNKNOWN', 'TRANSPORT_UNABLE_TO_VERIFY_LEAF_SIGNATURE'],
      ['UNKNOWN', 'Error'], ['INTERNAL', 'TypeError'], ['UNKNOWN', 'HttpStatusError', 'HTTP_406'], ['UNKNOWN', 'DESCRIPTION_COVERAGE_BELOW_FLOOR'],
      ['INTERNAL', 'ACCESS_SCOPE'], ['UNKNOWN', 'NATIVE_RETENTION_JUMP'], ['UNKNOWN', 'REJECTED_NATIVE_ROWS'], ['INTERNAL', 'DATABASE_FAILURE']];
    for (const [origin, code, detail] of observed)
      expect(issueCause({ origin: origin as 'UNKNOWN', code, detail }), code).not.toBe('NON_CLASSEE');
  });

  it('un code inconnu est NON_CLASSEE, et la réconciliation passe rouge', () => {
    expect(issueCause({ origin: 'UNKNOWN', code: 'QuelqueChoseDeNeuf' })).toBe('NON_CLASSEE');
    const state = computeSourceState({ source: active(), outcome: run({ runStatus: 'ERROR', jobs: 0, issues: [{ origin: 'UNKNOWN', code: 'QuelqueChoseDeNeuf' }] }), previous: null, now: T0 });
    expect(state.cause).toBe('NON_CLASSEE');
    const verdict = reconcileRun({ states: [state], now: T0, runStartedAt: null, systemFailures: [], unexplainedCoverage: [] });
    expect(verdict.green).toBe(false);
    expect(verdict.reasons[0].reason).toBe('SOURCE_NON_CLASSEE');
  });

  it('le statut HTTP sans détail se lit dans la note (événements d’avant le 30/09)', () => {
    expect(issueCause({ origin: 'UNKNOWN', code: 'HttpStatusError' }, 'HTTP 406 for https://careers.loreal.com')).toBe('ACCES_REFUSE');
    expect(issueCause({ origin: 'UNKNOWN', code: 'HttpStatusError' }, 'HTTP 503 for https://x')).toBe('INDISPONIBILITE_PASSAGERE');
    expect(issueCause({ origin: 'UNKNOWN', code: 'HttpStatusError' }, 'HTTP 404 for https://x')).toBe('LECTEUR');
    expect(issueCause({ origin: 'UNKNOWN', code: 'HttpStatusError' }, null)).toBe('NON_CLASSEE');
  });

  it('une retenue prouvée par la source n’est pas un défaut : la source est NORMALE', () => {
    const issue = { origin: 'SOURCE' as const, code: 'NATIVE_RETENTION', captureBatchId: 'c', completionReportHash: 'h' };
    expect(computeSourceState({ source: active(), outcome: run({ runStatus: 'DEGRADED', issues: [issue] }), previous: null, now: T0 }).state).toBe('NORMALE');
    // Sans sa preuve scellée, la même retenue n'est pas acceptée : sa classe reste à trouver.
    expect(issueCause({ origin: 'SOURCE', code: 'NATIVE_RETENTION' })).toBe('NON_CLASSEE');
  });
});

describe('D-520 — états, trajectoires, échéances', () => {
  it('un délai dépassé est EN_ATTENTE et revient seul ; le RUN suivant réussi le remet NORMALE', () => {
    const first = computeSourceState({ source: active(), outcome: run({ runStatus: 'TIMEOUT', jobs: 0, issues: [{ origin: 'UNKNOWN', code: 'Error' }] }), previous: null, now: T0 });
    expect([first.state, first.cause, first.trajectory]).toEqual(['EN_ATTENTE', 'INDISPONIBILITE_PASSAGERE', 'AUTO']);
    expect(first.deadline?.toISOString()).toBe(at(ESCALATION.waitingHours).toISOString());
    const back = computeSourceState({ source: active(), outcome: run({}, 24), previous: first, now: at(24) });
    expect(back.state).toBe('NORMALE');
  });

  it('EN_ATTENTE au-delà de 48 h passe BLOQUEE, à réparer, et garde son « depuis »', () => {
    const fail = (hours: number) => run({ runStatus: 'ERROR', jobs: 0, issues: [{ origin: 'UNKNOWN', code: 'HttpStatusError', detail: 'HTTP_503' }] }, hours);
    const d0 = computeSourceState({ source: active(), outcome: fail(0), previous: null, now: T0 });
    const d1 = computeSourceState({ source: active(), outcome: fail(24), previous: d0, now: at(24) });
    expect([d1.state, d1.trajectory, d1.attempts]).toEqual(['EN_ATTENTE', 'AUTO', 2]);
    const d2 = computeSourceState({ source: active(), outcome: fail(48), previous: d1, now: at(48) });
    expect([d2.state, d2.trajectory, d2.escalated]).toEqual(['BLOQUEE', 'A_REPARER', true]);
    expect(d2.since.toISOString()).toBe(T0.toISOString());
    expect(d2.missing).toMatch(/^échéance dépassée/);
  });

  it('trois tentatives complètes suffisent à l’escalade ; une passe incrémentale ne compte pas', () => {
    const fail = (kind: CollectionOutcome['kind'], hours: number) => run({ kind, runStatus: 'CHALLENGED', jobs: 0, issues: [{ origin: 'UNKNOWN', code: 'WafChallengeError' }] }, hours);
    let s = computeSourceState({ source: active(), outcome: fail('RUN', 0), previous: null, now: T0 });
    s = computeSourceState({ source: active(), outcome: fail('PASSE', 4), previous: s, now: at(4) });
    s = computeSourceState({ source: active(), outcome: fail('PASSE', 8), previous: s, now: at(8) });
    expect([s.state, s.attempts]).toEqual(['EN_ATTENTE', 1]);
    s = computeSourceState({ source: active(), outcome: fail('VERIFICATION', 9), previous: s, now: at(9) });
    s = computeSourceState({ source: active(), outcome: fail('VERIFICATION', 10), previous: s, now: at(10) });
    expect([s.state, s.trajectory, s.attempts]).toEqual(['BLOQUEE', 'A_REPARER', 3]);
  });

  it('DEGRADEE qui devait revenir seule (refus partiel, la source publie) devient à réparer après 7 jours', () => {
    const issue = { origin: 'UNKNOWN' as const, code: 'HttpStatusError', detail: 'HTTP_403' };
    let s = computeSourceState({ source: active(), outcome: run({ runStatus: 'DEGRADED', issues: [issue] }), previous: null, now: T0 });
    expect([s.state, s.trajectory]).toEqual(['DEGRADEE', 'AUTO']);
    s = computeSourceState({ source: active(), outcome: run({ runStatus: 'DEGRADED', issues: [issue] }, 6 * 24), previous: s, now: at(6 * 24) });
    expect(s.trajectory).toBe('AUTO');
    s = computeSourceState({ source: active(), outcome: run({ runStatus: 'DEGRADED', issues: [issue] }, 7 * 24), previous: s, now: at(7 * 24) });
    expect([s.state, s.trajectory, s.escalated]).toEqual(['DEGRADEE', 'A_REPARER', true]);
  });

  it('un échec connu décidé (D-480) est une trajectoire de décision, sans échéance', () => {
    const s = computeSourceState({ source: active('tapestry'), outcome: run({ runStatus: 'DEGRADED', issues: [{ origin: 'UNKNOWN', code: 'ENUMERATION_REFUTED' }] }), previous: null, now: T0 });
    expect([s.state, s.cause, s.trajectory, s.decision, s.deadline]).toEqual(['DEGRADEE', 'LISTE_NON_PROUVEE', 'DECISION', 'D-480', null]);
    // Le même défaut ailleurs n'est pas décidé.
    expect(computeSourceState({ source: active('autre'), outcome: run({ runStatus: 'DEGRADED', issues: [{ origin: 'UNKNOWN', code: 'ENUMERATION_REFUTED' }] }), previous: null, now: T0 }).trajectory).toBe('AUTO');
  });

  it('un employeur à identifier revient seul, sinon passe en revue humaine à l’échéance', () => {
    const issue = { origin: 'UNKNOWN' as const, code: 'EmployerIdentityReviewRequired' };
    let s = computeSourceState({ source: active(), outcome: run({ runStatus: 'DEGRADED', jobs: 480, issues: [issue] }), previous: null, now: T0 });
    expect([s.state, s.cause, s.trajectory]).toEqual(['DEGRADEE', 'IDENTITE_EMPLOYEUR', 'AUTO']);
    s = computeSourceState({ source: active(), outcome: run({ runStatus: 'DEGRADED', jobs: 480, issues: [issue] }, 7 * 24), previous: s, now: at(7 * 24) });
    expect([s.state, s.trajectory]).toEqual(['DEGRADEE', 'REVUE_HUMAINE']);
    expect(s.missing).toMatch(/^échéance dépassée \(48 h\) : revue d’identité/);
    // Sans aucune offre publiée, la même cause bloque et suit l'échéance courte.
    const none = computeSourceState({ source: active(), outcome: run({ runStatus: 'BROKEN', jobs: 0, issues: [issue] }), previous: null, now: T0 });
    expect([none.state, none.deadline?.toISOString()]).toEqual(['BLOQUEE', at(ESCALATION.waitingHours).toISOString()]);
  });

  it('un échec connu qui ne publie rien est BLOQUEE sur décision, jamais en attente', () => {
    const s = computeSourceState({ source: active('l-oreal-professionnel'),
      outcome: run({ runStatus: 'BROKEN', jobs: 0, issues: [{ origin: 'UNKNOWN', code: 'HttpStatusError', detail: 'HTTP_406' }] }), previous: null, now: T0 });
    // Muet, il contredit la prémisse de D-480 (« elles publient leurs offres ») : à réparer, la décision citée.
    expect([s.state, s.cause, s.trajectory, s.decision]).toEqual(['BLOQUEE', 'ACCES_REFUSE', 'A_REPARER', 'D-480']);
    expect(s.missing).toMatch(/n’a rien publié/);
  });

  it('une passe réussie ne lève rien : ni un refus d’accès constaté au RUN, ni une liste non prouvée', () => {
    const refused = computeSourceState({ source: active(), outcome: run({ runStatus: 'CHALLENGED', jobs: 0, issues: [{ origin: 'UNKNOWN', code: 'WafChallengeError' }] }), previous: null, now: T0 });
    expect(computeSourceState({ source: active(), outcome: run({ kind: 'PASSE' }, 4), previous: refused, now: at(4) })).toMatchObject({ state: 'EN_ATTENTE', cause: 'ACCES_REFUSE' });
    expect(computeSourceState({ source: active(), outcome: run({ kind: 'VERIFICATION' }, 5), previous: refused, now: at(5) }).state).toBe('NORMALE');
    const partial = computeSourceState({ source: active(), outcome: run({ runStatus: 'DEGRADED', issues: [{ origin: 'UNKNOWN', code: 'ENUMERATION_NOT_PROVEN' }] }), previous: null, now: T0 });
    const after = computeSourceState({ source: active(), outcome: run({ kind: 'PASSE' }, 4), previous: partial, now: at(4) });
    expect([after.state, after.cause, after.lastCollectionKind]).toEqual(['EN_ATTENTE', 'LISTE_NON_PROUVEE', 'PASSE']);
  });

  it('régression de volume, liste non prouvée, qualification refusée : en attente un RUN, à réparer au RUN suivant (lecture D-492 « remédiation automatique » §4)', () => {
    for (const [code, jobs] of [['SOURCE_HEALTH_REGRESSION', 40], ['ENUMERATION_NOT_PROVEN', 300], ['SourceAdmissionGateError', 0]] as const) {
      const outcome = (h: number) => run({ runStatus: jobs ? 'DEGRADED' : 'ERROR', jobs, issues: [{ origin: 'UNKNOWN', code }] }, h);
      const first = computeSourceState({ source: active(), outcome: outcome(0), previous: null, now: T0 });
      expect([first.state, first.trajectory], code).toEqual(['EN_ATTENTE', 'AUTO']);
      const second = computeSourceState({ source: active(), outcome: outcome(24), previous: first, now: at(24) });
      // Qui publie reste dit « dégradée » : « bloquée » dirait qu'elle ne publie pas.
      expect([second.state, second.trajectory], code).toEqual([jobs ? 'DEGRADEE' : 'BLOQUEE', 'A_REPARER']);
    }
  });

  it('une reprise dans le même RUN ne compte pas comme une tentative ; si elle échoue encore, la source passe à réparer', () => {
    const fail = (retried: boolean) => run({ runStatus: 'ERROR', jobs: 0, retried, issues: [{ origin: 'UNKNOWN', code: 'TRANSPORT_ECONNRESET' }] });
    const first = computeSourceState({ source: active(), outcome: fail(false), previous: null, now: T0 });
    expect([first.state, first.attempts]).toEqual(['EN_ATTENTE', 1]);
    const again = computeSourceState({ source: active(), outcome: fail(true), previous: first, now: at(0.5) });
    expect([again.state, again.trajectory, again.attempts]).toEqual(['BLOQUEE', 'A_REPARER', 1]);
  });

  it('pause avec motif : EN_PAUSE sur décision ; sans motif : rouge', () => {
    const paused = computeSourceState({ source: { key: 'rl', status: 'PAUSED', note: 'D-516 : 406 Avature, réamorçage' }, outcome: null, previous: null, now: T0 });
    expect([paused.state, paused.cause, paused.trajectory, paused.decision]).toEqual(['EN_PAUSE', 'PAUSE_DECIDEE', 'DECISION', 'D-516']);
    const silent = computeSourceState({ source: { key: 'x', status: 'RETIRED', note: '  ' }, outcome: null, previous: null, now: T0 });
    expect([silent.state, silent.cause, silent.trajectory]).toEqual(['EXCLUE', 'MOTIF_ABSENT', 'A_REPARER']);
    // Une trace de promotion n'est pas un motif (96 notes de ce genre au 02/10) ; une décision datée écrite l'est.
    expect(computeSourceState({ source: { key: 'y', status: 'RETIRED', note: 'promu par validation-volume (4 offres, 4 avec lieu)' }, outcome: null, previous: null, now: T0 }).cause).toBe('MOTIF_ABSENT');
    expect(computeSourceState({ source: { key: 'z', status: 'RETIRED', note: 'User decision 2026-09-08: stop collecting' }, outcome: null, previous: null, now: T0 }).cause).toBe('EXCLUSION_DECIDEE');
    const d39 = computeSourceState({ source: { key: 'w', status: 'RETIRED', note: 'D39 2026-09-06 : couverte par wttj-sector → PAUSED — puis RETIRED' }, outcome: null, previous: null, now: T0 });
    expect([d39.cause, d39.decision]).toEqual(['EXCLUSION_DECIDEE', 'D39']);
    expect(d39.missing).not.toMatch(/[\u2014\u2192]/);
    const verdict = reconcileRun({ states: [paused, silent], now: T0, runStartedAt: null, systemFailures: [], unexplainedCoverage: [] });
    expect(verdict.reasons.map(r => r.reason)).toEqual(['MOTIF_ABSENT']);
  });

  it('une source active absente du RUN est NON_COLLECTEE, à réparer', () => {
    const s = computeSourceState({ source: active(), outcome: null, previous: null, now: T0 });
    expect([s.state, s.cause, s.trajectory]).toEqual(['BLOQUEE', 'NON_COLLECTEE', 'A_REPARER']);
  });
});

describe('D-520 — verdict du RUN = réconciliation', () => {
  const blocked = (key: string, since: Date): SourceState => ({ ...computeSourceState({ source: active(key),
    outcome: run({ runStatus: 'ERROR', jobs: 0, issues: [{ origin: 'INTERNAL', code: 'TypeError' }] }), previous: null, now: since }) });

  it('une source bloquée déjà classée à réparer ne rend pas le RUN rouge', () => {
    const verdict = reconcileRun({ states: [blocked('a', at(-72))], now: T0, runStartedAt: at(-1), systemFailures: [], unexplainedCoverage: [] });
    expect(verdict.green).toBe(true);
  });

  it(`au moins ${SYSTEMIC_OUR_SIDE_BLOCKED} sources laissées bloquées de notre côté par ce RUN, même anciennes : panne du système`, () => {
    // Bloquées depuis trois jours (le même défaut), recollectées en échec par ce RUN : l'ancienneté ne cache pas la panne.
    const states = Array.from({ length: SYSTEMIC_OUR_SIDE_BLOCKED }, (_, i) => blocked(`s${i}`, at(-72)));
    expect(states.every(s => s.since.getTime() < at(-1).getTime())).toBe(true);
    expect(reconcileRun({ states: states.slice(1), now: T0, runStartedAt: at(-1), systemFailures: [], unexplainedCoverage: [] }).green).toBe(true);
    const verdict = reconcileRun({ states, now: T0, runStartedAt: at(-1), systemFailures: [], unexplainedCoverage: [] });
    expect(verdict.reasons.map(r => r.reason)).toEqual(['PANNE_SYSTEME']);
  });

  it('un état temporaire persisté et échu sans escalade est rouge ; vieilli, il est escaladé', () => {
    const waiting = computeSourceState({ source: active(), outcome: run({ runStatus: 'TIMEOUT', jobs: 0, issues: [] }), previous: null, now: T0 });
    const later = at(49);
    expect(reconcileRun({ states: [waiting], now: later, runStartedAt: null, systemFailures: [], unexplainedCoverage: [] }).reasons[0].reason).toBe('ECHEANCE_DEPASSEE');
    const aged = ageState(waiting, later);
    expect([aged.state, aged.trajectory]).toEqual(['BLOQUEE', 'A_REPARER']);
    expect(reconcileRun({ states: [aged], now: later, runStartedAt: null, systemFailures: [], unexplainedCoverage: [] }).green).toBe(true);
  });

  it('une panne du système ou une perte de couverture inexpliquée est rouge', () => {
    expect(reconcileRun({ states: [], now: T0, runStartedAt: null, systemFailures: ['INCOMPLETE_RUN'], unexplainedCoverage: [] }).reasons[0].reason).toBe('PANNE_SYSTEME');
    expect(reconcileRun({ states: [], now: T0, runStartedAt: null, systemFailures: [], unexplainedCoverage: ['MAISON:x'] }).reasons[0].reason).toBe('COUVERTURE_INEXPLIQUEE');
  });

  it(`à réparer depuis plus de ${REPAIR_CEILING_DAYS} jours : le RUN passe rouge (l’état n’a plus de sortie)`, () => {
    const fail = (h: number) => run({ runStatus: 'ERROR', jobs: 0, issues: [{ origin: 'INTERNAL', code: 'TypeError' }] }, h);
    let s = computeSourceState({ source: active('vieille'), outcome: fail(0), previous: null, now: T0 });
    s = computeSourceState({ source: active('vieille'), outcome: fail(REPAIR_CEILING_DAYS * 24), previous: s, now: at(REPAIR_CEILING_DAYS * 24) });
    const verdict = reconcileRun({ states: [s], now: at(REPAIR_CEILING_DAYS * 24), runStartedAt: null, systemFailures: [], unexplainedCoverage: [] });
    expect(verdict.reasons.map(r => r.reason)).toEqual(['ANCIENNETE_DEPASSEE']);
  });

  it('l’épisode court sur la cause : alterner 429 et 403 ne repousse pas l’échéance', () => {
    const fail = (detail: string, h: number) => run({ runStatus: 'ERROR', jobs: 0, issues: [{ origin: 'UNKNOWN', code: 'HttpStatusError', detail }] }, h);
    let s = computeSourceState({ source: active(), outcome: fail('HTTP_429', 0), previous: null, now: T0 });
    s = computeSourceState({ source: active(), outcome: fail('HTTP_403', 24), previous: s, now: at(24) });
    expect([s.cause, s.since.toISOString(), s.attempts]).toEqual(['ACCES_REFUSE', T0.toISOString(), 2]);
    s = computeSourceState({ source: active(), outcome: fail('HTTP_429', 48), previous: s, now: at(48) });
    expect([s.state, s.trajectory]).toEqual(['BLOQUEE', 'A_REPARER']);
  });

  it('la synthèse compte par état et trajectoire, et ne contient aucun tiret cadratin', () => {
    const states = [computeSourceState({ source: active('ok'), outcome: run(), previous: null, now: T0 }), blocked('ko', at(-48)),
      computeSourceState({ source: { key: 'p', status: 'PAUSED', note: 'D-516' }, outcome: null, previous: null, now: T0 })];
    const summary = summarizeStates(states, T0);
    expect(summary.byState).toMatchObject({ NORMALE: 1, BLOQUEE: 1, EN_PAUSE: 1 });
    expect(summary.byTrajectory).toMatchObject({ A_REPARER: 1, DECISION: 1 });
    const lines = summaryLines(summary, reconcileRun({ states, now: T0, runStartedAt: null, systemFailures: [], unexplainedCoverage: [] }));
    expect(lines[0]).toMatch(/^Réconciliation : vert/);
    expect(lines.some(l => l.startsWith('défaut interne de Catwalks (code, base, capture) : 1 (ko)'))).toBe(true);
    expect(lines.some(l => l.startsWith('ko, depuis 2 j : corriger le code'))).toBe(true);
    expect(lines.join('\n')).not.toContain('—');
  });

  it('le RUN du 01/10 rejoué : une identité à revoir rendait le RUN rouge (UNRESOLVED_FAILURE) ; classée, elle ne le rend plus', () => {
    const issue = { origin: 'UNKNOWN' as const, code: 'EmployerIdentityReviewRequired', count: 1 };
    const summary = summarizeOrchestration({ total: 2, ok: 1, failed: 1, timedOut: 0, failures: ['richemont (bloquant : erreurs d’ingestion)'],
      incidents: [], issues: [{ ...issue, source: 'richemont' }] });
    // Prémisse : l'ancien verdict était rouge pour cette seule source.
    expect(summary.executionHealthy).toBe(false);
    expect(summary.blockingReasons).toEqual(['UNRESOLVED_FAILURE']);
    const states = [computeSourceState({ source: active('richemont'), outcome: run({ runStatus: 'DEGRADED', jobs: 486, issues: [issue] }), previous: null, now: T0 }),
      computeSourceState({ source: active('ok'), outcome: run(), previous: null, now: T0 })];
    expect(systemFailuresOf({ blockingReasons: summary.blockingReasons })).toEqual([]);
    expect(reconcileRun({ states, now: T0, runStartedAt: at(-1), systemFailures: systemFailuresOf({ blockingReasons: summary.blockingReasons }), unexplainedCoverage: [] }).green).toBe(true);
  });

  it('un RUN incomplet, un bilan non remis, un état non écrit : panne du système', () => {
    expect(systemFailuresOf({ blockingReasons: ['INCOMPLETE_RUN', 'UNRESOLVED_FAILURE'], alertDeliveryFailed: true, stateFailures: ['x'] }))
      .toEqual(['INCOMPLETE_RUN', 'ALERT_NOT_DELIVERED', 'SOURCE_STATE_NOT_RECORDED']);
    expect(unexplainedCoverageOf([{ scope: 'MAISON', key: 'm', label: 'Dior', cause: 'INEXPLIQUEE', gravity: 'A_REPARER' },
      { scope: 'MAISON', key: 'n', cause: 'COLLECTE', gravity: 'A_REPARER' }, { scope: 'MARCHE', key: 'FR', cause: 'INEXPLIQUEE', gravity: 'INFORMATION' }]))
      .toEqual(['MAISON:Dior']);
  });

  it('le registre explicite fait foi ; une note quelconque n’est jamais lue comme une décision quand le registre est lisible', () => {
    const none = { reviewId: null, explainedFor: null, trajectory: null, decision: null, nextAction: null, reviewAt: null };
    // Registre lisible sans explication : même une note qui cite une décision ne suffit pas (le registre dit « sans explication »).
    for (const note of ['promu par validation-volume (4 offres)', 'D39 2026-09-06 : couverte par wttj-sector', 'User decision 2026-09-08'])
      expect(computeSourceState({ source: { key: 'n', status: 'RETIRED', note, registry: none }, outcome: null, previous: null, now: T0 }).cause, note).toBe('MOTIF_ABSENT');
    const explained = computeSourceState({ source: { key: 'rl', status: 'PAUSED', note: 'promu par validation-volume', registry: { reviewId: 'r1',
      explainedFor: 'PAUSED', trajectory: 'A_REPARER', decision: 'D-516 §1', nextAction: 'enquêter sur le 406 Avature', reviewAt: '2026-10-09' } }, outcome: null, previous: null, now: T0 });
    expect([explained.state, explained.cause, explained.trajectory, explained.decision]).toEqual(['EN_PAUSE', 'PAUSE_DECIDEE', 'A_REPARER', 'D-516 §1']);
    expect(explained.missing).toBe('enquêter sur le 406 Avature ; réexamen le 2026-10-09');
    // Une explication écrite pour un autre statut est périmée.
    expect(computeSourceState({ source: { key: 'x', status: 'RETIRED', note: null, registry: { ...none, reviewId: 'r', explainedFor: 'PAUSED', trajectory: 'DECISION' } },
      outcome: null, previous: null, now: T0 }).cause).toBe('MOTIF_ABSENT');
    // Réexamen passé : le RUN est rouge, sans dupliquer la liste du bulletin.
    expect(reconcileRun({ states: [explained], now: T0, runStartedAt: null, systemFailures: [], unexplainedCoverage: [], registryOverdue: ['rl'] }).reasons.map(r => r.reason))
      .toEqual(['ECHEANCE_DEPASSEE']);
  });
});
