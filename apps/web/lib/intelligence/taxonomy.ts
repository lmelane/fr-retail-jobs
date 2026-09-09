/** Occupations and business sectors have separate data-managed catalogues. */
export type JobFamily = string;
export const UNCLASSIFIED_LABEL='Non classé';
export const OTHER_SECTOR_LABEL='Secteur à vérifier';
/** Memberships overlap; never collapse them into a false partition. */
export function mergeOtherSectors<T extends {key:string;count:number}>(rows:ReadonlyArray<T>):T[]{return [...rows];}
