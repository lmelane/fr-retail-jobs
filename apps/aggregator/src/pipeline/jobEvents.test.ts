import { describe, expect, it } from 'vitest';
import {
  changedEvents, diffStructuralFields, toEventRow, toNestedEventRow, truncateEventValue, EVENT_VALUE_MAX_LENGTH,
} from './jobEvents.js';

/**
 * Un événement `CHANGED` n'existe que pour un champ structurant dont la
 * valeur change vraiment : la ré-attestation touche 70 000 lignes par nuit,
 * un « touché » par ligne noierait l'histoire sous du bruit.
 */
describe('diffStructuralFields', () => {
  it('ne relève que les champs structurants dont la valeur diffère', () => {
    const before = { title: 'Vendeur', city: 'Paris', country: 'FR', companyId: 'c1', jobFunction: null };
    const after = { title: 'Sales Advisor', city: 'Paris', country: 'FR', companyId: 'c1', jobFunction: 'retail-client-advisor' };
    expect(diffStructuralFields(before, after)).toEqual([
      { field: 'title', before: 'Vendeur', after: 'Sales Advisor' },
      { field: 'jobFunction', before: null, after: 'retail-client-advisor' },
    ]);
  });

  it('un champ absent de `after` est inchangé, pas effacé', () => {
    const before = { title: 'Vendeur', city: 'Paris', country: 'FR', companyId: 'c1', jobFunction: 'finance' };
    expect(diffStructuralFields(before, { title: 'Vendeur' })).toEqual([]);
    expect(diffStructuralFields(before, { city: undefined })).toEqual([]);
  });

  it('`null` dans `after` est un vrai effacement', () => {
    expect(diffStructuralFields({ city: 'Paris' }, { city: null })).toEqual([
      { field: 'city', before: 'Paris', after: null },
    ]);
  });

  it('ignore les champs non structurants (description, dates, salaire)', () => {
    const before = { title: 'Vendeur', description: 'court', salaryMin: 1 } as Record<string, unknown>;
    const after = { title: 'Vendeur', description: 'long', salaryMin: 2 } as Record<string, unknown>;
    expect(diffStructuralFields(before, after)).toEqual([]);
  });

  it('tronque avant/après à 200 caractères', () => {
    const long = 'x'.repeat(500);
    const [change] = diffStructuralFields({ title: 'a' }, { title: long });
    expect(change.after).toHaveLength(EVENT_VALUE_MAX_LENGTH);
    expect(truncateEventValue(long)).toHaveLength(200);
    expect(truncateEventValue(null)).toBeNull();
    expect(truncateEventValue(undefined)).toBeNull();
    expect(truncateEventValue('court')).toBe('court');
  });

  it('changedEvents produit un événement CHANGED par changement, daté', () => {
    const at = new Date('2026-09-06T10:00:00Z');
    const events = changedEvents('j1', [{ field: 'country', before: 'France', after: 'FR' }], at);
    expect(events).toEqual([{ jobId: 'j1', type: 'CHANGED', field: 'country', before: 'France', after: 'FR', at }]);
  });

  it('la ligne imbriquée (createMany sous job.update) ne porte pas jobId ; la ligne complète, si', () => {
    const at = new Date('2026-09-06T10:00:00Z');
    const event = { jobId: 'j1', type: 'REOPENED' as const, at };
    expect(toNestedEventRow(event)).toEqual({ type: 'REOPENED', field: null, before: null, after: null, at });
    expect('jobId' in toNestedEventRow(event)).toBe(false);
    expect(toEventRow(event)).toEqual({ jobId: 'j1', type: 'REOPENED', field: null, before: null, after: null, at });
  });
});
