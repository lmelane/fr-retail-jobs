import { describe, expect, it } from 'vitest';
import { KIND_TO_ATS } from './ingest.js';
import { SUPPORTED_ATS_TYPES } from '../ats/index.js';

/**
 * Audit A2 (2026-09-06) : trois sources `icims` ACTIVE (URBN 1 329 + 906,
 * Aéropostale 17) n'ont jamais tourné — l'adaptateur et le dispatch
 * existaient, le kind manquait dans KIND_TO_ATS, et rien ne le disait.
 */
describe('KIND_TO_ATS ↔ adaptateurs', () => {
  it('chaque kind pointe sur un adaptateur dispatché', () => {
    for (const [kind, type] of Object.entries(KIND_TO_ATS)) {
      expect(SUPPORTED_ATS_TYPES, `kind « ${kind} » → ${type} sans adaptateur`).toContain(type);
    }
  });

  it('chaque adaptateur est atteignable par au moins un kind', () => {
    const reachable = new Set(Object.values(KIND_TO_ATS));
    const orphans = SUPPORTED_ATS_TYPES.filter((type) => !reachable.has(type));
    expect(orphans, `adaptateurs sans kind : ${orphans.join(', ')}`).toEqual([]);
  });

  it('icims est planifiable', () => {
    expect(KIND_TO_ATS.icims).toBe('ICIMS');
  });
});
