import { describe, it, expect } from 'vitest';
import { freezeManifest, manifestHash, verifyManifest, compareTouched, type ManifestEntry } from './refreshManifest.js';

const entry = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  jobSourceId: 'JS1', sourceKey: 'mecca', externalId: 'X1', jobId: 'J1',
  observedAt: '2026-09-01T00:00:00Z', beforeHash: 'a'.repeat(64),
  proof: { kind: 'ENUMERATION', captureBatchId: 'batch-1', hash: 'b'.repeat(64) },
  state: 'ABSENT_FROM_PROVEN_ENUMERATION', consequence: 'JOB_CANDIDATE_FOR_CLOSURE', ...over,
});

describe('manifestHash — l\'empreinte porte sur le PLAN, pas sur son enrobage', () => {
  it('deux plans identiques dans un ORDRE différent ont la même empreinte', () => {
    const a = [entry({ jobSourceId: 'JS1' }), entry({ jobSourceId: 'JS2' })];
    const b = [entry({ jobSourceId: 'JS2' }), entry({ jobSourceId: 'JS1' })];
    expect(manifestHash(['mecca'], a)).toBe(manifestHash(['mecca'], b));
  });

  it('changer une conséquence change l\'empreinte', () => {
    const a = [entry()];
    const b = [entry({ consequence: 'JOB_KEPT_BY_ANOTHER_SOURCE' })];
    expect(manifestHash(['mecca'], a)).not.toBe(manifestHash(['mecca'], b));
  });

  it('changer l\'allowlist change l\'empreinte', () => {
    expect(manifestHash(['mecca'], [entry()])).not.toBe(manifestHash(['mecca', 'autre'], [entry()]));
  });

  /** L'heure de génération n'entre PAS dans l'empreinte : sinon tout manifeste serait unique et le contrôle inutile. */
  it('l\'heure de création n\'affecte pas l\'empreinte', () => {
    const m1 = freezeManifest(['mecca'], [entry()]);
    const m2 = freezeManifest(['mecca'], [entry()]);
    expect(m1.planHash).toBe(m2.planHash);
  });
});

describe('verifyManifest — trois refus, trois incidents réels', () => {

  it('un manifeste intact dont les lignes sont actives est valide', () => {
    expect(verifyManifest(freezeManifest(['mecca'], [entry()]))).toEqual({ valid: true, problems: [] });
  });

  /** Le manifeste a été modifié après signature : on refuse, on ne « rattrape » pas. */
  it('refuse une empreinte qui ne correspond plus au contenu', () => {
    const m = freezeManifest(['mecca'], [entry()]);
    const falsified = { ...m, entries: [...m.entries, entry({ jobSourceId: 'JS2', externalId: 'ajoutée' })] };
    const r = verifyManifest(falsified);
    expect(r.valid).toBe(false);
    expect(r.problems.join(' ')).toMatch(/invalid plan hash/);
  });

  it('refuse un manifeste ancien, corrélé à un run, ou privé de sa preuve', () => {
    const m = freezeManifest(['mecca'], [entry()]);
    expect(verifyManifest({ ...m, version: 1 } as unknown as typeof m).valid).toBe(false);
    expect(verifyManifest({ ...m, version: 3 } as unknown as typeof m).valid).toBe(false);
    expect(verifyManifest(freezeManifest(['mecca'], [entry({ proof: undefined } as unknown as ManifestEntry)])).valid).toBe(false);
    expect(verifyManifest(freezeManifest(['mecca'], [entry({ proof: { kind: 'ENUMERATION', runId: 'run-1', hash: 'b'.repeat(64) } as unknown as ManifestEntry['proof'] })])).valid).toBe(false);
  });

  it('hashes the source proof, observation time, parent state and limits', () => {
    const original = manifestHash(['mecca'], [entry()]);
    for (const change of [
      { observedAt: '2026-09-02T00:00:00Z' }, { beforeHash: 'c'.repeat(64) },
      { proof: { kind: 'ENUMERATION' as const, captureBatchId: 'batch-2', hash: 'b'.repeat(64) } },
    ]) expect(manifestHash(['mecca'], [entry(change)])).not.toBe(original);
    expect(manifestHash(['mecca'], [entry()], { staleHours: 48, maxCloseRatio: 1, minCloseForGuard: 50 })).not.toBe(original);
  });

  it('refuse une ligne dont la source est hors allowlist', () => {
    const m = freezeManifest(['mecca'], [entry({ sourceKey: 'intruse' })]);
    // L'empreinte reste cohérente : c'est bien le PÉRIMÈTRE qui est violé, pas la signature.
    const r = verifyManifest(m);
    expect(r.valid).toBe(false);
    expect(r.problems.join(' ')).toMatch(/outside source scope: intruse/);
  });
});

describe('compareTouched — par ENSEMBLES, jamais par cardinal', () => {
  it('toucher exactement le manifeste est conforme', () => {
    const m = freezeManifest(['mecca'], [entry({ jobSourceId: 'JS1' }), entry({ jobSourceId: 'JS2' })]);
    expect(compareTouched(m, ['JS2', 'JS1'])).toEqual({ equal: true, missing: [], unexpected: [] });
  });

  /**
   * LE SCÉNARIO DANGEREUX : autant de lignes que prévu, mais pas les mêmes. Un contrôle sur les totaux ne
   * verrait rien — d'où la comparaison par ensembles.
   */
  it('même NOMBRE de lignes mais pas les mêmes : détecté', () => {
    const m = freezeManifest(['mecca'], [entry({ jobSourceId: 'JS1' }), entry({ jobSourceId: 'JS2' })]);
    const r = compareTouched(m, ['JS1', 'JS-imprevue']);
    expect(r.equal).toBe(false);
    expect(r.missing).toEqual(['JS2']);
    expect(r.unexpected).toEqual(['JS-imprevue']);
  });

  it('une ligne du manifeste non touchée est signalée', () => {
    const m = freezeManifest(['mecca'], [entry({ jobSourceId: 'JS1' }), entry({ jobSourceId: 'JS2' })]);
    expect(compareTouched(m, ['JS1']).missing).toEqual(['JS2']);
  });

  it('une ligne HORS manifeste touchée est signalée', () => {
    const m = freezeManifest(['mecca'], [entry({ jobSourceId: 'JS1' })]);
    expect(compareTouched(m, ['JS1', 'JS-hors']).unexpected).toEqual(['JS-hors']);
  });
});
