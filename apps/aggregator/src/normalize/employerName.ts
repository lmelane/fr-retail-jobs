/** Comparison only. Numbers, legal forms, countries and non-Latin scripts survive. */
export function normalizedEmployerName(raw: string): string {
  return raw.normalize('NFKC').replace(/[\s\u00a0\u202f]+/gu, ' ').trim().toLowerCase();
}
export function employerAliasKey(sourceKey: string, raw: string): string {
  return JSON.stringify([sourceKey, normalizedEmployerName(raw)]);
}

/** A comparison of an already attributed posting, not an alias key or a
 * cross-company lookup. Only spacing AFTER abbreviation dots is equivalent;
 * dots, legal forms, numbers and countries remain significant. */
export function sameEmployerTypography(left: string, right: string): boolean {
  const compare = (name: string) => normalizedEmployerName(name).replace(/(?<=\p{L}\.) +(?=\p{L})/gu, '');
  return compare(left) === compare(right);
}
