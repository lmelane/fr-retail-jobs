/**
 * Postgres accepte au plus 32 767 paramètres liés par requête. Un
 * `updateMany({ id: { in: [...] } })` ou un `createMany` qui dépasse cette
 * borne échoue d'un bloc — mesuré sur une copie à 65 900 fermetures :
 * « too many bind variables in prepared statement, expected maximum of 32767,
 * received 65903 ». Toute écriture en lot passe donc par tranches.
 *
 * 2 000 lignes × ≤ 9 colonnes = 18 000 paramètres : de la marge, et une
 * transaction qui reste courte.
 */
export const DB_WRITE_BATCH = 2_000;

export function chunk<T>(items: ReadonlyArray<T>, size: number = DB_WRITE_BATCH): T[][] {
  if (!Number.isInteger(size) || size <= 0) throw new Error(`chunk size must be a positive integer, got ${size}`);
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}
