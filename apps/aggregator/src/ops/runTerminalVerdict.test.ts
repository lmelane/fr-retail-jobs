import { describe, it, expect } from 'vitest';
import { capacityVerdict, PROBLEM, type SourceRunFact } from './runTerminalVerdict.js';

/**
 * LE VERDICT TERMINAL — le succès du wrapper ne doit jamais masquer l'échec du travail piloté.
 *
 * Le cas réel qui impose ces tests : `problems: []`, `CODE_SORTIE=0`, « terminé » — et un `PipelineRun`
 * **INTERRUPTED**, tué à 88,8 s d'un run de quinze minutes par un déploiement concurrent. Sans ces gardes, une
 * mesure tronquée entrerait dans une moyenne comme si elle valait les autres.
 */
const ok: SourceRunFact = { sourceKey: 's', status: 'OK', complete: true, truncated: false, errors: 0 };

describe('verdict terminal d\'un passage de capacité', () => {
  it('A. wrapper terminé mais PipelineRun INTERRUPTED → code non nul', () => {
    const v = capacityVerdict({ status: 'INTERRUPTED', runFound: true });
    expect(v.validForCapacity).toBe(false);
    expect(v.exitCode).toBe(1);
    expect(v.problems).toContain(PROBLEM.INTERRUPTED);
    expect(v.invalidatedReason).toBe('INTERRUPTED');
  });

  it('B. commande restaurée avec succès mais run interrompu → code non nul', () => {
    // La restauration de la commande normale est une bonne nouvelle sur la CHAÎNE, pas sur le TRAVAIL.
    const v = capacityVerdict({ status: 'INTERRUPTED', runFound: true, environmentProblems: [] });
    expect(v.exitCode).toBe(1);
  });

  it('C. PipelineRun sain → code zéro', () => {
    const v = capacityVerdict({ status: 'COMPLETED', runFound: true, sourceRuns: [ok] });
    expect(v.validForCapacity).toBe(true);
    expect(v.exitCode).toBe(0);
    expect(v.problems).toEqual([]);
  });

  it('D. PipelineRun introuvable → UNVERIFIABLE, code non nul', () => {
    const v = capacityVerdict({ status: null, runFound: false });
    expect(v.exitCode).toBe(1);
    expect(v.problems).toContain(PROBLEM.NOT_FOUND);
    // Une mesure qu'on ne peut pas rattacher à un run terminé n'est pas une mesure.
    expect(v.pipelineRunStatus).toBeNull();
  });

  it('D bis. run encore RUNNING → non terminal, code non nul', () => {
    const v = capacityVerdict({ status: 'RUNNING', runFound: true });
    expect(v.problems).toContain(PROBLEM.NOT_TERMINAL);
    expect(v.exitCode).toBe(1);
  });

  it('E. SourceRun incomplet dans un benchmark → run non recevable', () => {
    // Le cas réel : knitwell-us-retail et nordstrom arrêtés en route, complete=false.
    const v = capacityVerdict({
      status: 'COMPLETED', runFound: true,
      sourceRuns: [ok, { sourceKey: 'knitwell-us-retail', status: 'DEGRADED', complete: false, truncated: false, errors: 1 }],
    });
    expect(v.validForCapacity).toBe(false);
    expect(v.problems.join(' ')).toContain('knitwell-us-retail');
    expect(v.invalidatedReason).toBe('SOURCE_INCOMPLETE');
  });

  it('E bis. une source tronquée invalide aussi le passage', () => {
    const v = capacityVerdict({
      status: 'COMPLETED', runFound: true,
      sourceRuns: [{ sourceKey: 'x', status: 'OK', complete: true, truncated: true, errors: 0 }],
    });
    expect(v.exitCode).toBe(1);
  });

  it('F. variables résiduelles remontent, même sur un run sain', () => {
    const v = capacityVerdict({
      status: 'COMPLETED', runFound: true, sourceRuns: [ok],
      environmentProblems: ['INGEST_ONLY_KEYS résiduel : mecca'],
    });
    expect(v.exitCode).toBe(1);
    expect(v.problems.join(' ')).toContain('INGEST_ONLY_KEYS');
  });

  it('FAILED → code non nul', () => {
    expect(capacityVerdict({ status: 'FAILED', runFound: true }).problems).toContain(PROBLEM.FAILED);
  });

  it('COMPLETED_WITH_ERRORS n\'est pas une mesure de capacité par défaut', () => {
    const v = capacityVerdict({ status: 'COMPLETED_WITH_ERRORS', runFound: true, sourceRuns: [ok] });
    expect(v.exitCode).toBe(1);
    expect(v.problems).toContain(PROBLEM.WITH_ERRORS);
  });

  it('…sauf politique EXPLICITE qui l\'assume et l\'exclut du corpus', () => {
    const v = capacityVerdict({ status: 'COMPLETED_WITH_ERRORS', runFound: true, sourceRuns: [ok], allowWithErrors: true });
    expect(v.exitCode).toBe(0);
  });

  it('NEW n\'est pas un échec de source', () => {
    // « NEW » signifie « aucun run antérieur », pas « run raté » — erreur déjà commise dans ce lot.
    const v = capacityVerdict({
      status: 'COMPLETED', runFound: true,
      sourceRuns: [{ sourceKey: 'n', status: 'NEW', complete: true, truncated: false, errors: 0 }],
    });
    expect(v.exitCode).toBe(0);
  });

  it('reproduit exactement le run T2 invalidé', () => {
    const v = capacityVerdict({
      status: 'INTERRUPTED', runFound: true,
      sourceRuns: [
        { sourceKey: 'knitwell-us-retail', status: 'DEGRADED', complete: false, truncated: false, errors: 1 },
        { sourceKey: 'nordstrom', status: 'DEGRADED', complete: false, truncated: false, errors: 0 },
      ],
    });
    expect(v.validForCapacity).toBe(false);
    expect(v.invalidatedReason).toBe('INTERRUPTED');
    expect(v.exitCode).toBe(1);
  });
});
