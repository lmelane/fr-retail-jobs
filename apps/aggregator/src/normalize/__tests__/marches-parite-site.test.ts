/** Le site lit ce registre via /api/marches. Une ouverture reste explicite et doit fournir ses catalogues natifs. */
import { describe, it, expect } from 'vitest';
import {
  CODES_MARCHE,
  DIMENSIONS_FACETTE,
  MARCHES,
  facettesDuMarche,
  libelleFacette,
  libelleFacetteServi,
} from '@catwalks/db/marches';

describe('parité des registres de marchés — amont ↔ site', () => {
  const ATTENDUS = [
    'AE', 'AU', 'BE', 'BR', 'CA', 'CH', 'CL', 'CN', 'CZ', 'DE',
    'DK', 'ES', 'FR', 'GB', 'GR', 'HK', 'HU', 'IT', 'JP', 'KR',
    'LU', 'MX', 'MY', 'NL', 'NO', 'NZ', 'PE', 'PH', 'PL', 'PR',
    'PT', 'RO', 'SA', 'SE', 'SG', 'TH', 'TR', 'TW', 'US', 'VN',
    'ZA',
  ] as const;

  it('PRÉMISSE : la liste de référence n’est pas vide et ne contient pas de doublon', () => {
    expect(ATTENDUS.length).toBe(41);
    expect(new Set(ATTENDUS).size, 'aucun doublon dans la référence').toBe(ATTENDUS.length);
  });

  it('LE REGISTRE AMONT PORTE EXACTEMENT LES MARCHÉS ATTENDUS', () => {
    expect([...CODES_MARCHE].sort()).toEqual([...ATTENDUS].sort());
  });

  it('LES MARCHÉS DE LA DIVERGENCE SONT BIEN PRÉSENTS — CA, NL, AU, BE et CN', () => {
    const presents = new Set<string>(CODES_MARCHE);
    for (const [code, offres] of [
      ['CA', 3_129],
      ['NL', 1_849],
      ['AU', 1_234],
      ['CN', 1_224],
      ['BE', 671],
    ] as const) {
      expect(presents.has(code), `${code} (${offres} offres) doit être au registre amont`).toBe(true);
    }
  });

  it('chaque filtre exposé porte un libellé natif', () => {
    for (const code of CODES_MARCHE) for (const dimension of facettesDuMarche(code)) {
      expect(libelleFacetteServi(MARCHES[code], dimension)?.trim()).toBeTruthy();
    }
  });
  it('ne garde aucun libellé de dimension inutilisée', () => {
    for (const code of CODES_MARCHE) for (const d of DIMENSIONS_FACETTE) {
      expect(libelleFacette(code, d) !== undefined).toBe(facettesDuMarche(code).includes(d));
    }
  });
});
