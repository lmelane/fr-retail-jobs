/** Comparison only. Numbers, legal forms, countries and non-Latin scripts survive. */
export function normalizedEmployerName(raw: string): string {
  return raw.normalize('NFKC').replace(/[\s\u00a0\u202f]+/gu, ' ').trim().toLowerCase();
}
export function employerAliasKey(sourceKey: string, raw: string): string {
  return JSON.stringify([sourceKey, normalizedEmployerName(raw)]);
}
