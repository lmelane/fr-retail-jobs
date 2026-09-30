import { describe, expect, it } from 'vitest';
import { BASE_SOURCE_TIMEOUT_MS, MAX_SOURCE_TIMEOUT_MS, expectedVolume, sourceTimeoutFor, sourceTimeoutMs, type SourceVolumeReader } from './sourceTimeout.js';

/*
 * Chronologie mesurée de ulta-jibe au RUN du 28/09/2026 (PipelineEvent, CaptureBatch, SourceObservation ;
 * `scripts/ops/mesures/d482-ulta-jibe-temps.mts`) :
 *  - budget ouvert à 19:32:59 ; requalification d'accès 19:32:59 → 19:37:56 ; capture d'ingestion et écriture de
 *    ses extractions → 19:42:12 (enumeration_observed : 10 053 offres, total déclaré atteint) ;
 *  - écriture des offres 19:42:12 → coupure à 20:12:59 (« cut at 2400s »), dernière observation nouvelle au rang
 *    7 375 à 20:12:18 : ~250 ms par offre ;
 *  - SourceRun des huit jours précédents : 9 992, 10 009, 10 026, 9 996, 10 002 offres ; 0 pour la collecte coupée.
 */
const S = 1000;
const BEFORE_WRITES_MS = (9 * 60 + 13) * S;         // 19:32:59 → 19:42:12
const OFFERS_28_09 = 10_053;
const WRITE_RATE_28_09_MS = (30 * 60 + 47) * S / 7_375; // 30 min 47 écrites pour ~7 375 offres
const NEED_28_09_MS = BEFORE_WRITES_MS + OFFERS_28_09 * WRITE_RATE_28_09_MS;
const RECENT_ULTA = [9_992, 10_009, 10_026, 9_996, 10_002, 0];

describe('Le budget d\'une source suit son volume (ulta-jibe, RUN du 28/09/2026)', () => {
  it('prémisse : le 28/09, ulta-jibe avait besoin d\'environ 51 minutes ; les 40 minutes communes la coupaient', () => {
    expect(BASE_SOURCE_TIMEOUT_MS).toBe(2_400_000);
    expect(WRITE_RATE_28_09_MS).toBeGreaterThan(240); expect(WRITE_RATE_28_09_MS).toBeLessThan(260);
    expect(NEED_28_09_MS / 60_000).toBeGreaterThan(50);
    expect(NEED_28_09_MS).toBeGreaterThan(BASE_SOURCE_TIMEOUT_MS);
  });

  it('avec son volume des huit derniers jours, le budget d\'ulta-jibe couvre le 28/09, soft deadline comprise', () => {
    const budget = sourceTimeoutMs(expectedVolume(RECENT_ULTA));
    expect(budget - 90 * S).toBeGreaterThan(NEED_28_09_MS);
    expect(budget).toBeLessThanOrEqual(MAX_SOURCE_TIMEOUT_MS);
  });

  it('une collecte coupée (0 offre) ne ramène pas le budget du lendemain à la base', () => {
    expect(expectedVolume([0])).toBe(0);
    expect(expectedVolume(RECENT_ULTA)).toBe(10_026);
    expect(expectedVolume([null, undefined, 0, 12])).toBe(12);
  });

  it('une petite source garde presque sa base ; le budget reste borné à deux heures', () => {
    expect(sourceTimeoutMs(0)).toBe(BASE_SOURCE_TIMEOUT_MS);
    expect(sourceTimeoutMs(300)).toBe(BASE_SOURCE_TIMEOUT_MS + 75 * S);
    expect(sourceTimeoutMs(1_000_000)).toBe(MAX_SOURCE_TIMEOUT_MS);
    expect(sourceTimeoutMs(Number.NaN)).toBe(BASE_SOURCE_TIMEOUT_MS);
    expect(sourceTimeoutMs(-5)).toBe(BASE_SOURCE_TIMEOUT_MS);
  });
});

describe('Le budget lu en base survit aux coupures (sourceTimeoutFor, appelé par ingestOrchestrator)', () => {
  /** La base, réduite à ce que le calcul lit : les SourceRun récents et le compte des publications actives. */
  const db = (jobs: number[], active: number) => {
    const asked: unknown[] = [];
    const reader: SourceVolumeReader = {
      sourceRun: { findMany: async (args) => { asked.push(args); return jobs.map(j => ({ jobs: j })); } },
      jobSource: { count: async (args) => { asked.push(args); return active; } },
    };
    return { reader, asked };
  };
  const NOW = Date.parse('2026-09-30T16:00:00Z');

  it('prémisse : huit coupures de suite ne laissent que des zéros dans les SourceRun de la fenêtre', () => {
    expect(expectedVolume(Array(8).fill(0))).toBe(0);
    expect(sourceTimeoutMs(0)).toBe(BASE_SOURCE_TIMEOUT_MS);
  });

  it('ulta-jibe coupée huit jours de suite garde son budget, par ses 10 053 publications restées ouvertes', async () => {
    const { reader, asked } = db(Array(8).fill(0), 10_053);
    expect(await sourceTimeoutFor(reader, 'ulta-jibe', NOW)).toBe(BASE_SOURCE_TIMEOUT_MS + 10_053 * 250);
    expect(asked).toEqual([
      { where: { sourceKey: 'ulta-jibe', ranAt: { gte: new Date(NOW - 8 * 24 * 3_600_000) } }, select: { jobs: true } },
      { where: { sourceKey: 'ulta-jibe', isActive: true } },
    ]);
  });

  it('le plus grand des deux volumes fait le budget ; une petite source reste proche de sa base', async () => {
    expect(await sourceTimeoutFor(db([9_992, 10_026, 0], 9_000).reader, 'ulta-jibe', NOW)).toBe(BASE_SOURCE_TIMEOUT_MS + 10_026 * 250);
    expect(await sourceTimeoutFor(db([40, 42], 41).reader, 'petite', NOW)).toBe(BASE_SOURCE_TIMEOUT_MS + 42 * 250);
  });
});
