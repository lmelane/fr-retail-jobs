import { describe, expect, it } from 'vitest';
import { onlyRequested } from './ingestOrchestrator.js';

/** Run ciblé (décision Loïc, 2026-09-06) : valider un correctif sans attendre 490 sources. */
describe('onlyRequested — INGEST_ONLY_KEYS', () => {
  const keys = ['a', 'hermes', 'kering', 'z'];

  it('sans variable, toutes les clés, dans l’ordre', () => {
    expect(onlyRequested(keys, undefined)).toEqual(keys);
    expect(onlyRequested(keys, '')).toEqual(keys);
  });

  it('avec une liste, seulement ces clés, ordre du run conservé', () => {
    expect(onlyRequested(keys, ' kering, hermes ')).toEqual(['hermes', 'kering']);
  });

  it('une clé inconnue est une erreur nommée, jamais un run vide silencieux', () => {
    expect(() => onlyRequested(keys, 'hermes,inconnue')).toThrow(/inconnue/);
  });
});
