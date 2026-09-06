/**
 * Taxonomie Catwalks Intelligence — copie EXACTE des clés que le pipeline
 * écrit dans `Job.jobFunction` / `Job.seniority` (`apps/aggregator/src/normalize/taxonomy.ts`).
 * Le web ne classe rien : il lit les clés stockées et les libelle. Une clé
 * inconnue ou nulle est « Non classé » — toujours affichée avec sa part, parce
 * que c'est la couverture réelle de la classification, pas un détail à cacher.
 */

export type JobFamily = 'retail' | 'craft' | 'corporate';

export type FunctionDef = { key: string; label: string; family: JobFamily };

export const JOB_FUNCTIONS: ReadonlyArray<FunctionDef> = [
  { key: 'retail-client-advisor', label: 'Conseil de vente', family: 'retail' },
  { key: 'beauty-advisor', label: 'Conseil beauté', family: 'retail' },
  { key: 'retail-store-management', label: 'Direction de boutique', family: 'retail' },
  { key: 'retail-area-management', label: 'Direction régionale retail', family: 'retail' },
  { key: 'retail-operations', label: 'Opérations boutique & stock', family: 'retail' },
  { key: 'visual-merchandising', label: 'Visual merchandising', family: 'retail' },
  { key: 'merchandising-buying', label: 'Merchandising & achats', family: 'corporate' },
  { key: 'wholesale-b2b', label: 'Wholesale & B2B', family: 'corporate' },
  { key: 'crm-clienteling', label: 'CRM & clienteling', family: 'corporate' },
  { key: 'ecommerce-digital', label: 'E-commerce & digital', family: 'corporate' },
  { key: 'marketing-communication', label: 'Marketing & communication', family: 'corporate' },
  { key: 'design-creation', label: 'Création & design', family: 'corporate' },
  { key: 'product-development-rd', label: 'Développement produit & R&D', family: 'corporate' },
  { key: 'atelier-craft', label: 'Atelier & savoir-faire', family: 'craft' },
  { key: 'manufacturing-quality', label: 'Production & qualité', family: 'craft' },
  { key: 'supply-chain-logistics', label: 'Supply chain & logistique', family: 'corporate' },
  { key: 'finance', label: 'Finance', family: 'corporate' },
  { key: 'hr-talent', label: 'Ressources humaines', family: 'corporate' },
  { key: 'it-data', label: 'IT & data', family: 'corporate' },
  { key: 'legal-compliance', label: 'Juridique & conformité', family: 'corporate' },
  { key: 'strategy-management', label: 'Stratégie & direction', family: 'corporate' },
  { key: 'sustainability', label: 'Développement durable', family: 'corporate' },
  { key: 'customer-service', label: 'Service client', family: 'corporate' },
  { key: 'hospitality', label: 'Hôtellerie & restauration', family: 'corporate' },
  { key: 'admin-facilities', label: 'Administration & services généraux', family: 'corporate' },
];

export const FUNCTION_BY_KEY: ReadonlyMap<string, FunctionDef> = new Map(JOB_FUNCTIONS.map((f) => [f.key, f]));

export const UNCLASSIFIED_LABEL = 'Non classé';

export function functionLabel(key: string | null | undefined): string {
  if (!key) return UNCLASSIFIED_LABEL;
  return FUNCTION_BY_KEY.get(key)?.label ?? UNCLASSIFIED_LABEL;
}

export function isFunctionKey(key: string): boolean {
  return FUNCTION_BY_KEY.has(key);
}

export const FAMILY_LABELS: Readonly<Record<JobFamily, string>> = {
  retail: 'Retail',
  craft: 'Atelier',
  corporate: 'Corporate',
};

export function familyOf(key: string | null | undefined): JobFamily | null {
  if (!key) return null;
  return FUNCTION_BY_KEY.get(key)?.family ?? null;
}

export const SENIORITIES = [
  'INTERNSHIP',
  'APPRENTICESHIP',
  'GRADUATE',
  'JUNIOR',
  'MID',
  'SENIOR',
  'MANAGER',
  'DIRECTOR',
  'EXECUTIVE',
] as const;
export type Seniority = (typeof SENIORITIES)[number];

export const SENIORITY_LABELS: Readonly<Record<Seniority, string>> = {
  INTERNSHIP: 'Stage',
  APPRENTICESHIP: 'Alternance',
  GRADUATE: 'Jeune diplômé · VIE · Graduate',
  JUNIOR: 'Junior',
  MID: 'Confirmé',
  SENIOR: 'Senior · Expert',
  MANAGER: 'Manager',
  DIRECTOR: 'Directeur',
  EXECUTIVE: 'Dirigeant',
};

export function seniorityLabel(key: string | null | undefined): string {
  if (!key) return UNCLASSIFIED_LABEL;
  return (SENIORITY_LABELS as Record<string, string>)[key] ?? UNCLASSIFIED_LABEL;
}

/** « Early careers » = stage + alternance + jeune diplômé ; « Executive » = directeur + dirigeant. */
export const EARLY_CAREERS: ReadonlyArray<Seniority> = ['INTERNSHIP', 'APPRENTICESHIP', 'GRADUATE'];
export const EXECUTIVE: ReadonlyArray<Seniority> = ['DIRECTOR', 'EXECUTIVE'];

/** Secteurs affichés (Company.sector) ; toute autre valeur → « Autres ». */
export const SECTORS = ['FASHION', 'LUXURY', 'BEAUTY', 'JEWELRY_WATCHES', 'RETAIL'] as const;
export type Sector = (typeof SECTORS)[number];

export const SECTOR_LABELS: Readonly<Record<Sector, string>> = {
  FASHION: 'Mode',
  LUXURY: 'Luxe',
  BEAUTY: 'Beauté',
  JEWELRY_WATCHES: 'Horlogerie & Joaillerie',
  RETAIL: 'Retail',
};

/** Slug d'URL en français sans accent pour chaque secteur (`/intelligence/secteurs#…`). */
export const SECTOR_SLUGS: Readonly<Record<Sector, string>> = {
  FASHION: 'mode',
  LUXURY: 'luxe',
  BEAUTY: 'beaute',
  JEWELRY_WATCHES: 'horlogerie-joaillerie',
  RETAIL: 'retail',
};

export const OTHER_SECTOR_LABEL = 'Autres';

export function sectorLabel(value: string | null | undefined): string {
  if (!value) return OTHER_SECTOR_LABEL;
  return (SECTOR_LABELS as Record<string, string>)[value] ?? OTHER_SECTOR_LABEL;
}

export function isSector(value: string): value is Sector {
  return (SECTORS as ReadonlyArray<string>).includes(value);
}

/** Vocabulaire contrat stocké dans Job.contract (libellés via lib/format contractLabel). */
export const CONTRACTS = ['CDI', 'CDD', 'STAGE', 'ALTERNANCE', 'VIE', 'INTERIM', 'FREELANCE', 'GRADUATE'] as const;
