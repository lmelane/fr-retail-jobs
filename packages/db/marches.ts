/** Contrat des marchés : périmètres, locales et facettes.
 * Les mesures historiques décrivent le corpus à leur date de relevé ; elles ne
 * prouvent ni la pertinence produit des filtres ni la traduction du site.
 * Une politique `facettesEmploi` explicite prime sur ces mesures.
 */
export const SEUIL_AFFICHAGE_FACETTE = 0.2;

export const SEUIL_FACETTE_DENSE = 0.9;

export const PLANCHER_FACETTE_DENSE = 0.77;

export const CODES_MARCHE_LOCALISES = ['US', 'FR', 'GB', 'CA', 'DE', 'IT', 'ES', 'NL', 'AU', 'CH', 'BE', 'CN'] as const;

export const MARCHES_ROUTABLES = [
  { code: 'JP', nom: '日本', localeNative: 'ja-JP', offresMesurees: 552, couverture: { contrat: 0.3632, temps: 0.7547, programme: 0.0236, saisonnier: 0, metier: 0.2594 }, cardinalite: { contrat: 3, temps: 2, programme: 1, saisonnier: 0, metier: 13 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'] },
  { code: 'KR', nom: '대한민국', localeNative: 'ko-KR', offresMesurees: 527, couverture: { contrat: 0.3586, temps: 0.9343, programme: 0.0152, saisonnier: 0, metier: 0.3485 }, cardinalite: { contrat: 2, temps: 2, programme: 1, saisonnier: 0, metier: 10 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe'] },
  { code: 'PT', nom: 'Portugal', localeNative: 'pt-PT', offresMesurees: 525, couverture: { contrat: 0.375, temps: 0.8, programme: 0.0393, saisonnier: 0, metier: 0.225 }, cardinalite: { contrat: 3, temps: 2, programme: 3, saisonnier: 0, metier: 12 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'] },
  { code: 'MX', nom: 'México', localeNative: 'es-MX', offresMesurees: 461, couverture: { contrat: 0.4663, temps: 0.6114, programme: 0.0104, saisonnier: 0, metier: 0.4404 }, cardinalite: { contrat: 2, temps: 2, programme: 1, saisonnier: 0, metier: 8 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'] },
  { code: 'SG', nom: 'Singapore', localeNative: 'en-SG', offresMesurees: 435, couverture: { contrat: 0.4144, temps: 0.8694, programme: 0.3063, saisonnier: 0, metier: 0.2523 }, cardinalite: { contrat: 2, temps: 2, programme: 1, saisonnier: 0, metier: 20 }, facettesSite: ['secteur', 'maison', 'groupe'] },
  { code: 'DK', nom: 'Danmark', localeNative: 'da-DK', offresMesurees: 386, couverture: { contrat: 0.0593, temps: 0.072, programme: 0.0212, saisonnier: 0, metier: 0.1356 }, cardinalite: { contrat: 2, temps: 2, programme: 1, saisonnier: 0, metier: 9 }, facettesSite: ['secteur', 'ville', 'maison', 'langue'] },
  { code: 'HK', nom: '香港', localeNative: 'zh-HK', offresMesurees: 378, couverture: { contrat: 0.3182, temps: 0.7348, programme: 0.0455, saisonnier: 0, metier: 0.2879 }, cardinalite: { contrat: 3, temps: 2, programme: 2, saisonnier: 0, metier: 11 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe'] },
  { code: 'PL', nom: 'Polska', localeNative: 'pl-PL', offresMesurees: 361, couverture: { contrat: 0.2193, temps: 0.614, programme: 0.0351, saisonnier: 0.0088, metier: 0.0877 }, cardinalite: { contrat: 2, temps: 2, programme: 1, saisonnier: 1, metier: 6 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'] },
  { code: 'SE', nom: 'Sverige', localeNative: 'sv-SE', offresMesurees: 328, couverture: { contrat: 0.127, temps: 0.2381, programme: 0.0476, saisonnier: 0, metier: 0.2381 }, cardinalite: { contrat: 3, temps: 2, programme: 1, saisonnier: 0, metier: 8 }, facettesSite: ['secteur', 'ville', 'maison'] },
  { code: 'CL', nom: 'Chile', localeNative: 'es-CL', offresMesurees: 314, couverture: { contrat: 0.0064, temps: 0.0385, programme: 0.0064, saisonnier: 0, metier: 0.8462 }, cardinalite: { contrat: 1, temps: 2, programme: 1, saisonnier: 0, metier: 2 }, facettesSite: ['secteur', 'ville', 'maison', 'langue'] },
  { code: 'TR', nom: 'Türkiye', localeNative: 'tr-TR', offresMesurees: 307, couverture: { contrat: 0.2667, temps: 0.4667, programme: 0, saisonnier: 0, metier: 0.3 }, cardinalite: { contrat: 1, temps: 1, programme: 0, saisonnier: 0, metier: 6 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'] },
  { code: 'TH', nom: 'ประเทศไทย', localeNative: 'th-TH', offresMesurees: 276, couverture: { contrat: 0.4048, temps: 0.9286, programme: 0.0238, saisonnier: 0, metier: 0.3571 }, cardinalite: { contrat: 1, temps: 1, programme: 1, saisonnier: 0, metier: 5 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe'] },
  { code: 'MY', nom: 'Malaysia', localeNative: 'ms-MY', offresMesurees: 266, couverture: { contrat: 0.2683, temps: 0.8415, programme: 0.1341, saisonnier: 0, metier: 0.2805 }, cardinalite: { contrat: 2, temps: 2, programme: 1, saisonnier: 0, metier: 7 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe'] },
  { code: 'AE', nom: 'الإمارات العربية المتحدة', localeNative: 'ar-AE', offresMesurees: 247, couverture: { contrat: 0.25, temps: 0.5585, programme: 0.0957, saisonnier: 0, metier: 0.2713 }, cardinalite: { contrat: 2, temps: 2, programme: 3, saisonnier: 0, metier: 14 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'] },
  { code: 'NO', nom: 'Norge', localeNative: 'nb-NO', offresMesurees: 239, couverture: { contrat: 0.0577, temps: 0.1058, programme: 0, saisonnier: 0.0192, metier: 0.0865 }, cardinalite: { contrat: 2, temps: 2, programme: 0, saisonnier: 1, metier: 2 }, facettesSite: ['secteur', 'ville', 'maison'] },
  { code: 'TW', nom: '臺灣', localeNative: 'zh-TW', offresMesurees: 224, couverture: { contrat: 0.2642, temps: 0.8113, programme: 0, saisonnier: 0, metier: 0.3585 }, cardinalite: { contrat: 1, temps: 1, programme: 0, saisonnier: 0, metier: 8 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe'] },
  { code: 'BR', nom: 'Brasil', localeNative: 'pt-BR', offresMesurees: 201, couverture: { contrat: 0.5882, temps: 0.5735, programme: 0.0147, saisonnier: 0, metier: 0.1765 }, cardinalite: { contrat: 1, temps: 2, programme: 1, saisonnier: 0, metier: 2 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'] },
  { code: 'GR', nom: 'Ελλάδα', localeNative: 'el-GR', offresMesurees: 182, couverture: { contrat: 0.1368, temps: 0.4017, programme: 0, saisonnier: 0, metier: 0.6239 }, cardinalite: { contrat: 2, temps: 2, programme: 0, saisonnier: 0, metier: 3 }, facettesSite: ['secteur', 'ville', 'maison', 'langue'] },
  { code: 'ZA', nom: 'South Africa', localeNative: 'en-ZA', offresMesurees: 167, couverture: { contrat: 0.087, temps: 0.6522, programme: 0, saisonnier: 0, metier: 0.1739 }, cardinalite: { contrat: 2, temps: 2, programme: 0, saisonnier: 0, metier: 3 }, facettesSite: ['secteur', 'ville', 'maison'] },
  { code: 'VN', nom: 'Việt Nam', localeNative: 'vi-VN', offresMesurees: 163, couverture: { contrat: 0.24, temps: 0.58, programme: 0, saisonnier: 0, metier: 0.14 }, cardinalite: { contrat: 1, temps: 1, programme: 0, saisonnier: 0, metier: 6 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'] },
  { code: 'CZ', nom: 'Česko', localeNative: 'cs-CZ', offresMesurees: 158, couverture: { contrat: 0.1176, temps: 0.5294, programme: 0, saisonnier: 0, metier: 0.1765 }, cardinalite: { contrat: 1, temps: 2, programme: 0, saisonnier: 0, metier: 2 }, facettesSite: ['secteur', 'ville', 'maison', 'langue'] },
  { code: 'PE', nom: 'Perú', localeNative: 'es-PE', offresMesurees: 154, couverture: { contrat: 0, temps: 0.5294, programme: 0.0196, saisonnier: 0, metier: 0.7843 }, cardinalite: { contrat: 0, temps: 2, programme: 1, saisonnier: 0, metier: 2 }, facettesSite: ['secteur', 'ville', 'maison', 'langue'] },
  { code: 'NZ', nom: 'New Zealand', localeNative: 'en-NZ', offresMesurees: 153, couverture: { contrat: 0.1443, temps: 0.4948, programme: 0.1237, saisonnier: 0.2887, metier: 0.2371 }, cardinalite: { contrat: 2, temps: 2, programme: 1, saisonnier: 1, metier: 5 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe'] },
  { code: 'HU', nom: 'Magyarország', localeNative: 'hu-HU', offresMesurees: 123, couverture: { contrat: 0.2381, temps: 0.7619, programme: 0, saisonnier: 0, metier: 0.3333 }, cardinalite: { contrat: 2, temps: 2, programme: 0, saisonnier: 0, metier: 6 }, facettesSite: ['secteur', 'maison', 'groupe', 'langue'] },
  { code: 'SA', nom: 'المملكة العربية السعودية', localeNative: 'ar-SA', offresMesurees: 114, couverture: { contrat: 0.2537, temps: 0.4776, programme: 0.0896, saisonnier: 0, metier: 0.2985 }, cardinalite: { contrat: 2, temps: 2, programme: 1, saisonnier: 0, metier: 5 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe'] },
  { code: 'RO', nom: 'România', localeNative: 'ro-RO', offresMesurees: 107, couverture: { contrat: 0.5263, temps: 0.6316, programme: 0, saisonnier: 0, metier: 0.5526 }, cardinalite: { contrat: 1, temps: 2, programme: 0, saisonnier: 0, metier: 5 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'] },
  { code: 'PR', nom: 'Puerto Rico', localeNative: 'es-PR', offresMesurees: 72, couverture: { contrat: 0.7097, temps: 0.8871, programme: 0, saisonnier: 0.0484, metier: 0.2097 }, cardinalite: { contrat: 2, temps: 1, programme: 0, saisonnier: 1, metier: 4 }, facettesSite: ['secteur', 'ville', 'maison', 'langue'] },
  { code: 'PH', nom: 'Philippines', localeNative: 'en-PH', offresMesurees: 58, couverture: { contrat: 0.5455, temps: 1, programme: 0, saisonnier: 0, metier: 0.4545 }, cardinalite: { contrat: 1, temps: 1, programme: 0, saisonnier: 0, metier: 3 }, facettesSite: ['secteur', 'ville', 'maison'] },
  { code: 'LU', nom: 'Luxembourg', localeNative: 'fr-LU', offresMesurees: 55, couverture: { contrat: 0.8333, temps: 0.9167, programme: 0.0417, saisonnier: 0.0417, metier: 0.4583 }, cardinalite: { contrat: 2, temps: 2, programme: 1, saisonnier: 1, metier: 3 }, facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'] },
] as const;

export const CODES_MARCHE = [
  ...CODES_MARCHE_LOCALISES,
  ...MARCHES_ROUTABLES.map((m) => m.code),
] as const;
export type CodeMarche = (typeof CODES_MARCHE)[number];

export const DIMENSIONS_FACETTE = [
  'contrat',
  'temps',
  'programme',
  'saisonnier',
  'metier',
] as const;
export type DimensionFacette = (typeof DIMENSIONS_FACETTE)[number];

export type CouvertureMesuree = Readonly<Record<DimensionFacette, number>>;

export type CardinaliteMesuree = Readonly<Record<DimensionFacette, number>>;
export const CARDINALITE_MINIMALE = 2;

export const CONTRAT_RECHERCHE_VERSION = 2;

export const CLES_FACETTE = ['pays', 'metier', 'secteur', 'contrat', 'temps', 'programme', 'ville', 'maison', 'groupe', 'langue'] as const;
export type CleFacette = (typeof CLES_FACETTE)[number];

export const CLES_FACETTE_SITE = ['pays', 'secteur', 'ville', 'maison', 'groupe', 'langue'] as const;
export type CleFacetteSite = (typeof CLES_FACETTE_SITE)[number];

export const DIMENSION_PAR_CLE: Readonly<Partial<Record<CleFacette, DimensionFacette>>> = {
  contrat: 'contrat',
  temps: 'temps',
  programme: 'programme',
  metier: 'metier',
};

export type Marche = {
  readonly facettesEmploi?: readonly DimensionFacette[];
  readonly contratUnifie?: boolean;
  readonly code: CodeMarche;
  readonly nom: string;
  readonly pays: readonly string[];
  readonly locales: readonly string[];
  readonly localeParDefaut: string;
  readonly localisation: 'NATIVE' | 'FALLBACK';
  readonly localeDeRepli?: string;
  readonly typesFiltres?: Readonly<Partial<Record<CleFacette, TypeFiltre>>>;
  readonly cardinalite?: CardinaliteMesuree;
  readonly facettesSite: readonly CleFacetteSite[];
  readonly libellesSite: Readonly<Record<CleFacetteSite, string>>;
  readonly libelles: Readonly<Partial<Record<DimensionFacette, string>>>;
  readonly offresMesurees: number;
  readonly couverture: CouvertureMesuree;
};

const MARCHES_LOCALISES: Readonly<Record<(typeof CODES_MARCHE_LOCALISES)[number], Marche>> = {
  US: {
    code: 'US',
    nom: 'United States',
    pays: ['US'],
    locales: ['en-US', 'es-US'],
    localeParDefaut: 'en-US',
    localisation: 'NATIVE',
    facettesSite: ['secteur', 'ville', 'maison', 'langue'],
    libellesSite: { pays: 'Country', secteur: 'Sector', ville: 'City', maison: 'Maison', groupe: 'Group', langue: 'Language' },
    libelles: { temps: 'Job type', metier: 'Job category' },
    offresMesurees: 36_942,
    couverture: { contrat: 0.1793, temps: 0.8582, programme: 0.0034, saisonnier: 0.0776, metier: 0.5991 },
    cardinalite: { contrat: 3, temps: 2, programme: 4, saisonnier: 1, metier: 47 },
  },

  FR: {
    code: 'FR',
    facettesEmploi: ['contrat', 'temps'],
    contratUnifie: true,
    nom: 'France',
    pays: ['FR'],
    locales: ['fr-FR'],
    localeParDefaut: 'fr-FR',
    localisation: 'NATIVE',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'],
    libellesSite: { pays: 'Pays', secteur: 'Secteur', ville: 'Ville', maison: 'Maison', groupe: 'Groupe', langue: 'Langue' },
    libelles: {
      contrat: 'Type de contrat',
      temps: 'Temps de travail',
    },
    offresMesurees: 11_026,
    couverture: { contrat: 0.6146, temps: 0.7383, programme: 0.3041, saisonnier: 0.0023, metier: 0.4176 },
    cardinalite: { contrat: 3, temps: 2, programme: 3, saisonnier: 1, metier: 40 },
  },

  GB: {
    code: 'GB',
    nom: 'United Kingdom',
    pays: ['GB', 'IE'],
    locales: ['en-GB'],
    localeParDefaut: 'en-GB',
    localisation: 'NATIVE',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue', 'pays'],
    libellesSite: { pays: 'Country', secteur: 'Sector', ville: 'City', maison: 'Maison', groupe: 'Group', langue: 'Language' },
    libelles: {
      contrat: 'Job type',
      temps: 'Job type',
      metier: 'Job category',
    },
    offresMesurees: 3_305,
    couverture: { contrat: 0.3186, temps: 0.4619, programme: 0.0143, saisonnier: 0.0342, metier: 0.3806 },
    cardinalite: { contrat: 6, temps: 4, programme: 3, saisonnier: 1, metier: 42 },
  },

  CA: {
    code: 'CA',
    nom: 'Canada',
    pays: ['CA'],
    locales: ['en-CA', 'fr-CA'],
    localeParDefaut: 'en-CA',
    localisation: 'NATIVE',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue', 'pays'],
    libellesSite: { pays: 'Pays', secteur: 'Secteur', ville: 'Ville', maison: 'Maison', groupe: 'Groupe', langue: 'Langue' },
    libelles: {
      contrat: 'Type de poste',
      temps: 'Type de poste',
      metier: 'Domaine',
    },
    offresMesurees: 3_129,
    couverture: { contrat: 0.4123, temps: 0.7879, programme: 0.023, saisonnier: 0.2305, metier: 0.405 },
    cardinalite: { contrat: 2, temps: 2, programme: 1, saisonnier: 1, metier: 18 },
  },

  DE: {
    code: 'DE',
    nom: 'Deutschland',
    pays: ['DE', 'AT'],
    locales: ['de-DE'],
    localeParDefaut: 'de-DE',
    localisation: 'NATIVE',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue', 'pays'],
    libellesSite: { pays: 'Land', secteur: 'Branche', ville: 'Stadt', maison: 'Haus', groupe: 'Gruppe', langue: 'Sprache' },
    libelles: {
      contrat: 'Anstellungsart',
      temps: 'Arbeitszeit',
      metier: 'Berufsfeld',
    },
    offresMesurees: 3_080,
    couverture: { contrat: 0.5601, temps: 0.6976, programme: 0.0974, saisonnier: 0.0091, metier: 0.4663 },
    cardinalite: { contrat: 5, temps: 4, programme: 4, saisonnier: 2, metier: 30 },
  },

  IT: {
    code: 'IT',
    nom: 'Italia',
    pays: ['IT'],
    locales: ['it-IT'],
    localeParDefaut: 'it-IT',
    localisation: 'NATIVE',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'],
    libellesSite: { pays: 'Paese', secteur: 'Settore', ville: 'Città', maison: 'Maison', groupe: 'Gruppo', langue: 'Lingua' },
    libelles: {
      contrat: 'Tipo di contratto',
      temps: 'Orario di lavoro',
      metier: 'Categoria',
    },
    offresMesurees: 2_693,
    couverture: { contrat: 0.4809, temps: 0.7462, programme: 0.1506, saisonnier: 0.0046, metier: 0.5879 },
    cardinalite: { contrat: 2, temps: 2, programme: 3, saisonnier: 1, metier: 19 },
  },

  ES: {
    code: 'ES',
    nom: 'España',
    pays: ['ES'],
    locales: ['es-ES'],
    localeParDefaut: 'es-ES',
    localisation: 'NATIVE',
    facettesSite: ['secteur', 'ville', 'maison', 'langue'],
    libellesSite: { pays: 'País', secteur: 'Sector', ville: 'Ciudad', maison: 'Maison', groupe: 'Grupo', langue: 'Idioma' },
    libelles: {
      contrat: 'Tipo de empleo',
      temps: 'Jornada laboral',
      metier: 'Categoría',
    },
    offresMesurees: 2_197,
    couverture: { contrat: 0.2775, temps: 0.4275, programme: 0.0779, saisonnier: 0, metier: 0.4012 },
    cardinalite: { contrat: 3, temps: 2, programme: 3, saisonnier: 0, metier: 23 },
  },

  NL: {
    code: 'NL',
    nom: 'Nederland',
    pays: ['NL'],
    locales: ['nl-NL'],
    localeParDefaut: 'nl-NL',
    localisation: 'NATIVE',
    facettesSite: ['secteur', 'ville', 'maison', 'langue'],
    libellesSite: { pays: 'Land', secteur: 'Sector', ville: 'Stad', maison: 'Maison', groupe: 'Groep', langue: 'Taal' },
    libelles: {
      contrat: 'Dienstverband',
      temps: 'Dienstverband',
      metier: 'Vakgebied',
    },
    offresMesurees: 1_849,
    couverture: { contrat: 0.5374, temps: 0.6811, programme: 0.0654, saisonnier: 0.0023, metier: 0.3294 },
    cardinalite: { contrat: 2, temps: 2, programme: 1, saisonnier: 1, metier: 26 },
  },

  AU: {
    code: 'AU',
    nom: 'Australia',
    pays: ['AU'],
    locales: ['en-AU'],
    localeParDefaut: 'en-AU',
    localisation: 'NATIVE',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe'],
    libellesSite: { pays: 'Country', secteur: 'Sector', ville: 'City', maison: 'Maison', groupe: 'Group', langue: 'Language' },
    libelles: {
      contrat: 'Job type',
      temps: 'Job type',
      metier: 'Job category',
    },
    offresMesurees: 1_234,
    couverture: { contrat: 0.1512, temps: 0.5321, programme: 0.117, saisonnier: 0.2967, metier: 0.1912 },
    cardinalite: { contrat: 2, temps: 2, programme: 2, saisonnier: 1, metier: 13 },
  },

  CH: {
    code: 'CH',
    nom: 'Suisse · Schweiz',
    pays: ['CH'],
    locales: ['fr-CH', 'de-CH', 'it-CH'],
    localeParDefaut: 'fr-CH',
    localisation: 'NATIVE',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'],
    libellesSite: { pays: 'Pays', secteur: 'Secteur', ville: 'Ville', maison: 'Maison', groupe: 'Groupe', langue: 'Langue' },
    libelles: {
      contrat: 'Type de contrat',
      temps: 'Temps de travail',
      programme: 'Type de programme',
      metier: 'Métier',
    },
    offresMesurees: 1_220,
    couverture: { contrat: 0.1854, temps: 0.6312, programme: 0.1953, saisonnier: 0.0059, metier: 0.2406 },
    cardinalite: { contrat: 3, temps: 2, programme: 2, saisonnier: 1, metier: 18 },
  },

  BE: {
    code: 'BE',
    nom: 'Belgique · België',
    pays: ['BE'],
    locales: ['fr-BE', 'nl-BE', 'de-BE', 'en-BE'],
    localeParDefaut: 'fr-BE',
    localisation: 'NATIVE',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue', 'pays'],
    libellesSite: {
      pays: 'Pays · Land',
      secteur: 'Secteur · Sector',
      ville: 'Ville · Stad',
      maison: 'Maison · Huis',
      groupe: 'Groupe · Groep',
      langue: 'Langue · Taal',
    },
    libelles: {
      contrat: 'Type de contrat · Contracttype',
      temps: 'Temps de travail · Dienstverband',
      programme: 'Type de programme · Type programma',
      metier: 'Métier · Vakgebied',
    },
    offresMesurees: 671,
    couverture: { contrat: 0.4811, temps: 0.805, programme: 0.2704, saisonnier: 0.0063, metier: 0.3962 },
    cardinalite: { contrat: 2, temps: 2, programme: 2, saisonnier: 1, metier: 12 },
  },

  CN: {
    code: 'CN',
    nom: '中国',
    pays: ['CN'],
    locales: ['zh-CN'],
    localeParDefaut: 'zh-CN',
    localisation: 'NATIVE',
    facettesSite: ['secteur', 'ville', 'maison', 'groupe', 'langue'],
    libellesSite: { pays: '国家', secteur: '行业', ville: '城市', maison: '品牌', groupe: '集团', langue: '语言' },
    libelles: {
      metier: '职位类别',
      contrat: '雇佣类型',
    },
    offresMesurees: 1_224,
    couverture: { contrat: 0.5431, temps: 0.9502, programme: 0.2017, saisonnier: 0, metier: 0.3135 },
    cardinalite: { contrat: 2, temps: 1, programme: 1, saisonnier: 0, metier: 14 },
  },
};

export const LIBELLES_GENERIQUES: Readonly<Record<CleFacette, string>> = {
  pays: 'Pays',
  metier: 'Métier',
  secteur: 'Secteur',
  contrat: 'Type de contrat',
  temps: 'Temps de travail',
  programme: 'Type de programme',
  ville: 'Ville',
  maison: 'Maison',
  groupe: 'Groupe',
  langue: 'Langue',
};

export function marcheEnRepli(params: {
  code: string;
  nom: string;
  localeNative: string;
  localeDeRepli?: string;
  offresMesurees: number;
  couverture?: CouvertureMesuree;
  cardinalite?: CardinaliteMesuree;
  facettesSite?: readonly CleFacetteSite[];
}): Marche {
  const repli = params.localeDeRepli ?? 'en-GB';
  return {
    code: params.code as CodeMarche,
    nom: params.nom,
    pays: [params.code],
    locales: [params.localeNative],
    localeParDefaut: params.localeNative,
    localisation: 'FALLBACK',
    localeDeRepli: repli,
    facettesSite: params.facettesSite ?? ['secteur', 'ville', 'maison', 'groupe', 'langue'],
    libellesSite: {
      pays: LIBELLES_GENERIQUES.pays, secteur: LIBELLES_GENERIQUES.secteur, ville: LIBELLES_GENERIQUES.ville,
      maison: LIBELLES_GENERIQUES.maison, groupe: LIBELLES_GENERIQUES.groupe, langue: LIBELLES_GENERIQUES.langue,
    },
    libelles: {},
    offresMesurees: params.offresMesurees,
    couverture: params.couverture ?? (Object.fromEntries(DIMENSIONS_FACETTE.map((d) => [d, 0])) as CouvertureMesuree),
    cardinalite: params.cardinalite,
  };
}

export const MARCHES: Readonly<Record<CodeMarche, Marche>> = {
  ...Object.fromEntries(
    MARCHES_ROUTABLES.map((m) => [
      m.code,
      marcheEnRepli({ code: m.code, nom: m.nom, localeNative: m.localeNative, offresMesurees: m.offresMesurees,
        couverture: m.couverture, cardinalite: m.cardinalite, facettesSite: m.facettesSite }),
    ]),
  ),
  ...MARCHES_LOCALISES,
} as Readonly<Record<CodeMarche, Marche>>;

export function localeServie(m: Marche | undefined): string | undefined {
  if (!m) return undefined;
  return m.localisation === 'FALLBACK' ? (m.localeDeRepli ?? m.localeParDefaut) : m.localeParDefaut;
}

export function estCodeMarche(code: string): code is CodeMarche {
  return (CODES_MARCHE as readonly string[]).includes(code);
}

export function marche(code: string): Marche | undefined {
  if (typeof code !== 'string') return undefined;
  const normalise = code.trim().toUpperCase();
  return estCodeMarche(normalise) ? MARCHES[normalise] : undefined;
}

export type TypeFiltre = 'FACETTE' | 'RECHERCHE' | 'TOGGLE';

export const TYPE_FILTRE_PAR_DEFAUT: Readonly<Record<CleFacette, TypeFiltre>> = {
  pays: 'FACETTE',
  metier: 'FACETTE',
  secteur: 'FACETTE',
  contrat: 'FACETTE',
  temps: 'FACETTE',
  programme: 'FACETTE',
  langue: 'FACETTE',
  ville: 'RECHERCHE',
  maison: 'RECHERCHE',
  groupe: 'FACETTE',
};

export type FiltreMarche = {
  readonly cle: CleFacette;
  readonly type: TypeFiltre;
  readonly libelle: string;
};

export function filtresDuMarche(perimetre: Perimetre): readonly FiltreMarche[] {
  const surcharges = perimetre.marche?.typesFiltres;
  return facettesContrat(perimetre).map(({ cle, libelle }) => ({
    cle, libelle, type: surcharges?.[cle] ?? TYPE_FILTRE_PAR_DEFAUT[cle],
  }));
}

export function libelleFacetteServi(marche: Marche, dimension: DimensionFacette): string | undefined {
  const natif = marche.libelles[dimension];
  if (natif !== undefined) return natif;
  if (marche.localisation !== 'FALLBACK' || !marche.localeDeRepli) return undefined;
  const porteur = Object.values(MARCHES).find(
    (m) => m.localisation === 'NATIVE' && m.localeParDefaut === marche.localeDeRepli,
  );
  return porteur?.libelles[dimension] ?? LIBELLES_GENERIQUES[dimension as CleFacette];
}

export function facettesDuMarche(code: string): readonly DimensionFacette[] {
  const m = marche(code);
  if (m?.facettesEmploi) return m.facettesEmploi;
  if (!m) return [];
  return DIMENSIONS_FACETTE.filter(
    (dimension) =>
      m.couverture[dimension] >= SEUIL_AFFICHAGE_FACETTE &&
      (m.cardinalite?.[dimension] ?? CARDINALITE_MINIMALE) >= CARDINALITE_MINIMALE &&
      libelleFacetteServi(m, dimension) !== undefined,
  );
}

export function libelleFacette(code: string, dimension: DimensionFacette): string | undefined {
  return marche(code)?.libelles[dimension];
}

export type Perimetre = {
  readonly code: string;
  readonly pays: readonly string[];
  readonly marche: Marche | undefined;
};

export function perimetreDeRecherche(code: string | undefined, paysConnus: ReadonlySet<string>): Perimetre | undefined {
  if (typeof code !== 'string') return undefined;
  const normalise = code.trim().toUpperCase();
  const mesure = marche(normalise);
  if (mesure) return { code: mesure.code, pays: mesure.pays, marche: mesure };
  if (!/^[A-Z]{2}$/.test(normalise) || !paysConnus.has(normalise)) return undefined;
  return { code: normalise, pays: [normalise], marche: undefined };
}

export type FacetteContrat = { readonly cle: CleFacette; readonly libelle: string };

export function facettesContrat(perimetre: Perimetre): readonly FacetteContrat[] {
  const m = perimetre.marche;
  const dimensions = m ? new Set(facettesDuMarche(m.code)) : new Set<DimensionFacette>();
  const site = new Set<CleFacetteSite>(m ? m.facettesSite : ['secteur', 'ville', 'maison', 'groupe', 'langue']);
  return CLES_FACETTE.flatMap((cle) => {
    const dimension = DIMENSION_PAR_CLE[cle];
    if (dimension) {
      if (!m || !dimensions.has(dimension)) return [];
      return [{ cle, libelle: libelleFacetteServi(m, dimension) ?? LIBELLES_GENERIQUES[cle] }];
    }
    const siteCle = cle as CleFacetteSite;
    if (!site.has(siteCle)) return [];
    return [{ cle, libelle: m ? m.libellesSite[siteCle] : LIBELLES_GENERIQUES[cle] }];
  });
}
