import { describe, expect, it } from 'vitest';
import { evaluateSourceHealth, ZERO_TO_CONFIRM_MIN } from './health.js';
import type { IngestStats } from './ingest.js';
import { issuesFromResult } from '../lib/ingestionIssue.js';
import { computeSourceState, reconcileRun, REPAIR_CEILING_DAYS, SYSTEMIC_OUR_SIDE_BLOCKED, type CollectionOutcome } from './sourceState.js';

/**
 * D-523 (règle du CEO, 03/10/2026) : « le nombre d'offres ne détermine jamais l'état de la source » ; zéro offre est un
 * état normal du marché ; ACTIVE, PAUSED et RETIRED sont des intentions. Un zéro PROUVÉ (total annoncé à 0, liste complète
 * vide) est NORMALE ; un zéro NON PROUVÉ (le lecteur ne voit rien, la source ne dit rien) est un soupçon de lecture, classé
 * « lecteur », qui ne touche ni l'intention ni la cadence. Chaque témoin échoue sur le code d'avant (`ed333f2`) : la liste
 * complète vide y était BROKEN, le zéro non prouvé y était un « volume anormal » sans code propre.
 */
const empty = (over: Partial<IngestStats> = {}): IngestStats => ({ source: 'maison-vide', complete: true, fetched: 0, inSector: 0, france: 0,
  created: 0, merged: 0, updated: 0, errors: 0, withDescription: 0, withDate: 0, withCountry: 0, withUrl: 0, ...over });
const T0 = new Date('2026-10-03T16:30:00Z');
const outcome = (health: ReturnType<typeof evaluateSourceHealth>, stat: IngestStats, at = T0): CollectionOutcome => ({
  kind: 'RUN', at, runId: 'run', runStatus: health.status, jobs: health.jobs, note: health.note,
  issues: issuesFromResult([stat], [health].filter(h => h.status === 'BROKEN' || h.status === 'DEGRADED')) });
const active = (key = 'maison-vide') => ({ key, status: 'ACTIVE', note: null });

describe('D-523 — zéro prouvé : un état normal du marché', () => {
  it('zéro annoncé par l’éditeur, après quelques offres : sain', () => {
    expect(evaluateSourceHealth(empty({ declaredTotal: 0 }), 4)).toMatchObject({ status: 'OK' });
  });

  it.each([null, 0])('liste complète vide sans total, dernier run productif %s : sain, aucun code, NORMALE', before => {
    const stat = empty();
    // Prémisse : ni total annoncé ni erreur ; seule la fin de liste démontrée prouve le zéro.
    expect(stat.declaredTotal).toBeUndefined();
    const health = evaluateSourceHealth(stat, before);
    expect(health).toMatchObject({ status: 'OK' });
    expect(health.finding).toBeUndefined();
    expect(computeSourceState({ source: active(), outcome: outcome(health, stat), previous: null, now: T0 })).toMatchObject({ state: 'NORMALE', cause: null });
  });
});

describe('D-523 — zéro non prouvé : un soupçon de lecture, jamais un volume ni une intention', () => {
  it.each([
    ['liste non démontrée, premier run', empty({ complete: undefined }), null],
    ['liste non démontrée, après des offres', empty({ complete: false, enumerationReading: 'NOT_PROVEN' }), 25],
    ['liste complète vide sans total juste après des offres (distinction impossible)', empty(), 25],
  ] as const)('%s : classé « lecteur », à réparer côté lecteur, jamais une pause', (_, stat, before) => {
    const health = evaluateSourceHealth(stat, before);
    expect(health).toMatchObject({ status: 'BROKEN', finding: 'ZERO_NOT_PROVEN' });
    const state = computeSourceState({ source: active(), outcome: outcome(health, stat), previous: null, now: T0 });
    expect(state).toMatchObject({ state: 'BLOQUEE', cause: 'LECTEUR', trajectory: 'A_REPARER' });
    expect(state.missing).toContain('D-523');
    expect(state.missing).toContain('jamais une pause');
    expect(state.codes).toContain('UNKNOWN/ZERO_NOT_PROVEN');
  });

  it('une collecte qui lit des offres et n’en publie aucune n’est pas un zéro non prouvé (le lecteur a vu des offres)', () => {
    const health = evaluateSourceHealth(empty({ fetched: 3 }), 3);
    expect(health.status).toBe('BROKEN');
    expect(health.finding).not.toBe('ZERO_NOT_PROVEN');
  });

  it(`une source isolée ne rougit pas le RUN ; ${SYSTEMIC_OUR_SIDE_BLOCKED} zéros non prouvés dans le même RUN sont une panne de lecture`, () => {
    const states = Array.from({ length: SYSTEMIC_OUR_SIDE_BLOCKED }, (_, i) => {
      const stat = empty({ source: `vide-${i}`, complete: undefined });
      return computeSourceState({ source: active(`vide-${i}`), outcome: outcome(evaluateSourceHealth(stat, 10), stat), previous: null, now: T0 });
    });
    // Prémisse : chacune est classée « lecteur » (pas de notre côté au sens de la qualification ou du défaut interne).
    expect(states.every(s => s.cause === 'LECTEUR')).toBe(true);
    const runStartedAt = new Date(T0.getTime() - 3_600_000);
    expect(reconcileRun({ states: states.slice(1), now: T0, runStartedAt, systemFailures: [], unexplainedCoverage: [] }).green).toBe(true);
    const verdict = reconcileRun({ states, now: T0, runStartedAt, systemFailures: [], unexplainedCoverage: [] });
    expect(verdict.reasons.map(r => r.reason)).toEqual(['PANNE_SYSTEME']);
    expect(verdict.reasons[0]!.sources).toHaveLength(SYSTEMIC_OUR_SIDE_BLOCKED);
  });

  it('la panne de lecture ne compte que les zéros NOUVEAUX de ce RUN ; un stock ancien garde sa trajectoire sans rougir chaque jour', () => {
    const runStartedAt = new Date(T0.getTime() - 3_600_000);
    const states = Array.from({ length: SYSTEMIC_OUR_SIDE_BLOCKED }, (_, i) => {
      const stat = empty({ source: `ancien-${i}`, complete: undefined });
      const health = evaluateSourceHealth(stat, 10);
      const first = computeSourceState({ source: active(`ancien-${i}`), outcome: outcome(health, stat, new Date(T0.getTime() - 3 * 86_400_000)), previous: null,
        now: new Date(T0.getTime() - 3 * 86_400_000) });
      return computeSourceState({ source: active(`ancien-${i}`), outcome: outcome(health, stat), previous: first, now: T0 });
    });
    // Prémisse : chacune est un zéro non prouvé recollecté par CE RUN, mais ouvert il y a trois jours.
    expect(states.every(s => s.cause === 'LECTEUR' && s.lastCollectionAt!.getTime() >= runStartedAt.getTime() && s.since.getTime() < runStartedAt.getTime())).toBe(true);
    expect(reconcileRun({ states, now: T0, runStartedAt, systemFailures: [], unexplainedCoverage: [] }).green).toBe(true);
  });

  it(`au-delà de ${REPAIR_CEILING_DAYS} jours, le RUN rougit, mais le texte demande le lecteur et la preuve, jamais une pause`, () => {
    const stat = empty({ complete: undefined });
    const health = evaluateSourceHealth(stat, 10);
    const old = new Date(T0.getTime() - (REPAIR_CEILING_DAYS + 1) * 86_400_000);
    const first = computeSourceState({ source: active(), outcome: outcome(health, stat, old), previous: null, now: old });
    const state = computeSourceState({ source: active(), outcome: outcome(health, stat), previous: first, now: T0 });
    const verdict = reconcileRun({ states: [state], now: T0, runStartedAt: new Date(T0.getTime() - 3_600_000), systemFailures: [], unexplainedCoverage: [] });
    expect(verdict.reasons).toHaveLength(1);
    expect(verdict.reasons[0]).toMatchObject({ reason: 'ANCIENNETE_DEPASSEE', sources: ['maison-vide'] });
    expect(verdict.reasons[0]!.detail).toContain('preuve de zéro à établir');
    expect(verdict.reasons[0]!.detail).not.toMatch(/pause|exclusion/);
  });
});

