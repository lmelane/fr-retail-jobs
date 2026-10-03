import { describe, expect, it } from 'vitest';
import { warmupStreak } from './attestingCapture.js';

/**
 * D-522 §6, lecture technique du 03/10/2026 : la mise en route comptait toute collecte antérieure dont le manifeste dit
 * `complete: true`, vérifications manuelles comprises (`runId` nul, `ingest --source`) et sans regarder la terminaison :
 * deux collectes manuelles avant le RUN suffisaient à SmartRecruiters. Ne comptent que les collectes d'un RUN complet
 * (`ingest-all`) terminées par une fin PROBANTE (`PROVING_TERMINATIONS`).
 */
const proven = { complete: true, enumeration: { termination: 'DECLARED_TOTAL_REACHED' } };
describe('la série de mise en route ne compte que les RUN complets terminés par une fin probante', () => {
  it('ignore les collectes manuelles, devant comme entre deux RUN', () => {
    // Prémisse : deux collectes manuelles prouvées, les plus récentes, auraient suffi à la mise en route de 2.
    const earlier = [{ runCommand: null, metadata: proven }, { runCommand: 'ingest', metadata: proven }, { runCommand: 'ingest-all', metadata: { complete: false } }];
    expect(warmupStreak(earlier, 2)).toBe(0);
    expect(warmupStreak([{ runCommand: 'ingest-all', metadata: proven }, { runCommand: 'ingest', metadata: { complete: false } }, { runCommand: 'ingest-all', metadata: proven }], 2)).toBe(2);
  });
  it('une collecte complète à terminaison non probante, ou illisible, arrête la série', () => {
    expect(warmupStreak([{ runCommand: 'ingest-all', metadata: { complete: true, enumeration: { termination: 'EVERY_ORGANIZATION_READ' } } }], 1)).toBe(0);
    expect(warmupStreak([{ runCommand: 'ingest-all', metadata: null }], 1)).toBe(0);
    expect(warmupStreak([{ runCommand: 'ingest-all', metadata: { complete: true, enumeration: { termination: 'ORGANIZATIONS_RECONCILED' } } }], 1)).toBe(1);
  });
});
