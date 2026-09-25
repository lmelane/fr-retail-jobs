import { describe, expect, it } from 'vitest';
import { CODES_MARCHE, MARCHES, facettesDuMarche, facettesContrat, filtresDuMarche, marche, localeServie, perimetreDeRecherche } from '@catwalks/db/marches';
import { EMPLOYMENT_LABELS, FACET_LABELS, langueDesLibelles } from '@catwalks/db/presentation';

const MARCHES_AVEC_FILTRE_PAYS: ReadonlySet<string> = new Set(['DE', 'GB']);

describe('marché natif et politique des filtres', () => {
  it('conserve les 41 périmètres et les marchés composites validés', () => {
    expect(new Set(CODES_MARCHE).size).toBe(41);
    expect(Object.keys(MARCHES).sort()).toEqual([...CODES_MARCHE].sort());
    expect(marche('GB')?.pays).toEqual(['GB', 'IE']);
    expect(marche('DE')?.pays).toEqual(['DE', 'AT']);
    // D-468 §2 : le marché France sert aussi Monaco.
    expect(marche('FR')?.pays).toEqual(['FR', 'MC']);
    for (const code of CODES_MARCHE.filter((c) => c !== 'GB' && c !== 'DE' && c !== 'FR')) expect(marche(code)?.pays).toEqual([code]);
  });
  it.each(CODES_MARCHE)('%s : locale native, catalogues et filtres complets', (code) => {
    const m = MARCHES[code];
    expect(m.locales).toContain(m.localeParDefaut);
    expect(localeServie(m)).toBe(m.localeParDefaut);
    for (const locale of m.locales) {
      const langue = langueDesLibelles(locale);
      expect(EMPLOYMENT_LABELS[langue]).toBeDefined();
      expect(FACET_LABELS[langue].contrat).not.toBe(FACET_LABELS[langue].temps);
    }
    expect(facettesDuMarche(code)).toEqual(['contrat', 'temps']);
    const perimetre = { code, pays: m.pays, marche: m };
    const filtres = filtresDuMarche(perimetre);
    expect(filtres.filter((f) => ['contrat', 'temps'].includes(f.cle))).toHaveLength(2);
    expect(filtres.find((f) => f.cle === 'programme')).toBeUndefined();
    expect(filtres.find((f) => f.cle === 'metier')).toBeUndefined();
    expect(filtres.every((f) => f.libelle.trim())).toBe(true);
    // Le filtre « pays » est servi aux marchés composites DE et GB (depuis c62a534, 24/09/2026). Le marché France sert
    // aussi Monaco (D-468 §2) SANS ce filtre : exposer un filtre est une décision du CEO, soumise le 25/09/2026. La liste
    // est écrite en toutes lettres : un marché de plusieurs pays n'hérite d'aucun filtre en silence.
    expect(filtres.some((f) => f.cle === 'pays')).toBe(MARCHES_AVEC_FILTRE_PAYS.has(code));
    if (MARCHES_AVEC_FILTRE_PAYS.has(code)) expect(m.pays.length).toBeGreaterThan(1);
  });
  it('le contrat runtime ne transporte plus de mesures historiques', () => {
    for (const m of Object.values(MARCHES)) {
      expect(m).not.toHaveProperty('couverture');
      expect(m).not.toHaveProperty('cardinalite');
      expect(m).not.toHaveProperty('offresMesurees');
    }
  });
  it('normalise les codes sans élargir silencieusement le périmètre', () => {
    expect(marche(' fr ')).toBe(MARCHES.FR);
    for (const input of ['', 'ZZ', 'FR-US', undefined, null, 12, {}, []]) {
      expect(marche(input as string)).toBeUndefined();
      expect(facettesDuMarche(input as string)).toEqual([]);
    }
    expect(perimetreDeRecherche('BG', new Set(['BG']))?.pays).toEqual(['BG']);
    expect(perimetreDeRecherche('ZZ', new Set(['BG']))).toBeUndefined();
  });
  it('CA, CH et BE proposent seulement leurs variantes locales', () => {
    expect(MARCHES.CA.locales).toEqual(['en-CA', 'fr-CA']);
    expect(MARCHES.CH.locales).toEqual(['fr-CH', 'de-CH', 'it-CH']);
    expect(MARCHES.BE.locales).toEqual(['fr-BE', 'nl-BE', 'de-BE', 'en-BE']);
  });
});
