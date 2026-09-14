import { describe, it, expect } from 'vitest';
import { decideMode, mayCloseOnAbsence, type SourceEvidence } from './operationalMode.js';
import { isTrustedForAttestation } from '../pipeline/attestation.js';

/**
 * LE REGISTRE ET LE PIPELINE DOIVENT DIRE LA MÊME CHOSE — sinon le registre est une fiction.
 *
 * Un registre qui classe une source `FULL_AUTOMATION` pendant que le refresh lui refuse le droit de fermer
 * n'informe personne : il décrit un régime qui n'existe pas. L'inverse est pire — annoncer `PUBLISH_NO_CLOSE`
 * pendant que le pipeline ferme quand même reviendrait à documenter une garde absente.
 *
 * Ce test relie les deux décisions sur les MÊMES entrées. Il vaut aussi comme rappel de ce qui a été trouvé
 * en P10 : le mécanisme par source n'était pas à construire, il **existait déjà** dans le chemin de clôture
 * (`brokenSourceKeys` ne fait confiance qu'à `canAttestAbsence === true` et récent). Le registre le NOMME et
 * le rend lisible ; il ne le remplace pas.
 *
 * *Deux chemins de décision sur la même question finissent toujours par diverger — c'est exactement ce que
 * D54 a gravé en rendant `resolveCanonicalDimensions` commune à l'ingest et au replay.*
 */
const BASE: SourceEvidence = {
  key: 'exemple', status: 'ACTIVE', hasConfig: true,
  identityVerified: true, identityHashMatchesConfig: true, accessAllowed: true,
  tenantKey: 'workday:exemple', lastRunStatus: 'OK',
  lastRunComplete: true, lastRunCanAttestAbsence: true, lastRunAt: new Date(),
};

/** Ce que le pipeline conclut du même run, par sa propre porte. */
const pipelineMayClose = (e: SourceEvidence) =>
  isTrustedForAttestation({
    status: e.lastRunStatus ?? 'OK',
    complete: e.lastRunComplete ?? undefined,
    fetched: 100, declaredTotal: 100, previousJobs: 100, jobs: 100, truncated: false,
  } as any);

describe('le registre et le pipeline s\'accordent sur le droit de fermer', () => {
  it('énumération prouvée : les DEUX autorisent', () => {
    expect(mayCloseOnAbsence(decideMode(BASE).mode)).toBe(true);
    expect(pipelineMayClose(BASE)).toBe(true);
  });

  it('énumération NON prouvée : les DEUX refusent', () => {
    // Le cas Hugo Boss / Skechers : pagination instable, `complete = false`.
    const e = { ...BASE, lastRunComplete: false };
    expect(mayCloseOnAbsence(decideMode(e).mode)).toBe(false);
    expect(pipelineMayClose(e)).toBe(false);
  });

  it('`complete` inconnu : les DEUX refusent — une absence d\'information n\'autorise rien', () => {
    const e = { ...BASE, lastRunComplete: null };
    expect(mayCloseOnAbsence(decideMode(e).mode)).toBe(false);
    expect(pipelineMayClose(e)).toBe(false);
  });

  it('run en échec : les DEUX refusent', () => {
    for (const status of ['BROKEN', 'ERROR', 'TIMEOUT', 'CHALLENGED']) {
      const e = { ...BASE, lastRunStatus: status, lastRunComplete: false };
      expect(mayCloseOnAbsence(decideMode(e).mode)).toBe(false);
      expect(pipelineMayClose(e)).toBe(false);
    }
  });

  it('aucun mode hors FULL_AUTOMATION n\'autorise une fermeture', () => {
    for (const e of [
      { ...BASE, identityVerified: false },        // EVIDENCE_ONLY
      { ...BASE, lastRunComplete: false },         // PUBLISH_NO_CLOSE
      { ...BASE, status: 'PAUSED' },               // PAUSED_BLOCKED
    ]) expect(mayCloseOnAbsence(decideMode(e).mode)).toBe(false);
  });
});
