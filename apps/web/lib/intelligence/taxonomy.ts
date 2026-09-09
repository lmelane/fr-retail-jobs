/** Occupation/family/rank labels are loaded from the active catalogue in
 * lib/occupations.ts. This file retains sector presentation for Lot 3. */

export type JobFamily = string;
export const UNCLASSIFIED_LABEL = 'Non classé';

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

/**
 * Fusionne en UNE ligne « Autres » tout ce qui n'est pas un secteur affiché
 * (UNKNOWN, SUPPLIER, MEDIA_AGENCY, RECRUITER, OTHER) : la home en montrait
 * quatre, toutes libellées « Autres » (prod, 2026-09-06). Les champs
 * numériques s'additionnent, la clé devient 'OTHER'.
 */
export function mergeOtherSectors<T extends { key: string; count: number }>(rows: ReadonlyArray<T>): T[] {
  const kept: T[] = [];
  let other: T | null = null;
  for (const r of rows) {
    if (isSector(r.key)) { kept.push(r); continue; }
    if (!other) { other = { ...r, key: 'OTHER' }; continue; }
    const merged = { ...other } as Record<string, unknown>;
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number' && k !== 'key') merged[k] = ((merged[k] as number) ?? 0) + v;
    other = merged as T;
  }
  return other ? [...kept, other].sort((a, b) => b.count - a.count) : kept;
}

export function isSector(value: string): value is Sector {
  return (SECTORS as ReadonlyArray<string>).includes(value);
}

/** Vocabulaire de durée stocké dans Job.employmentTerm (libellés : lib/format employmentTermLabel). */
export const CONTRACTS = ['CDI', 'CDD', 'STAGE', 'ALTERNANCE', 'VIE', 'INTERIM', 'FREELANCE', 'GRADUATE'] as const;
