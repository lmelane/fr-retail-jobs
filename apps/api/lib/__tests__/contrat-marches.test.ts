import { describe, expect, it } from 'vitest';
import {
  CLES_FACETTE, CODES_MARCHE, CONTRAT_RECHERCHE_VERSION, DIMENSION_PAR_CLE, LIBELLES_GENERIQUES, MARCHES,
  facettesContrat, facettesDuMarche, perimetreDeRecherche,
} from '@catwalks/db/marches';

/**
 * LE REGISTRE EST LE CONTRAT (lot 6). Le site n'en garde plus de copie : ces
 * témoins gardent donc ce que le site lisait avant dans ses propres listes —
 * périmètres, langues, facettes exposées, libellés — et rougissent si le
 * registre cesse de porter l'une de ces promesses.
 */
describe('le registre décrit chaque marché en entier', () => {
  it('PRÉMISSE : douze marchés, sans doublon, version de contrat posée', () => {
    expect(CODES_MARCHE).toHaveLength(12);
    expect(new Set(CODES_MARCHE).size).toBe(12);
    expect(CONTRAT_RECHERCHE_VERSION).toBe(1);
  });

  it('chaque marché porte un nom natif, un périmètre non vide, ses langues et sa langue par défaut', () => {
    for (const code of CODES_MARCHE) {
      const m = MARCHES[code];
      expect(m.nom.length, code).toBeGreaterThan(0);
      expect(m.pays.length, code).toBeGreaterThan(0);
      expect(m.pays, code).toContain(code);
      expect(m.locales.length, code).toBeGreaterThan(0);
      expect(m.locales, code).toContain(m.localeParDefaut);
      for (const p of m.pays) expect(p, `${code} → ${p}`).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('les périmètres à plusieurs pays sont exactement DE (AT) et GB (IE), et aucun pays n’appartient à deux marchés', () => {
    expect(MARCHES.DE.pays).toEqual(['DE', 'AT']);
    expect(MARCHES.GB.pays).toEqual(['GB', 'IE']);
    const tous = CODES_MARCHE.flatMap((c) => MARCHES[c].pays);
    expect(new Set(tous).size).toBe(tous.length);
  });

  it('les langues attendues : le Canada en anglais d’abord, la Belgique et la Suisse plurilingues, la Chine en zh-CN', () => {
    expect(MARCHES.CA.localeParDefaut).toBe('en-CA');
    expect(MARCHES.CA.locales).toContain('fr-CA');
    expect(MARCHES.BE.locales).toEqual(['fr-BE', 'nl-BE', 'en-GB']);
    expect(MARCHES.CH.locales).toEqual(['fr-CH', 'de-CH', 'it-CH']);
    expect(MARCHES.CN.localeParDefaut).toBe('zh-CN');
    expect(MARCHES.NL.locales).toEqual(['nl-NL', 'en-GB']);
  });

  it('chaque facette servie porte un libellé, natif sur un marché, générique hors marché', () => {
    for (const code of CODES_MARCHE) {
      const contrat = facettesContrat(perimetreDeRecherche(code, new Set([code]))!);
      expect(contrat.length, code).toBeGreaterThan(0);
      for (const f of contrat) {
        expect(f.libelle.trim().length, `${code} ${f.cle}`).toBeGreaterThan(0);
        // D-319 : aucun tiret cadratin dans un libellé, toutes langues confondues.
        expect(f.libelle, `${code} ${f.cle}`).not.toContain('—');
      }
      // Les dimensions mesurées exposées sont exactement celles de `facettesDuMarche`.
      const mesurees = contrat.map((f) => DIMENSION_PAR_CLE[f.cle]).filter(Boolean);
      expect(mesurees, code).toEqual([...facettesDuMarche(code)].sort((a, b) =>
        CLES_FACETTE.findIndex((c) => DIMENSION_PAR_CLE[c] === a) - CLES_FACETTE.findIndex((c) => DIMENSION_PAR_CLE[c] === b)));
    }
    expect(Object.keys(LIBELLES_GENERIQUES).sort()).toEqual([...CLES_FACETTE].sort());
  });

  it('les libellés que le site affichait sont ceux du registre — le Canada dit « Type de poste », le néerlandais et le chinois sont servis', () => {
    const libelle = (code: string, cle: string) => facettesContrat(perimetreDeRecherche(code, new Set())!).find((f) => f.cle === cle)?.libelle;
    expect(libelle('CA', 'contrat')).toBe('Type de poste');
    expect(libelle('CA', 'metier')).toBe('Domaine');
    expect(libelle('NL', 'contrat')).toBe('Dienstverband');
    expect(libelle('NL', 'ville')).toBe('Stad');
    expect(libelle('CN', 'maison')).toBe('品牌');
    expect(libelle('BE', 'temps')).toBe('Temps de travail · Dienstverband');
    expect(libelle('DE', 'secteur')).toBe('Branche');
    expect(libelle('IT', 'langue')).toBe('Lingua');
    // Non servies : le contrat en Suisse (17,2 %), le programme en Allemagne (8,0 %), le contrat aux États-Unis (19,2 %).
    expect(libelle('CH', 'contrat')).toBeUndefined();
    expect(libelle('DE', 'programme')).toBeUndefined();
    expect(libelle('US', 'contrat')).toBeUndefined();
  });

  it('un périmètre hors registre n’existe que pour un pays connu, et sans dimension mesurée', () => {
    const connus = new Set(['JP', 'FR']);
    expect(perimetreDeRecherche('JP', connus)).toEqual({ code: 'JP', pays: ['JP'], marche: undefined });
    expect(perimetreDeRecherche('jp', connus)?.code).toBe('JP');
    expect(perimetreDeRecherche('XQ', connus)).toBeUndefined();
    expect(perimetreDeRecherche('', connus)).toBeUndefined();
    expect(perimetreDeRecherche(undefined, connus)).toBeUndefined();
    expect(perimetreDeRecherche(42 as unknown as string, connus)).toBeUndefined();
    expect(facettesContrat(perimetreDeRecherche('JP', connus)!).map((f) => f.cle)).toEqual(['secteur', 'ville', 'maison', 'groupe', 'langue']);
  });
});
