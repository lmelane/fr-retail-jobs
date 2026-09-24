import { FACET_LABELS, langueDesLibelles } from "@catwalks/db/presentation";

/** Marchés ouverts : le pays fixe le corpus, les langues et la politique produit.
 * Ajouter un marché exige son catalogue natif dans l’API ET le site.
 * Les volumes et taux RAW sont mesurés à la demande ; ils ne décident pas de l’interface. */
const DEFINITIONS = {
  JP: {"nom": "日本", "pays": ["JP"], "locales": ["ja-JP"], "localeParDefaut": "ja-JP", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  KR: {"nom": "대한민국", "pays": ["KR"], "locales": ["ko-KR"], "localeParDefaut": "ko-KR", "facettesSite": ["secteur", "ville", "maison", "groupe"]},
  PT: {"nom": "Portugal", "pays": ["PT"], "locales": ["pt-PT"], "localeParDefaut": "pt-PT", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  MX: {"nom": "México", "pays": ["MX"], "locales": ["es-MX"], "localeParDefaut": "es-MX", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  SG: {"nom": "Singapore", "pays": ["SG"], "locales": ["en-SG"], "localeParDefaut": "en-SG", "facettesSite": ["secteur", "maison", "groupe"]},
  DK: {"nom": "Danmark", "pays": ["DK"], "locales": ["da-DK"], "localeParDefaut": "da-DK", "facettesSite": ["secteur", "ville", "maison", "langue"]},
  HK: {"nom": "香港", "pays": ["HK"], "locales": ["zh-HK"], "localeParDefaut": "zh-HK", "facettesSite": ["secteur", "ville", "maison", "groupe"]},
  PL: {"nom": "Polska", "pays": ["PL"], "locales": ["pl-PL"], "localeParDefaut": "pl-PL", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  SE: {"nom": "Sverige", "pays": ["SE"], "locales": ["sv-SE"], "localeParDefaut": "sv-SE", "facettesSite": ["secteur", "ville", "maison"]},
  CL: {"nom": "Chile", "pays": ["CL"], "locales": ["es-CL"], "localeParDefaut": "es-CL", "facettesSite": ["secteur", "ville", "maison", "langue"]},
  TR: {"nom": "Türkiye", "pays": ["TR"], "locales": ["tr-TR"], "localeParDefaut": "tr-TR", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  TH: {"nom": "ประเทศไทย", "pays": ["TH"], "locales": ["th-TH"], "localeParDefaut": "th-TH", "facettesSite": ["secteur", "ville", "maison", "groupe"]},
  MY: {"nom": "Malaysia", "pays": ["MY"], "locales": ["ms-MY"], "localeParDefaut": "ms-MY", "facettesSite": ["secteur", "ville", "maison", "groupe"]},
  AE: {"nom": "الإمارات العربية المتحدة", "pays": ["AE"], "locales": ["ar-AE"], "localeParDefaut": "ar-AE", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  NO: {"nom": "Norge", "pays": ["NO"], "locales": ["nb-NO"], "localeParDefaut": "nb-NO", "facettesSite": ["secteur", "ville", "maison"]},
  TW: {"nom": "臺灣", "pays": ["TW"], "locales": ["zh-TW"], "localeParDefaut": "zh-TW", "facettesSite": ["secteur", "ville", "maison", "groupe"]},
  BR: {"nom": "Brasil", "pays": ["BR"], "locales": ["pt-BR"], "localeParDefaut": "pt-BR", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  GR: {"nom": "Ελλάδα", "pays": ["GR"], "locales": ["el-GR"], "localeParDefaut": "el-GR", "facettesSite": ["secteur", "ville", "maison", "langue"]},
  ZA: {"nom": "South Africa", "pays": ["ZA"], "locales": ["en-ZA"], "localeParDefaut": "en-ZA", "facettesSite": ["secteur", "ville", "maison"]},
  VN: {"nom": "Việt Nam", "pays": ["VN"], "locales": ["vi-VN"], "localeParDefaut": "vi-VN", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  CZ: {"nom": "Česko", "pays": ["CZ"], "locales": ["cs-CZ"], "localeParDefaut": "cs-CZ", "facettesSite": ["secteur", "ville", "maison", "langue"]},
  PE: {"nom": "Perú", "pays": ["PE"], "locales": ["es-PE"], "localeParDefaut": "es-PE", "facettesSite": ["secteur", "ville", "maison", "langue"]},
  NZ: {"nom": "New Zealand", "pays": ["NZ"], "locales": ["en-NZ"], "localeParDefaut": "en-NZ", "facettesSite": ["secteur", "ville", "maison", "groupe"]},
  HU: {"nom": "Magyarország", "pays": ["HU"], "locales": ["hu-HU"], "localeParDefaut": "hu-HU", "facettesSite": ["secteur", "maison", "groupe", "langue"]},
  SA: {"nom": "المملكة العربية السعودية", "pays": ["SA"], "locales": ["ar-SA"], "localeParDefaut": "ar-SA", "facettesSite": ["secteur", "ville", "maison", "groupe"]},
  RO: {"nom": "România", "pays": ["RO"], "locales": ["ro-RO"], "localeParDefaut": "ro-RO", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  PR: {"nom": "Puerto Rico", "pays": ["PR"], "locales": ["es-PR"], "localeParDefaut": "es-PR", "facettesSite": ["secteur", "ville", "maison", "langue"]},
  PH: {"nom": "Philippines", "pays": ["PH"], "locales": ["en-PH"], "localeParDefaut": "en-PH", "facettesSite": ["secteur", "ville", "maison"]},
  LU: {"nom": "Luxembourg", "pays": ["LU"], "locales": ["fr-LU"], "localeParDefaut": "fr-LU", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  US: {"nom": "United States", "pays": ["US"], "locales": ["en-US", "es-US"], "localeParDefaut": "en-US", "facettesSite": ["secteur", "ville", "maison", "langue"]},
  FR: {"nom": "France", "pays": ["FR"], "locales": ["fr-FR"], "localeParDefaut": "fr-FR", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  GB: {"nom": "United Kingdom", "pays": ["GB", "IE"], "locales": ["en-GB"], "localeParDefaut": "en-GB", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue", "pays"]},
  CA: {"nom": "Canada", "pays": ["CA"], "locales": ["en-CA", "fr-CA"], "localeParDefaut": "en-CA", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  DE: {"nom": "Deutschland", "pays": ["DE", "AT"], "locales": ["de-DE"], "localeParDefaut": "de-DE", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue", "pays"]},
  IT: {"nom": "Italia", "pays": ["IT"], "locales": ["it-IT"], "localeParDefaut": "it-IT", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  ES: {"nom": "España", "pays": ["ES"], "locales": ["es-ES"], "localeParDefaut": "es-ES", "facettesSite": ["secteur", "ville", "maison", "langue"]},
  NL: {"nom": "Nederland", "pays": ["NL"], "locales": ["nl-NL"], "localeParDefaut": "nl-NL", "facettesSite": ["secteur", "ville", "maison", "langue"]},
  AU: {"nom": "Australia", "pays": ["AU"], "locales": ["en-AU"], "localeParDefaut": "en-AU", "facettesSite": ["secteur", "ville", "maison", "groupe"]},
  CH: {"nom": "Suisse · Schweiz", "pays": ["CH"], "locales": ["fr-CH", "de-CH", "it-CH"], "localeParDefaut": "fr-CH", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  BE: {"nom": "Belgique · België", "pays": ["BE"], "locales": ["fr-BE", "nl-BE", "de-BE", "en-BE"], "localeParDefaut": "fr-BE", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
  CN: {"nom": "中国", "pays": ["CN"], "locales": ["zh-CN"], "localeParDefaut": "zh-CN", "facettesSite": ["secteur", "ville", "maison", "groupe", "langue"]},
} as const;

export type CodeMarche = keyof typeof DEFINITIONS;
export const CODES_MARCHE = Object.keys(DEFINITIONS) as CodeMarche[];

export const DIMENSIONS_FACETTE = [
  'contrat',
  'temps',
  'programme',
  'saisonnier',
  'metier',
] as const;
export type DimensionFacette = (typeof DIMENSIONS_FACETTE)[number];

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
  readonly facettesEmploi: readonly DimensionFacette[];
  readonly contratUnifie: boolean;
  readonly code: CodeMarche;
  readonly nom: string;
  readonly pays: readonly string[];
  readonly locales: readonly string[];
  readonly localeParDefaut: string;
  readonly typesFiltres?: Readonly<Partial<Record<CleFacette, TypeFiltre>>>;
  readonly facettesSite: readonly CleFacetteSite[];
  readonly libellesSite: Readonly<Record<CleFacetteSite, string>>;
  readonly libelles: Readonly<Partial<Record<DimensionFacette, string>>>;
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

/** Nature d’emploi : durée du contrat, programme ou activité indépendante.
 * Le temps de travail reste un axe distinct. Les options sont comptées dans le
 * corpus courant, sans assimiler les régimes juridiques des différents pays. */
export const MARCHES: Readonly<Record<CodeMarche, Marche>> = Object.fromEntries(
  CODES_MARCHE.map((code) => {
    const m = DEFINITIONS[code];
    const labels = FACET_LABELS[langueDesLibelles(m.localeParDefaut)];
    const definition: Marche = { ...m, code, facettesEmploi: ['contrat', 'temps'], contratUnifie: true,
      libelles: { contrat: labels.contrat, temps: labels.temps }, libellesSite: labels,
    };
    return [code, definition];
  }),
) as Readonly<Record<CodeMarche, Marche>>;

export function localeServie(m: Marche | undefined): string | undefined {
  if (!m) return undefined;
  return m.localeParDefaut;
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
  return marche.libelles[dimension];
}

export function facettesDuMarche(code: string): readonly DimensionFacette[] {
  return marche(code)?.facettesEmploi ?? [];
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
