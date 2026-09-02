/**
 * Country normalization for the Pays filter.
 *
 * The `country` column holds whatever each source wrote — "France", "FR", "fr",
 * "US", "États-Unis d'Amérique", "United States", "Italie", "IT"… — so the same
 * country appears under several spellings. This collapses them to one canonical
 * code + French label, so the filter shows "France (2 604)" once, not three
 * rows. France is special-cased on the reliable isFrance flag elsewhere; this
 * map covers display and the non-France codes.
 */

export type Country = { code: string; label: string };

/** Lowercased raw value -> canonical code. Extend as new sources appear. */
const ALIASES: Record<string, string> = {
  // France
  fr: 'FR', fra: 'FR', france: 'FR',
  // United States
  us: 'US', usa: 'US', 'united states': 'US', "états-unis d'amérique": 'US',
  'etats-unis': 'US', 'états-unis': 'US',
  // United Kingdom
  gb: 'GB', uk: 'GB', 'united kingdom': 'GB', 'royaume-uni': 'GB', england: 'GB',
  // Italy / Spain / Germany / Netherlands / Belgium / Portugal
  it: 'IT', ita: 'IT', italie: 'IT', italy: 'IT', italia: 'IT',
  es: 'ES', esp: 'ES', espagne: 'ES', spain: 'ES', 'españa': 'ES',
  de: 'DE', deu: 'DE', allemagne: 'DE', germany: 'DE', deutschland: 'DE',
  nl: 'NL', 'pays-bas': 'NL', netherlands: 'NL',
  be: 'BE', belgique: 'BE', belgium: 'BE',
  pt: 'PT', portugal: 'PT',
  // Others seen in the data
  ca: 'CA', canada: 'CA',
  ch: 'CH', suisse: 'CH', switzerland: 'CH',
  cn: 'CN', chine: 'CN', china: 'CN',
  au: 'AU', australie: 'AU', australia: 'AU',
  dk: 'DK', danemark: 'DK', denmark: 'DK',
  no: 'NO', norvege: 'NO', norway: 'NO',
  se: 'SE', suede: 'SE', sweden: 'SE',
  kr: 'KR', 'coree du sud': 'KR', 'south korea': 'KR',
  jp: 'JP', japon: 'JP', japan: 'JP',
  mx: 'MX', mexique: 'MX', mexico: 'MX',
  my: 'MY', malaisie: 'MY', malaysia: 'MY',
  ae: 'AE', 'emirats arabes unis': 'AE',
  hk: 'HK', 'hong kong': 'HK',
  sg: 'SG', singapour: 'SG', singapore: 'SG',
};

/** French display label per canonical code. */
const LABELS: Record<string, string> = {
  FR: 'France', US: 'États-Unis', GB: 'Royaume-Uni', IT: 'Italie', ES: 'Espagne',
  DE: 'Allemagne', NL: 'Pays-Bas', BE: 'Belgique', PT: 'Portugal', CA: 'Canada',
  CH: 'Suisse', CN: 'Chine', AU: 'Australie', DK: 'Danemark', NO: 'Norvège',
  SE: 'Suède', KR: 'Corée du Sud', JP: 'Japon', MX: 'Mexique', MY: 'Malaisie',
  AE: 'Émirats', HK: 'Hong Kong', SG: 'Singapour',
};

/** Canonical code for a raw country string, or null when unrecognised. */
export function countryCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  // A bare 2-letter code we don't alias: keep it uppercased.
  if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
  return null;
}

/** French label for a canonical code (falls back to the code itself). */
export function countryLabel(code: string): string {
  return LABELS[code] ?? code;
}

/** Every raw spelling that maps to a given canonical code — for the SQL filter. */
export function rawValuesForCode(code: string): string[] {
  const spellings = Object.entries(ALIASES)
    .filter(([, c]) => c === code)
    .map(([raw]) => raw);
  // Include the code itself in a few cases and the exact stored variants.
  return [...new Set([code, code.toLowerCase(), ...spellings])];
}