describe('D-523 — la mémoire de la source survit à la purge de SourceRun ; le zéro annoncé après des offres se confirme', () => {
  it('jour 11 : plus aucun run productif dans l’historique, mais des offres en catalogue : la liste complète vide reste non prouvée', () => {
    const health = evaluateSourceHealth(empty(), null, null, null, { activeStock: 7, lastRunDeclaredEmpty: false });
    expect(health).toMatchObject({ status: 'BROKEN', finding: 'ZERO_NOT_PROVEN' });
    expect(health.note).toContain('7 en catalogue');
    // Les offres fermées par un vrai zéro prouvé, plus rien en catalogue : la même lecture est un zéro prouvé.
    expect(evaluateSourceHealth(empty(), null, null, null, { activeStock: 0, lastRunDeclaredEmpty: false })).toMatchObject({ status: 'OK' });
  });

  it(`zéro annoncé après ${ZERO_TO_CONFIRM_MIN} offres : en attente « à confirmer » ; confirmé au RUN suivant : NORMALE`, () => {
    const stat = empty({ declaredTotal: 0 });
    const first = evaluateSourceHealth(stat, ZERO_TO_CONFIRM_MIN, null, null, { activeStock: ZERO_TO_CONFIRM_MIN, lastRunDeclaredEmpty: false });
    expect(first).toMatchObject({ status: 'BROKEN', finding: 'ZERO_ANNOUNCED_TO_CONFIRM' });
    const waiting = computeSourceState({ source: active(), outcome: outcome(first, stat), previous: null, now: T0 });
    expect(waiting).toMatchObject({ state: 'EN_ATTENTE', cause: 'ZERO_A_CONFIRMER', trajectory: 'AUTO' });
    const next = new Date(T0.getTime() + 24 * 3_600_000);
    const confirmed = evaluateSourceHealth(stat, ZERO_TO_CONFIRM_MIN, null, null, { activeStock: ZERO_TO_CONFIRM_MIN, lastRunDeclaredEmpty: true });
    expect(confirmed).toMatchObject({ status: 'OK' });
    expect(computeSourceState({ source: active(), outcome: outcome(confirmed, stat, next), previous: waiting, now: next })).toMatchObject({ state: 'NORMALE' });
    // Non confirmé : la liste suivante est vide sans total, la source passe « lecteur ».
    const unconfirmed = empty();
    const reader = evaluateSourceHealth(unconfirmed, ZERO_TO_CONFIRM_MIN, null, null, { activeStock: ZERO_TO_CONFIRM_MIN, lastRunDeclaredEmpty: true });
    expect(computeSourceState({ source: active(), outcome: outcome(reader, unconfirmed, next), previous: waiting, now: next })).toMatchObject({ cause: 'LECTEUR' });
    // Sous le seuil, aucune attente.
    expect(evaluateSourceHealth(stat, ZERO_TO_CONFIRM_MIN - 1, null, null, { activeStock: 0, lastRunDeclaredEmpty: false })).toMatchObject({ status: 'OK' });
  });
});

