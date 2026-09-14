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

import { knownAlpha2 } from './intelligence/country-ids';

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

/**
 * Libellés Intl (fr + en) de tous les codes ISO connus, en minuscules → code.
 * Construit une fois, paresseusement : « japon », « allemagne », « arabie
 * saoudite », « south korea » se replient sans qu'on liste chaque graphie à la
 * main (Catwalks Intelligence agrège par pays : une graphie non repliée est une
 * offre « sans pays »). La table manuelle ci-dessus garde la priorité.
 */
let intlAliases: Map<string, string> | null = null;
function intlAlias(key: string): string | null {
  if (!intlAliases) {
    intlAliases = new Map();
    try {
      const fr = new Intl.DisplayNames(['fr'], { type: 'region' });
      const en = new Intl.DisplayNames(['en'], { type: 'region' });
      for (const code of knownAlpha2()) {
        for (const dn of [fr, en]) {
          const label = dn.of(code);
          if (label && label !== code) intlAliases.set(label.toLowerCase(), code);
        }
      }
    } catch {
      // Sans Intl.DisplayNames (runtime minimal), on garde la table manuelle.
    }
  }
  return intlAliases.get(key) ?? null;
}

/** Graphies vues en base que ni la table ni Intl ne couvrent. */
const EXTRA_ALIASES: Record<string, string> = {
  'corée, république de': 'KR',
  'hong kong, ras chine': 'HK',
  'taïwan, chine': 'TW',
  'taiwan': 'TW',
  'macao, ras chine': 'MO',
  'émirats arabes unis': 'AE',
  'emirats arabes unis': 'AE',
  'united arab emirates': 'AE',
  'uae': 'AE',
  'usa': 'US',
  // Intl (Node 26) dit « Türkiye » / « Czechia » : les formes courantes restent à la main (audit I-1).
  'turkey': 'TR', 'türkiye': 'TR', 'turkiye': 'TR', 'turquie': 'TR',
  'czech republic': 'CZ', 'czechia': 'CZ', 'tchéquie': 'CZ', 'tchequie': 'CZ', 'république tchèque': 'CZ', 'republique tcheque': 'CZ',
  'russia': 'RU', 'russie': 'RU', 'russian federation': 'RU',
  'vietnam': 'VN', 'viet nam': 'VN',
  'south korea': 'KR', 'korea, republic of': 'KR', 'republic of korea': 'KR', 'corée du sud': 'KR',
  'macau': 'MO', 'macao': 'MO',
  "côte d'ivoire": 'CI', 'ivory coast': 'CI',
  'united states of america': 'US',
};

/** Canonical code for a raw country string, or null when unrecognised. */
export function countryCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  if (EXTRA_ALIASES[key]) return EXTRA_ALIASES[key];
  // A bare 2-letter code we don't alias: keep it uppercased.
  if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
  return intlAlias(key);
}

/**
 * Libellé français d'un code pays : la table maison d'abord (31 libellés),
 * puis Intl pour tous les autres — 68 codes sur 91 s'affichaient bruts
 * (« HU (73) », audit A1, 2026-09-06).
 */
const INTL_FR = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['fr'], { type: 'region' }) : null;
export function countryLabel(code: string): string {
  if (LABELS[code]) return LABELS[code];
  try {
    const label = INTL_FR?.of(code);
    return label && label !== code ? label : code;
  } catch {
    return code;
  }
}

/** Every raw spelling that maps to a given canonical code — for the SQL filter. */
export function rawValuesForCode(code: string): string[] {
  const spellings = Object.entries(ALIASES)
    .filter(([, c]) => c === code)
    .map(([raw]) => raw);
  // Include the code itself in a few cases and the exact stored variants.
  return [...new Set([code, code.toLowerCase(), ...spellings])];
}
