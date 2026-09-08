import { describe, expect, it } from 'vitest';
import { resolveCanonicalDimensions, type TrustContext } from './resolve.js';

/**
 * LA CHAÎNE DE DÉCISION, testée une fois pour tous ses appelants.
 *
 * Cette fonction est celle qu'utilisent l'ingest live, le replay offline, le
 * dry-run et ces tests. Il n'y a pas de seconde implémentation : deux
 * résolutions de la priorité finiraient par diverger, et un correctif qui
 * n'existe que dans le backfill est un correctif temporaire (Loïc, 2026-09-08).
 *
 * Invariant visé : à preuves identiques et trust identique,
 * `ingest result == replay result`.
 */

const trustOf = (entries: Record<string, string>): TrustContext => new Map(Object.entries(entries));

describe('resolveCanonicalDimensions', () => {
  /**
   * LE CAS PVH — celui qui a lancé tout le chantier. Le champ déclare
   * FULL_TIME sur 1 372 offres dont 485 disent « Part-Time » dans le titre.
   */
  it('UNTRUSTED : le champ est écarté, le titre explicite décide', () => {
    const r = resolveCanonicalDimensions(
      { sourceKey: 'pvh', title: 'Sales Associate - Part-Time', raw: { employmentType: 'FULL_TIME' } },
      trustOf({ 'pvh employmentType workTime': 'UNTRUSTED' }),
    );
    expect(r.workTime).toBe('PART_TIME');
    expect(r.decisions.workTime?.origin).toBe('TITLE_EXPLICIT');
  });

  it('TRUSTED : le champ structuré gagne contre un titre contradictoire', () => {
    const r = resolveCanonicalDimensions(
      { sourceKey: 's', title: 'Sales Associate - Part-Time', raw: { employmentType: 'FULL_TIME' } },
      trustOf({ 's employmentType workTime': 'TRUSTED' }),
    );
    expect(r.workTime).toBe('FULL_TIME');
    expect(r.decisions.workTime?.origin).toBe('STRUCTURED');
  });

  describe('DEGRADED — la nature de la preuve du titre décide', () => {
    it('un titre EXPLICITE bat un champ dégradé', () => {
      const r = resolveCanonicalDimensions(
        { sourceKey: 's', title: 'Sales Associate - Part-Time', raw: { employmentType: 'FULL_TIME' } },
        trustOf({ 's employmentType workTime': 'DEGRADED' }),
      );
      expect(r.workTime).toBe('PART_TIME');
      expect(r.decisions.workTime?.origin).toBe('TITLE_EXPLICIT');
    });

    /** LE CAS « 21h » : une déduction n'a pas l'autorité d'un mot déclaré. */
    it('une INFÉRENCE ne bat pas un champ dégradé', () => {
      const r = resolveCanonicalDimensions(
        { sourceKey: 's', title: 'Conseiller de vente 21h', raw: { employmentType: 'FULL_TIME' } },
        trustOf({ 's employmentType workTime': 'DEGRADED' }),
      );
      expect(r.workTime).toBe('FULL_TIME');
      expect(r.decisions.workTime?.origin).toBe('STRUCTURED');
    });
  });

  /**
   * RÈGLE ABSOLUE : un triplet sous le seuil ne change JAMAIS, à lui seul, une
   * valeur canonique. Il se comporte exactement comme l'absence de verdict.
   */
  it('INSUFFICIENT_EVIDENCE : comportement par défaut, le champ prime', () => {
    const input = { sourceKey: 's', title: 'Sales Associate - Part-Time', raw: { employmentType: 'FULL_TIME' } };
    const withVerdict = resolveCanonicalDimensions(input, trustOf({ 's employmentType workTime': 'INSUFFICIENT_EVIDENCE' }));
    const withNone = resolveCanonicalDimensions(input, new Map());
    expect(withVerdict.workTime).toBe('FULL_TIME');
    expect(withVerdict.workTime).toBe(withNone.workTime);
    expect(withVerdict.decisions.workTime?.origin).toBe('STRUCTURED');
  });

  /**
   * Cas réel (element-6) : `contract_type: ["CDD", "CDI"]` porte deux durées
   * incompatibles. Prendre « la première » serait un tirage au sort.
   */
  it('AMBIGUOUS_STRUCTURED : aucune valeur arbitraire', () => {
    const r = resolveCanonicalDimensions(
      { sourceKey: 's', title: 'Assistant ADP et Paie', raw: { contract_type: ['CDD', 'CDI'] } },
      new Map(),
    );
    expect(r.employmentTerm).toBeUndefined();
    expect(r.decisions.employmentTerm?.origin).toBe('AMBIGUOUS_STRUCTURED');
  });

  /**
   * Un ingest doit tourner même si la table de confiance n'a jamais été
   * remplie : jamais d'échec, juste le comportement par défaut.
   */
  it('sans trust disponible : repli propre, aucun échec', () => {
    expect(() =>
      resolveCanonicalDimensions({ sourceKey: 's', title: 'Vendeur CDI', raw: { employmentType: 'FULL_TIME' } }),
    ).not.toThrow();
    const r = resolveCanonicalDimensions({ sourceKey: 's', title: 'Vendeur CDI', raw: { employmentType: 'FULL_TIME' } });
    expect(r.employmentTerm).toBe('PERMANENT');
    expect(r.workTime).toBe('FULL_TIME');
  });

  it('sans aucune preuve : toutes les dimensions restent vides', () => {
    const r = resolveCanonicalDimensions({ sourceKey: 's', title: 'Conseiller de vente' });
    expect(r.employmentTerm).toBeUndefined();
    expect(r.workTime).toBeUndefined();
    expect(r.programType).toBeUndefined();
    expect(r.engagementType).toBeUndefined();
  });

  /**
   * `isSeasonal` n'entre dans aucun arbitrage : « CDD » et « saisonnier » sont
   * vrais en même temps. Il suffit qu'une preuve le déclare, même si le champ
   * structuré est par ailleurs UNTRUSTED.
   */
  it('isSeasonal se cumule et n’est jamais arbitré', () => {
    const r = resolveCanonicalDimensions(
      { sourceKey: 's', title: 'Seasonal Retail Associate', contract: 'CDD' },
      trustOf({ 's contract workTime': 'UNTRUSTED' }),
    );
    expect(r.isSeasonal).toBe(true);
    expect(r.employmentTerm).toBe('FIXED_TERM');
  });

  it('le verdict est spécifique à la DIMENSION, pas à la source', () => {
    // Le champ est faux pour le rythme, mais reste bon pour la durée.
    const r = resolveCanonicalDimensions(
      { sourceKey: 'pvh', title: 'Sales Associate - Part-Time', raw: { employmentType: 'fulltime_permanent' } },
      trustOf({ 'pvh employmentType workTime': 'UNTRUSTED' }),
    );
    expect(r.workTime).toBe('PART_TIME');
    expect(r.employmentTerm).toBe('PERMANENT');
    expect(r.decisions.employmentTerm?.origin).toBe('STRUCTURED');
  });

  /** Déterminisme : mêmes entrées, même sortie — l'invariant ingest == replay. */
  it('est déterministe', () => {
    const input = { sourceKey: 'pvh', title: 'Sales Associate - Part-Time', raw: { employmentType: 'FULL_TIME' } };
    const t = trustOf({ 'pvh employmentType workTime': 'UNTRUSTED' });
    expect(resolveCanonicalDimensions(input, t)).toEqual(resolveCanonicalDimensions(input, t));
  });
});
