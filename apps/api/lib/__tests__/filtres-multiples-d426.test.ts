import { describe, it, expect } from 'vitest';
import { parseFilters, whereClause } from '../jobs.js';
import { parseCompanyFilters } from '../companies.js';

/**
 * D-426 — les filtres se CUMULENT : l'API doit lire PLUSIEURS valeurs par clé.
 *
 * Le défaut mesuré en production le 14/09/2026, avant d'écrire une ligne :
 * `GET /api/companies?pays=FR&pays=US` rendait **297** Maisons, c'est-à-dire
 * exactement `pays=US` seul (FR seul : 343, US seul : 297). L'union attendue
 * est 511 (343 + 297 = 640 avec les doublons ; 129 Maisons recrutent dans les
 * DEUX pays et ne se comptent qu'une fois). Deux causes superposées, toutes
 * deux côté serveur :
 *
 *   1. `Object.fromEntries(searchParams)` dans la route ne garde qu'une valeur
 *      par clé — la dernière gagne, en silence ;
 *   2. `one(key)` dans les parseurs ne lit que `value[0]` — la première gagne.
 *
 * Les deux se compensaient en apparence (une seule valeur sortait), ce qui
 * rendait le défaut invisible en lisant l'un OU l'autre.
 *
 * Chaque témoin affirme d'abord que sa prémisse exerce le défaut : DEUX
 * valeurs distinctes sur la MÊME clé. Avec une seule valeur, tous passeraient
 * au vert sans jamais toucher le cas qui cassait.
 */
describe('filtres multi-valeurs (D-426)', () => {
  it('lit DEUX pays au lieu de n’en garder qu’un', () => {
    const params = { pays: ['FR', 'IT'] };
    expect(params.pays).toHaveLength(2);
    expect(new Set(params.pays).size).toBe(2);

    expect(parseFilters(params).countries).toEqual(['FR', 'IT']);
  });

  it('lit plusieurs valeurs sur chaque dimension du vocabulaire', () => {
    /*
     * Les clés sont celles que le SITE envoie réellement (`CLE_AMONT` dans
     * api.ts) : `employmentTerm`, `workTime`… et non les clés françaises de
     * l'URL publique (`contrat`, `temps`), que le site traduit avant l'appel.
     * `contrat` reste accepté en entrée pour les liens déjà partagés.
     */
    const f = parseFilters({
      employmentTerm: ['PERMANENT', 'FIXED_TERM'],
      workTime: ['FULL_TIME', 'PART_TIME'],
      metier: ['vendeur', 'styliste'],
      maison: ['Dior', 'Chanel'],
    });
    expect(f.employmentTerms).toEqual(['PERMANENT', 'FIXED_TERM']);
    expect(f.workTimes).toEqual(['FULL_TIME', 'PART_TIME']);
    expect(f.occupations).toEqual(['vendeur', 'styliste']);
    expect(f.maisons).toEqual(['Dior', 'Chanel']);
  });

  it('l’ancienne clé française `contrat` reste acceptée, en multi-valeurs aussi', () => {
    // Des liens partagés portent encore `?contrat=` : ils ne doivent pas
    // devenir muets parce que la clé technique a changé de nom.
    expect(parseFilters({ contrat: ['PERMANENT', 'FIXED_TERM'] }).employmentTerms).toEqual([
      'PERMANENT',
      'FIXED_TERM',
    ]);
    // Et la clé technique garde la priorité quand les deux sont présentes.
    expect(parseFilters({ employmentTerm: ['INTERNSHIP'], contrat: ['PERMANENT'] }).employmentTerms).toEqual([
      'INTERNSHIP',
    ]);
  });

  it('un lien mono-valeur DÉJÀ PARTAGÉ reste lu correctement', () => {
    // Compatibilité ascendante : c'est la forme de tous les liens existants.
    const f = parseFilters({ pays: 'FR', contrat: 'PERMANENT' });
    expect(f.countries).toEqual(['FR']);
    expect(f.employmentTerms).toEqual(['PERMANENT']);
  });

  it('`pays=monde` reste l’équivalent explicite de « tous les pays »', () => {
    expect(parseFilters({ pays: 'monde' }).countries).toBeUndefined();
    // Et il ne contamine pas les autres valeurs quand il est cumulé par erreur.
    expect(parseFilters({ pays: ['monde', 'FR'] }).countries).toEqual(['FR']);
  });

  it('BORNE le nombre de valeurs : une URL publique ne pilote pas un SQL sans plafond', () => {
    const trop = Array.from({ length: 60 }, (_, i) => `P${i}`);
    expect(trop.length).toBeGreaterThan(12);
    expect(parseFilters({ pays: trop }).countries).toHaveLength(12);
  });

  it('borne aussi la LONGUEUR de chaque valeur, pas seulement leur nombre', () => {
    const long = 'a'.repeat(500);
    expect(long.length).toBeGreaterThan(200);
    expect(parseFilters({ maison: [long] }).maisons?.[0]).toHaveLength(200);
  });

  it('dédoublonne et ignore les valeurs vides', () => {
    expect(parseFilters({ pays: ['FR', 'FR', '  ', 'IT'] }).countries).toEqual(['FR', 'IT']);
  });

  it('l’annuaire des Maisons lit lui aussi plusieurs pays et secteurs', () => {
    const params = { pays: ['FR', 'US'], secteur: ['FASHION', 'BEAUTY'] };
    expect(params.pays).toHaveLength(2);

    const f = parseCompanyFilters(params);
    expect(f.countries).toEqual(['FR', 'US']);
    expect(f.sectors).toEqual(['FASHION', 'BEAUTY']);
  });

  it('l’annuaire garde la compatibilité mono-valeur', () => {
    const f = parseCompanyFilters({ pays: 'FR', secteur: 'FASHION' });
    expect(f.countries).toEqual(['FR']);
    expect(f.sectors).toEqual(['FASHION']);
  });
});

