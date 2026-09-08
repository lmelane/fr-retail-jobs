import { describe, expect, it } from 'vitest';
import { checkInvariants, type Invariant } from './postconditions.js';

/**
 * LA LEÇON DU 2026-09-08, transformée en outil.
 *
 * Le dry-run géographie annonçait 18 733 subdivisions et disait vrai sur ce
 * qu'il allait ÉCRIRE. La base, elle, en contenait 703 de fausses — « Outlet »,
 * « Macquarie Centre », Amsterdam à Terre-Neuve. Aucun dry-run ne pouvait les
 * voir : il simulait des écritures, pas l'état résultant.
 *
 * D'où la troisième étape imposée par Loïc :
 *   décision → simulation de l'état final matérialisé → invariants globaux
 *
 * Ce module porte la troisième. Un invariant est une propriété que la base doit
 * vérifier APRÈS coup ; il échoue avec un compte et des exemples, jamais avec
 * un simple booléen — un invariant qui ne dit pas QUI le viole n'aide personne.
 */
describe('checkInvariants', () => {
  const rows = [
    { id: '1', countryCode: 'US', adminArea1: 'California' },
    { id: '2', countryCode: 'AU', adminArea1: 'Outlet' },
    { id: '3', countryCode: 'NL', adminArea1: 'Newfoundland and Labrador' },
    { id: '4', countryCode: 'FR', adminArea1: null },
  ];

  const noSubdivisionOutsideTables: Invariant<(typeof rows)[number]> = {
    name: 'adminArea1 seulement sous un pays dont on a la table',
    violates: (r) => r.adminArea1 !== null && r.countryCode !== 'US' && r.countryCode !== 'CA',
    describe: (r) => `${r.countryCode} → « ${r.adminArea1} »`,
  };

  it('compte les violations et en montre des exemples', () => {
    const [result] = checkInvariants(rows, [noSubdivisionOutsideTables]);
    expect(result.violations).toBe(2);
    expect(result.ok).toBe(false);
    expect(result.samples).toEqual(['AU → « Outlet »', 'NL → « Newfoundland and Labrador »']);
  });

  it('un invariant respecté passe, sans exemple', () => {
    const clean = rows.filter((r) => r.adminArea1 === null || r.countryCode === 'US');
    const [result] = checkInvariants(clean, [noSubdivisionOutsideTables]);
    expect(result.ok).toBe(true);
    expect(result.violations).toBe(0);
    expect(result.samples).toEqual([]);
  });

  /** Un rapport tronqué reste lisible : on borne les exemples, jamais le compte. */
  it('borne les exemples mais jamais le décompte', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: String(i), countryCode: 'AU', adminArea1: 'X' }));
    const [result] = checkInvariants(many, [noSubdivisionOutsideTables], { maxSamples: 3 });
    expect(result.violations).toBe(50);
    expect(result.samples).toHaveLength(3);
  });

  it('évalue tous les invariants en une seule passe', () => {
    const alwaysFails: Invariant<(typeof rows)[number]> = {
      name: 'jamais de pays vide',
      violates: (r) => !r.countryCode,
      describe: (r) => r.id,
    };
    const results = checkInvariants(rows, [noSubdivisionOutsideTables, alwaysFails]);
    expect(results.map((r) => r.name)).toEqual([
      'adminArea1 seulement sous un pays dont on a la table',
      'jamais de pays vide',
    ]);
    expect(results[1].ok).toBe(true);
  });

  it('sans invariant, il n’y a rien à valider', () => {
    expect(checkInvariants(rows, [])).toEqual([]);
  });
});
