import { describe, it, expect } from 'vitest';
import { normalizeAdapterResult } from './index.js';
import type { AdapterResult, NormalizedJob } from '../types.js';

/**
 * PREUVE ABSENTE ≠ PREUVE VIDE — la distinction que la détection par `canonical.length > 0` effaçait.
 *
 * Un adaptateur qui DÉCLARE `canonicalIds` mais rend un tableau vide alors qu'il a produit des offres
 * échappait à toute vérification, et sa preuve restait « complète ». Un tableau vide n'est pas une absence de
 * contrat : c'est un contrat ROMPU. La présence se lit donc sur la PROPRIÉTÉ, jamais sur son contenu.
 */
const job = (id: string): NormalizedJob => ({ externalId: id, title: `Poste ${id}`, url: `https://x/${id}` });

const page = (over: Record<string, unknown> = {}) => ({
  url: 'https://x/p1', checkedAt: '2026-09-12T00:00:00Z', sha256: 'h', offset: 0,
  pagination: null, ids: [], publisherCounter: '', componentCounters: [], ...over,
});

const result = (jobs: NormalizedJob[], pageEvidence: any[], over: Partial<AdapterResult> = {}): AdapterResult => ({
  jobs, declaredTotal: jobs.length, complete: true,
  enumeration: { method: 'M', endpoint: 'https://x', pages: 1, rawCount: jobs.length,
    termination: 'DECLARED_TOTAL_REACHED', pageEvidence },
  ...over,
});

describe('normalizeAdapterResult — présence du contrat lue sur la PROPRIÉTÉ', () => {
  /** A. L'adaptateur n'implémente pas encore le contrat : on n'invente aucune preuve, et on ne le punit pas. */
  it('canonicalIds ABSENT : le parcours reste prouvé, mais aucune absence n\'y sera démontrable', () => {
    const r = normalizeAdapterResult(result([job('a'), job('b')], [page({ ids: ['a', 'b'] })]));
    expect(r.complete).toBe(true);
    expect(r.enumeration?.canonicalIdViolations).toBeUndefined();
  });

  /** C. Le cas que la détection par la longueur laissait passer. */
  it('canonicalIds PRÉSENT et VIDE avec 3 offres : contrat ROMPU, preuve réfutée', () => {
    const r = normalizeAdapterResult(result([job('a'), job('b'), job('c')], [page({ canonicalIds: [] })]));
    expect(r.complete).toBe(false);
    expect(r.enumerationVerdict).toBe('REFUTED');
    expect(r.enumeration?.issues).toContain('CANONICAL_ID_CONTRACT_BROKEN');
    expect(r.enumeration?.canonicalIdViolations?.join(' ')).toMatch(/aucun identifiant canonique/);
  });

  /** D. Un board réellement vide, dont la terminaison est démontrée, reste cohérent. */
  it('canonicalIds PRÉSENT et VIDE sur un board réellement vide : cohérent', () => {
    const r = normalizeAdapterResult({
      jobs: [], declaredTotal: 0, complete: true,
      enumeration: { method: 'M', endpoint: 'https://x', pages: 1, rawCount: 0,
        termination: 'FULL_XML_DOCUMENT', pageEvidence: [page({ canonicalIds: [] })] },
    });
    expect(r.enumeration?.issues ?? []).not.toContain('CANONICAL_ID_CONTRACT_BROKEN');
    expect(r.complete).toBe(true);
  });

  /** B/4. Contrat présent et cohérent : rien ne s'oppose à la preuve. */
  it('canonicalIds PRÉSENT et cohérent : preuve conservée', () => {
    const r = normalizeAdapterResult(result([job('a'), job('b')], [page({ ids: ['a', 'b'], canonicalIds: ['a', 'b'] })]));
    expect(r.complete).toBe(true);
    expect(r.enumeration?.canonicalIdViolations).toBeUndefined();
  });

  it('une offre produite absente des identifiants canoniques rompt le contrat', () => {
    const r = normalizeAdapterResult(result([job('a'), job('fantome')], [page({ canonicalIds: ['a'] })]));
    expect(r.complete).toBe(false);
    expect(r.enumeration?.canonicalIdViolations?.join(' ')).toMatch(/fantome/);
  });

  /** Une ligne VUE puis rejetée, dont l'identifiant est connu, est une disposition — pas un trou. */
  it('un identifiant observé rejeté avec son canonicalId ne rompt pas le contrat', () => {
    const r = normalizeAdapterResult(result([job('a')], [page({ canonicalIds: ['a', 'rejetee'] })], {
      rejectedRows: [{ reason: 'MISSING_TITLE_OR_ID', raw: {}, canonicalId: 'rejetee' }],
    }));
    expect(r.enumeration?.canonicalIdViolations).toBeUndefined();
  });

  it('un identifiant observé SANS disposition rompt le contrat', () => {
    const r = normalizeAdapterResult(result([job('a')], [page({ canonicalIds: ['a', 'orpheline'] })]));
    expect(r.complete).toBe(false);
    expect(r.enumeration?.canonicalIdViolations?.join(' ')).toMatch(/orpheline/);
  });
});