/**
 * La traduction en SQL — c'est là que le multi-valeurs se perd sans bruit.
 *
 * Prisma prend un objet littéral : deux clés identiques, et la dernière écrase
 * la première SANS erreur, sans avertissement, sans test rouge. Le filtre
 * disparaît et la liste rend des offres hors périmètre en les présentant comme
 * conformes. Le dépôt portait déjà ce mode de panne une fois (trois filtres
 * `company:` qui s'écrasaient, commenté dans `whereClause`).
 */
describe('les filtres ne s’écrasent pas entre eux en SQL (D-426)', () => {
  it('une recherche TEXTE ne supprime pas les filtres posés', () => {
    // Prémisse : il faut À LA FOIS un mot-clé et un filtre, sinon le témoin
    // n'exerce pas la collision — c'est exactement le cas qui cassait.
    const f = parseFilters({ q: 'vendeuse', pays: ['FR', 'IT'] });
    expect(f.q).toBeTruthy();
    expect(f.countries).toHaveLength(2);

    const w = whereClause(f) as { AND?: unknown[] };
    const serialise = JSON.stringify(w);
    // Le pays doit survivre à la présence du mot-clé.
    expect(serialise).toContain('isFrance');
    // Et le mot-clé doit survivre à la présence du filtre.
    expect(serialise).toContain('vendeuse');
    // Une seule clé AND au niveau racine : deux se seraient écrasées.
    expect(Object.keys(w).filter((k) => k === 'AND')).toHaveLength(1);
  });

  it('deux dimensions de la relation Maison coexistent au lieu de s’écraser', () => {
    const f = parseFilters({ maison: ['Dior', 'Chanel'], groupe: ['LVMH'] });
    expect(f.maisons).toHaveLength(2);
    expect(f.groups).toHaveLength(1);

    const serialise = JSON.stringify(whereClause(f));
    expect(serialise).toContain('Dior');
    expect(serialise).toContain('Chanel');
    // Le groupe ne doit pas avoir été écrasé par la Maison, ni l'inverse.
    expect(serialise).toContain('LVMH');
  });

  it('les valeurs d’une même dimension passent en `in` (union), pas en égalité', () => {
    /*
     * LA PROPRIÉTÉ N'A PAS CHANGÉ, SA POSITION SI.
     *
     * Ce témoin lisait `w.employmentTerm.in` à la RACINE de la clause. Depuis
     * D-436, chaque dimension vit dans le `AND` sous la forme
     * `{ OR: [{ employmentTerm: { in: […] } }, { employmentTerm: null }] }` —
     * les critères inconnus ne font plus disparaître une offre.
     *
     * Deux clés `OR` dans un même littéral s'écrasent : c'est pourquoi elles
     * sont accumulées dans `AND`. Le témoin suit le code, sans rien concéder
     * sur ce qu'il garde — l'UNION des valeurs cochées, jamais une égalité.
     */
    const w = whereClause(parseFilters({ contrat: ['PERMANENT', 'FIXED_TERM'] })) as {
      AND?: Array<{ OR?: Array<{ employmentTerm?: { in?: string[] } | null }> }>;
    };
    const critere = w.AND?.find((c) => c.OR?.some((o) => o.employmentTerm !== undefined));
    expect(critere, 'le critère contrat doit exister dans le AND').toBeDefined();

    const union = critere?.OR?.find((o) => o.employmentTerm && 'in' in o.employmentTerm);
    expect(union?.employmentTerm?.in).toEqual(['PERMANENT', 'FIXED_TERM']);

    // Et la branche qui CONSERVE les offres dont le contrat est inconnu.
    expect(
      critere?.OR?.some((o) => o.employmentTerm === null),
      'une offre au contrat non précisé reste accessible',
    ).toBe(true);
  });

  it('« Métier à préciser » reste sélectionnable : c’est l’ABSENCE de code', () => {
    // D-419 §4 : le CEO a demandé que cette valeur reste visible et cliquable.
    const serialise = JSON.stringify(whereClause(parseFilters({ metier: ['unclassified'] })));
    expect(serialise).toContain('"occupationCode":null');
  });

  it('sans aucun filtre ni mot-clé, la clause ne contraint rien', () => {
    const w = whereClause(parseFilters({})) as { AND?: unknown[]; isActive?: boolean };
    expect(w.isActive).toBe(true);
    expect(w.AND).toEqual([]);
  });
});
