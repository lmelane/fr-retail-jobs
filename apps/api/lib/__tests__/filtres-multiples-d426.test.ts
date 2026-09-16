import { describe, it, expect } from 'vitest';
import { parseFilters } from '../jobs.js';
import { parseCompanyFilters } from '../companies.js';

/**
 * D-426 — les filtres se CUMULENT : l'API doit lire PLUSIEURS valeurs par clé.
 *
 * Le défaut mesuré en production le 14/09/2026, avant d'écrire une ligne :
 * `GET /api/companies?pays=FR&pays=US` rendait **297** Maisons, c'est-à-dire
 * exactement `pays=US` seul (FR seul : 343, US seul : 297). Deux causes
 * superposées, toutes deux côté serveur : `Object.fromEntries(searchParams)`
 * dans la route ne garde qu'une valeur par clé, et `one(key)` dans les
 * parseurs ne lit que `value[0]`.
 *
 * Depuis le lot 6, les clés d'URL et les clés du contrat de facettes ne font
 * qu'un (`contrat`, `temps`, `programme`, `metier`…) ; les anciennes clés
 * techniques restent lues pour les liens déjà partagés.
 *
 * Chaque témoin affirme d'abord que sa prémisse exerce le défaut : DEUX
 * valeurs distinctes sur la MÊME clé.
 */
describe('filtres multi-valeurs (D-426)', () => {
  it('lit DEUX pays au lieu de n’en garder qu’un', () => {
    const params = { pays: ['FR', 'IT'] };
    expect(params.pays).toHaveLength(2);
    expect(new Set(params.pays).size).toBe(2);

    expect(parseFilters(params).filtres.pays).toEqual(['FR', 'IT']);
  });

  it('lit plusieurs valeurs sur chaque dimension du contrat', () => {
    const f = parseFilters({
      contrat: ['PERMANENT', 'FIXED_TERM'],
      temps: ['FULL_TIME', 'PART_TIME'],
      metier: ['vendeur', 'styliste'],
      maison: ['Dior', 'Chanel'],
    });
    expect(f.filtres).toEqual({
      contrat: ['PERMANENT', 'FIXED_TERM'],
      temps: ['FULL_TIME', 'PART_TIME'],
      metier: ['vendeur', 'styliste'],
      maison: ['Dior', 'Chanel'],
    });
  });

  it('les anciennes clés techniques restent acceptées, en multi-valeurs aussi', () => {
    // Des liens partagés portent encore `employmentTerm=` : ils ne doivent pas
    // devenir muets parce que la clé d'URL a changé de nom.
    expect(parseFilters({ employmentTerm: ['PERMANENT', 'FIXED_TERM'] }).filtres.contrat).toEqual(['PERMANENT', 'FIXED_TERM']);
    expect(parseFilters({ workTime: ['PART_TIME'] }).filtres.temps).toEqual(['PART_TIME']);
    expect(parseFilters({ programType: ['INTERNSHIP'] }).filtres.programme).toEqual(['INTERNSHIP']);
    // Et la clé du contrat garde la priorité quand les deux sont présentes.
    expect(parseFilters({ contrat: ['INTERNSHIP'], employmentTerm: ['PERMANENT'] }).filtres.contrat).toEqual(['INTERNSHIP']);
  });

  it('un lien mono-valeur DÉJÀ PARTAGÉ reste lu correctement', () => {
    const f = parseFilters({ pays: 'fr', contrat: 'PERMANENT' });
    expect(f.filtres.pays).toEqual(['FR']);
    expect(f.filtres.contrat).toEqual(['PERMANENT']);
  });

  it('`pays=monde` ne restreint rien et ne devient jamais un pays fantôme', () => {
    expect(parseFilters({ pays: 'monde' }).filtres.pays).toBeUndefined();
    expect(parseFilters({ pays: ['monde', 'FR'] }).filtres.pays).toEqual(['FR']);
  });

  it('BORNE le nombre de valeurs : une URL publique ne pilote pas un SQL sans plafond', () => {
    const trop = Array.from({ length: 60 }, (_, i) => `P${i}`);
    expect(trop.length).toBeGreaterThan(12);
    expect(parseFilters({ pays: trop }).filtres.pays).toHaveLength(12);
  });

  it('borne aussi la LONGUEUR de chaque valeur, pas seulement leur nombre', () => {
    const long = 'a'.repeat(500);
    expect(long.length).toBeGreaterThan(200);
    expect(parseFilters({ maison: [long] }).filtres.maison?.[0]).toHaveLength(200);
  });

  it('dédoublonne et ignore les valeurs vides', () => {
    expect(parseFilters({ pays: ['FR', 'FR', '  ', 'IT'] }).filtres.pays).toEqual(['FR', 'IT']);
  });

  it('le marché voyage avec les filtres, sous ses deux noms', () => {
    expect(parseFilters({ marche: 'US' }).marche).toBe('US');
    expect(parseFilters({ market: 'FR' }).marche).toBe('FR');
    expect(parseFilters({}).marche).toBeUndefined();
  });

  it('l’annuaire des Maisons lit lui aussi plusieurs pays et secteurs, et son marché', () => {
    const params = { pays: ['FR', 'US'], secteur: ['FASHION', 'BEAUTY'], marche: 'FR' };
    expect(params.pays).toHaveLength(2);

    const f = parseCompanyFilters(params);
    expect(f.pays).toEqual(['FR', 'US']);
    expect(f.secteur).toEqual(['FASHION', 'BEAUTY']);
    expect(f.marche).toBe('FR');
  });

  it('l’annuaire garde la compatibilité mono-valeur', () => {
    const f = parseCompanyFilters({ pays: 'FR', secteur: 'FASHION' });
    expect(f.pays).toEqual(['FR']);
    expect(f.secteur).toEqual(['FASHION']);
  });
});
