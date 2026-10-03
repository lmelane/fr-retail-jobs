import { describe, expect, it } from 'vitest';
import { evaluateSourceHealth } from './health.js';
import type { IngestStats } from './ingest.js';
import { issuesFromResult } from '../lib/ingestionIssue.js';
import { computeSourceState, reconcileRun, SYSTEMIC_OUR_SIDE_BLOCKED, type CollectionOutcome } from './sourceState.js';

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
  it('zéro annoncé par l’éditeur, après des offres : sain (prémisse inchangée)', () => {
    expect(evaluateSourceHealth(empty({ declaredTotal: 0 }), 40)).toMatchObject({ status: 'OK' });
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
});
